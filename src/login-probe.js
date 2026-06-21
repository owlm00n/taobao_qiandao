#!/usr/bin/env node
/**
 * 淘宝 H5 登录 + MTOP API 探测脚本
 *
 * 流程：
 * 1. 打开淘宝 H5 登录页，截图 QR 码
 * 2. 等待用户扫码登录
 * 3. 登录后保存 cookie 到文件
 * 4. 探测会员中心 / 签到相关 MTOP API
 * 5. 输出所有候选签到请求
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium, devices } from 'playwright-core';

const SHOP_ID = '116576560';
const OUT_DIR = path.resolve(process.argv[2] || `captures/login-probe-${timestamp()}`);

// 可能的签到相关 MTOP API 路径（根据淘宝 MTOP 命名惯例猜测）
const PROBE_APIS = [
  // 店铺会员签到
  { api: 'mtop.taobao.wireless.shop.member.sign', v: '1.0' },
  { api: 'mtop.tmall.shop.member.signin', v: '1.0' },
  { api: 'mtop.taobao.shop.member.signin.do', v: '1.0' },
  { api: 'mtop.taobao.wireless.member.sign', v: '1.0' },
  { api: 'mtop.tmall.wireless.member.signin', v: '1.0' },
  { api: 'mtop.taobao.member.signin', v: '1.0' },
  { api: 'mtop.tmall.member.sign', v: '1.0' },
  { api: 'mtop.taobao.wireless.shop.member.signin', v: '1.0' },
  { api: 'mtop.taobao.shop.member.sign', v: '1.0' },
  // 会员中心
  { api: 'mtop.taobao.wireless.shop.member.center', v: '1.0' },
  { api: 'mtop.tmall.shop.member.center', v: '1.0' },
  { api: 'mtop.taobao.wireless.shop.member.info', v: '1.0' },
  { api: 'mtop.taobao.shop.member.info', v: '1.0' },
  { api: 'mtop.tmall.shop.member.info', v: '1.0' },
  { api: 'mtop.taobao.wireless.shop.member.task', v: '1.0' },
  { api: 'mtop.taobao.wireless.shop.member.benefit', v: '1.0' },
  { api: 'mtop.taobao.shop.member.query', v: '1.0' },
  // 已知的店铺相关 API
  { api: 'mtop.taobao.wireless.shop.fetch', v: '2.0' },
  { api: 'mtop.taobao.wireless.shop.member.list', v: '1.0' },
  { api: 'mtop.taobao.wireless.shop.member.detail', v: '1.0' },
  // 天猫会员
  { api: 'mtop.tmall.shop.member.query', v: '1.0' },
  { api: 'mtop.tmall.wireless.member.center', v: '1.0' },
  { api: 'mtop.tmall.wireless.shop.member', v: '1.0' },
];

const COOKIE_FILE = path.resolve('.browser-profile/cookies.json');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function appendJsonl(file, obj) {
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
}

// MTOP 签名算法（简化版，用于探测）
function mtopSign(token, timestamp, appKey, data) {
  const str = `${token}&${timestamp}&${appKey}&${data}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logPath = path.join(OUT_DIR, 'network.jsonl');
  const summaryPath = path.join(OUT_DIR, 'summary.json');
  const screenshots = [];

  console.error(`Output: ${OUT_DIR}`);

  const iPhone = devices['iPhone 13'];
  const userDataDir = path.resolve('.browser-profile/taobao-probe');

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: false,  // 必须 headed 才能显示 QR 码
    viewport: iPhone.viewport,
    userAgent: iPhone.userAgent,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const page = context.pages()[0] || await context.newPage();

  // 记录所有淘宝/天猫域名的网络请求
  page.on('request', async (request) => {
    const url = request.url();
    if (!url.includes('taobao.com') && !url.includes('tmall.com') && !url.includes('alicdn.com')) return;
    appendJsonl(logPath, {
      type: 'request',
      ts: new Date().toISOString(),
      method: request.method(),
      url,
      resourceType: request.resourceType(),
      headers: sanitizeHeaders(request.headers()),
      postData: request.postData() ? request.postData().slice(0, 5000) : null
    });
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('taobao.com') && !url.includes('tmall.com') && !url.includes('alicdn.com')) return;
    const ct = response.headers()['content-type'] || '';
    let bodyPreview = '';
    if (/json|text|javascript|html/i.test(ct)) {
      try {
        bodyPreview = (await response.text()).slice(0, 5000);
      } catch (_) {}
    }
    appendJsonl(logPath, {
      type: 'response',
      ts: new Date().toISOString(),
      status: response.status(),
      url,
      headers: sanitizeHeaders(response.headers()),
      bodyPreview
    });
  });

  // ===== 第一步：打开登录页，暴力切换到二维码模式 =====
  console.error('\n📱 第一步：打开淘宝登录页...');
  const loginUrl = 'https://login.m.taobao.com/login.htm?loginType=11&from=taobao&ttid=h5@iframe';
  await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 暴力 JS 注入：遍历所有元素找到"扫码"并点击
  const qrClicked = await page.evaluate(() => {
    // 方法1：查找所有包含"扫码"文字的可点击元素
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length > 0) continue; // 只看叶子节点
      const text = (el.textContent || '').trim();
      if (text.includes('扫码') || text.includes('二维码') || text === 'QR') {
        // 向上找可点击的父元素
        let clickable = el;
        while (clickable) {
          const tag = clickable.tagName.toLowerCase();
          if (tag === 'a' || tag === 'button' || tag === 'li' || tag === 'span' || tag === 'div') {
            if (clickable.onclick || clickable.getAttribute('data-spm') || clickable.className) {
              clickable.click();
              return 'clicked: ' + text + ' on ' + tag + '.' + (clickable.className || '');
            }
          }
          clickable = clickable.parentElement;
        }
      }
    }
    // 方法2：查找 tab 切换
    const tabs = document.querySelectorAll('.tab-item, .login-tab, [role="tab"], .tab, li[data-type]');
    for (const tab of tabs) {
      const text = (tab.textContent || '').trim();
      if (text.includes('扫码') || text.includes('二维码')) {
        tab.click();
        return 'clicked tab: ' + text;
      }
    }
    // 方法3：查找 class 含 qr 的元素
    const qrEls = document.querySelectorAll('[class*="qr"], [class*="QR"], [id*="qr"], [id*="QR"]');
    for (const el of qrEls) {
      if (el.tagName === 'A' || el.tagName === 'LI' || el.tagName === 'DIV' || el.tagName === 'SPAN') {
        el.click();
        return 'clicked qr element: ' + el.className;
      }
    }
    return 'no qr element found';
  });
  console.error(`   QR切换结果: ${qrClicked}`);
  await page.waitForTimeout(2000);

  // 方法4：如果还没切过去，尝试直接导航到纯二维码页
  const currentUrl = page.url();
  if (!currentUrl.includes('qrcode') && !currentUrl.includes('qrCode')) {
    console.error('   尝试直接打开二维码登录页...');
    // 淘宝新版登录页的二维码直链
    await page.goto('https://login.taobao.com/member/login.jhtml?style=qr&from=taobao', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    // 再试 havana 新版
    await page.goto('https://login.m.taobao.com/havanaone/login/login.htm?bizEntrance=taobao_h5&bizName=taobao&loginType=11', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    // 再在 havana 页面内点扫码
    await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (text.includes('扫码') || text.includes('二维码')) {
          let p = el.parentElement;
          while (p) {
            if (['A','BUTTON','LI','DIV','SPAN'].includes(p.tagName)) { p.click(); break; }
            p = p.parentElement;
          }
        }
      }
    });
    await page.waitForTimeout(2000);
  }

  const qrShot = path.join(OUT_DIR, 'qr-code.png');
  await page.screenshot({ path: qrShot, fullPage: true });
  screenshots.push(qrShot);
  console.error(`   QR 码截图: ${qrShot}`);
  console.error('   ⚠️ 请用手机淘宝扫描截图中的二维码登录！');

  // ===== 第二步：等待登录 =====
  console.error('\n⏳ 第二步：等待扫码登录（最多 120 秒）...');
  const loggedIn = await waitForLogin(page, 120000);
  if (!loggedIn) {
    console.error('   ❌ 登录超时，请重试');
    await context.close();
    process.exit(1);
  }
  console.error('   ✅ 登录成功！');

  const loggedInShot = path.join(OUT_DIR, 'logged-in.png');
  await page.screenshot({ path: loggedInShot, fullPage: true });
  screenshots.push(loggedInShot);

  // 保存 cookies
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.error(`   Cookie 已保存: ${COOKIE_FILE}`);

  // ===== 第三步：访问店铺页面触发会员相关请求 =====
  console.error('\n🔍 第三步：访问醉清风店铺页面...');
  const shopPages = [
    `https://shop.m.taobao.com/shop/shop_index.htm?shop_id=${SHOP_ID}`,
    `https://zuiqingfeng.m.tmall.com/?shop_id=${SHOP_ID}`,
    `https://shop.m.taobao.com/shop/member_index.htm?shop_id=${SHOP_ID}`,
  ];

  for (const shopUrl of shopPages) {
    console.error(`   访问: ${shopUrl}`);
    try {
      await page.goto(shopUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      const shot = path.join(OUT_DIR, `shop-${shopPages.indexOf(shopUrl)}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
    } catch (e) {
      console.error(`   ⚠️ 访问失败: ${e.message}`);
    }
  }

  // ===== 第四步：直接探测 MTOP API =====
  console.error('\n🔬 第四步：探测 MTOP 会员/签到 API...');
  const mtopToken = await extractMtopToken(page);
  console.error(`   _m_h5_tk: ${mtopToken ? mtopToken.slice(0, 20) + '...' : '未找到'}`);

  const probeResults = [];
  for (const { api, v } of PROBE_APIS) {
    const result = await probeMtopApi(page, api, v, mtopToken, SHOP_ID);
    probeResults.push(result);
    const status = result.status || 'error';
    const icon = result.status === 200 ? '✅' : result.status === 403 ? '🔒' : '❌';
    console.error(`   ${icon} ${api}/${v} → ${status} ${(result.bodyPreview || '').slice(0, 80)}`);
    await page.waitForTimeout(500); // 避免请求太快
  }

  // ===== 第五步：汇总 =====
  const summary = {
    shopId: SHOP_ID,
    screenshots,
    mtopTokenFound: !!mtopToken,
    probeResults: probeResults.map(r => ({
      api: r.api,
      version: r.version,
      status: r.status,
      bodyPreview: (r.bodyPreview || '').slice(0, 300),
      url: r.url
    })),
    cookieFile: COOKIE_FILE
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.error(`\n📊 汇总已保存: ${summaryPath}`);

  await context.close();

  // 输出 JSON 结果
  console.log(JSON.stringify(summary, null, 2));
}

/** 等待登录成功 */
async function waitForLogin(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    // 登录成功后通常会跳转到淘宝首页或 mytaobao
    if (url.includes('mytaobao') || url.includes('i.taobao.com') || url.includes('h5.m.taobao.com/mlapp/mytaobao')) {
      return true;
    }
    // 也检查 cookie 中是否有登录态
    const cookies = await page.context().cookies();
    const hasLoginCookie = cookies.some(c =>
      (c.name === '_tb_token_' || c.name === 'cookie2' || c.name === 'unb') && c.value
    );
    if (hasLoginCookie && !url.includes('login')) {
      return true;
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

/** 从页面提取 _m_h5_tk */
async function extractMtopToken(page) {
  try {
    const cookies = await page.context().cookies();
    const tokenCookie = cookies.find(c => c.name === '_m_h5_tk');
    if (tokenCookie) {
      return tokenCookie.value.split('_')[0];
    }
  } catch (_) {}
  return null;
}

/** 探测单个 MTOP API */
async function probeMtopApi(page, api, v, token, shopId) {
  const t = String(Date.now());
  const appKey = '12574478';
  const data = JSON.stringify({ shopId, pageSize: 10, pageNum: 1 });

  // 尝试不同的 MTOP endpoint
  const endpoints = [
    `https://h5api.m.taobao.com/h5/${api}/${v}/`,
    `https://acs.m.taobao.com/h5/${api}/${v}/`,
    `https://h5api.m.tmall.com/h5/${api}/${v}/`,
  ];

  for (const baseUrl of endpoints) {
    try {
      const sign = token ? mtopSign(token, t, appKey, data) : '';
      const url = `${baseUrl}?jsv=2.7.2&appKey=${appKey}&t=${t}&sign=${sign}&api=${api}&v=${v}&type=originaljson&dataType=json&data=${encodeURIComponent(data)}`;

      const response = await page.evaluate(async (fetchUrl) => {
        try {
          const res = await fetch(fetchUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          });
          const text = await res.text();
          return { status: res.status, body: text.slice(0, 2000) };
        } catch (e) {
          return { status: 0, body: e.message };
        }
      }, url);

      return {
        api,
        version: v,
        url,
        status: response.status,
        bodyPreview: response.body
      };
    } catch (_) {
      continue;
    }
  }

  return { api, version: v, url: '', status: 0, bodyPreview: 'all endpoints failed' };
}

function sanitizeHeaders(headers) {
  const safe = { ...headers };
  // 脱敏
  delete safe['cookie'];
  delete safe['set-cookie'];
  delete safe['authorization'];
  return safe;
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
