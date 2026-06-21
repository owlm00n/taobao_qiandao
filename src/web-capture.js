#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright-core';

const DEFAULT_URLS = [
  'https://shop.m.taobao.com/shop/shop_index.htm?shop_id=116576560',
  'https://zuiqingfeng.tmall.com/shop/view_shop.htm?shop_id=116576560'
];

const KEYWORDS = ['116576560', 'zuiqingfeng', '醉清风', '签到', 'sign', 'member', 'vip', 'mtop'];
const TARGET_HOST_KEYWORDS = ['taobao.com', 'tmall.com', 'alicdn.com'];

async function main(argv) {
  const urls = getAllArgs(argv, '--url');
  const runUrls = urls.length ? urls : DEFAULT_URLS;
  const seconds = Number(getArg(argv, '--seconds') || 90);
  const headed = argv.includes('--headed');
  const outDir = path.resolve(getArg(argv, '--out') || `captures/web-${timestamp()}`);
  const executablePath = getArg(argv, '--chrome') || process.env.CHROME_PATH || '/usr/bin/google-chrome';
  const userDataDir = path.resolve(getArg(argv, '--profile') || '.browser-profile/taobao');

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const logPath = path.join(outDir, 'network.jsonl');
  const summaryPath = path.join(outDir, 'summary.json');
  const screenshots = [];
  const requestMap = new Map();

  const iPhone = devices['iPhone 13'];
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: !headed,
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

  page.on('request', async (request) => {
    const url = request.url();
    if (!isTargetUrl(url)) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    requestMap.set(request, id);
    appendJsonl(logPath, {
      type: 'request',
      id,
      ts: new Date().toISOString(),
      method: request.method(),
      url,
      resourceType: request.resourceType(),
      headers: request.headers(),
      postData: request.postData()
    });
  });

  page.on('response', async (response) => {
    const request = response.request();
    const url = response.url();
    if (!isTargetUrl(url)) return;
    const id = requestMap.get(request) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let bodyPreview = '';
    let bodyError = '';
    const contentType = response.headers()['content-type'] || '';
    if (/json|text|javascript|html|x-www-form-urlencoded/i.test(contentType)) {
      try {
        const text = await response.text();
        bodyPreview = text.slice(0, 3000);
      } catch (error) {
        bodyError = error.message;
      }
    }
    appendJsonl(logPath, {
      type: 'response',
      id,
      ts: new Date().toISOString(),
      status: response.status(),
      url,
      headers: response.headers(),
      bodyPreview,
      bodyError
    });
  });

  for (let index = 0; index < runUrls.length; index += 1) {
    const url = runUrls[index];
    console.error(`Navigating ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);
    } catch (error) {
      appendJsonl(logPath, { type: 'navigation_error', url, message: error.message, ts: new Date().toISOString() });
    }
    const shot = path.join(outDir, `page-${index + 1}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    screenshots.push(shot);
  }

  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(Math.min(5000, deadline - Date.now()));
    const shot = path.join(outDir, `wait-${Math.ceil((seconds * 1000 - (deadline - Date.now())) / 5000)}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    screenshots.push(shot);
  }

  await context.close();

  const summary = analyzeNetworkLog(logPath, screenshots);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ outDir, logPath, summaryPath, screenshots, summary }, null, 2));
}

export function analyzeNetworkLog(logPath, screenshots = []) {
  const lines = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split(/\n/).filter(Boolean) : [];
  const requests = [];
  const responses = [];
  for (const line of lines) {
    const item = JSON.parse(line);
    if (item.type === 'request') requests.push(item);
    if (item.type === 'response') responses.push(item);
  }

  const candidates = requests.map((request) => {
    const haystack = `${request.url}\n${request.postData || ''}`.toLowerCase();
    const matchedKeywords = KEYWORDS.filter((keyword) => haystack.includes(keyword.toLowerCase()));
    let score = matchedKeywords.reduce((sum, keyword) => sum + keywordWeight(keyword), 0);
    if (request.method === 'POST') score += 2;
    if (/\/h5\/mtop/i.test(request.url)) score += 10;
    return {
      id: request.id,
      score,
      method: request.method,
      url: request.url,
      resourceType: request.resourceType,
      matchedKeywords,
      hasPostData: Boolean(request.postData)
    };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  return {
    totalRequests: requests.length,
    totalResponses: responses.length,
    candidates: candidates.slice(0, 30),
    screenshots
  };
}

function keywordWeight(keyword) {
  if (keyword === '116576560' || keyword === 'zuiqingfeng' || keyword === '醉清风' || keyword === '签到') return 20;
  if (keyword === 'member' || keyword === 'vip' || keyword === 'sign') return 8;
  if (keyword === 'mtop') return 5;
  return 3;
}

function isTargetUrl(url) {
  return TARGET_HOST_KEYWORDS.some((keyword) => url.includes(keyword));
}

function appendJsonl(file, obj) {
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
}

function getArg(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function getAllArgs(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
