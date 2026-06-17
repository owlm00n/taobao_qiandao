# taobao_qiandao

淘宝 / 天猫店铺会员签到辅助脚本。

当前目标店铺：**醉清风旗舰店**

- 店铺 URL: <https://zuiqingfeng.tmall.com/shop/view_shop.htm?shop_id=116576560>
- `shop_id`: `116576560`

> 重要：醉清风旗舰店的签到入口目前只在手机淘宝 App 的会员页面出现。淘宝 App 内的签到大概率通过 MTOP 请求完成，包含动态签名、设备指纹、风控参数。本仓库不会保存淘宝账号密码，也不建议提供账号密码。

## 当前实现状态

本项目已实现一个“抓包请求重放”骨架：

1. 你在手机淘宝 App 的醉清风会员页手动点击一次签到，并用抓包工具导出请求；
2. 将请求保存为本地 JSON；
3. 脚本读取 JSON，重放该签到请求；
4. 根据响应判断签到是否成功、是否登录过期、是否触发风控。

如果后续确认请求可稳定重放，再把字段抽象成更长期的配置；如果无法重放，则需要退回 Appium / uiautomator2 真机 UI 自动化。

## 目录结构

```text
src/
  cli.js                 # 命令入口
  request-loader.js      # 读取和校验抓包请求 JSON
  signin-runner.js       # HTTP 请求重放与响应归一化
  stores/zuiqingfeng.js  # 醉清风店铺适配配置
config/
  zuiqingfeng.request.example.json # 抓包 JSON 模板
test/
  request-loader.test.js # 基础单元测试
```

## 准备抓包 JSON

复制模板：

```bash
cp config/zuiqingfeng.request.example.json config/zuiqingfeng.request.json
```

然后把手机淘宝 App 里点击“签到”时抓到的请求填进去。

推荐抓包工具：Reqable、Charles、mitmproxy、Quantumult X、Surge。

需要抓取的信息：

- `method`: 通常是 `POST`
- `url`: 例如 `https://acs.m.taobao.com/h5/.../1.0/` 或 `https://h5api.m.taobao.com/h5/.../1.0/`
- `headers`: 完整请求头，尤其是 `cookie`、`user-agent`、`x-*`、`referer`、`origin`
- `body`: 请求体，可以是字符串或对象

敏感提醒：

- Cookie / token 等同登录凭证，请只放在本地 `config/*.request.json`，不要提交到 Git。
- `.gitignore` 已默认忽略 `config/*.request.json`。

## Quantumult X 导出目录分析

如果你从 Quantumult X 导出的是一个包含 `basic`、`request_headers`、`request_body`、`response_body` 的目录，可以用：

```bash
node src/qx-extract.js captures/2026-06-18-003452
```

工具会对每条请求打分并脱敏输出，帮助判断是否真的抓到了醉清风签到请求。真正有价值的请求通常会命中：`116576560`、`zuiqingfeng`、`member`、`sign`、`mtop`、`acs.m.taobao.com` 或 `h5api.m.taobao.com`。

## 从 HAR 自动提取候选请求

如果你导出了 Charles / Reqable / mitmproxy 的 HAR 文件，可以先让工具自动筛选疑似淘宝签到请求：

```bash
node src/har-extract.js capture.har --output config/zuiqingfeng.request.json
```

工具会按域名、`mtop`、`member/sign`、`shopId=116576560` 等特征打分，输出候选列表，并把最高分请求写成脚本可重放的 JSON。写出后请人工核对一次 URL、headers、body 是否确实来自“点击签到”。

## 运行

```bash
npm test
node src/cli.js zuiqingfeng --request config/zuiqingfeng.request.json
# 或
npm run signin:zuiqingfeng -- --request config/zuiqingfeng.request.json
```

可选参数：

```bash
node src/cli.js zuiqingfeng \
  --request config/zuiqingfeng.request.json \
  --dry-run
```

`--dry-run` 只校验和打印脱敏请求摘要，不会真正发起签到请求。

## 抓包建议

手机淘宝路径通常类似：

```text
手机淘宝 App → 我的淘宝 → 会员/店铺会员 → 醉清风旗舰店 → 签到
```

也可以从店铺首页进入会员页：

```text
淘宝 App 搜索/打开 醉清风旗舰店 → 店铺会员/会员中心 → 签到
```

重点关注域名：

- `acs.m.taobao.com`
- `h5api.m.taobao.com`
- `*.taobao.com`
- `*.tmall.com`

## 结果判断

脚本会尝试从响应中识别：

- 成功：`SUCCESS`、`签到成功`、`已签到`、`success: true`
- 登录失效：`Session expired`、`FAIL_SYS_SESSION_EXPIRED`、`令牌过期`
- 风控：`x5sec`、`验证码`、`滑块`、`人机验证`

但具体字段必须以真实抓包响应为准。

## 合规与风险

本项目仅用于个人学习和自用自动化研究。淘宝/天猫可能禁止自动化操作，异常请求可能触发验证码、短信验证、账号限制等风险。请不要批量、多账号、高频调用。
