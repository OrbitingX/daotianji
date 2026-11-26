# oneday-jiegua — 盗天机 AI 解读后端

轻量 AI 解读服务：把各占卜工具算好的结果发给 Gemini 模型，返回一段简短解读。
替代了原来走 agy 完整 agent 的路子（大炮打蚊子），一次 API 调用搞定。

## 结构

- `jiegua.py` — 唯一后端文件，Python 标准库 only（http.server + urllib + json），无第三方依赖。
- `state.json` — 每日调用计数（自动生成），用于 400 次/天封顶，重启不丢失。
- `../js/ai-jiegua.js`（在线上是 `/js/ai-jiegua.js`）— 各工具页共用的“AI 解读”按钮逻辑。

## 调用链

浏览器 → Nginx `https://oneday.vitaglint.com/api/jiegua`
→ 本服务 `127.0.0.1:8091`
→ 本地 AIRI Gemini 代理 `127.0.0.1:8083/v1/chat/completions`
→ Google Gemini API（模型 gemini-3.5-flash-lite）

**密钥不在本服务里。** 代理负责注入 Bearer key，本服务不读、不存、不打、不含任何 key。
本服务只与 127.0.0.1 通信，不含任何内网地址与密钥。

## 接口

`POST /api/jiegua`

请求：`{"tool": "<slug>", "summary": "占卜结果纯文本（≤4000字）", "question": "可选（≤500字）", "lang": "zh-CN|zh-TW|en|ja"}`

返回：`{"interpretation": "..."}` 或 `{"error": "..."}`

## 限流（用户终版，2026-11-25）

上游 key 是免费档（500 次/天），所以：

- 白名单不限量：198.3.31.114（用户住宅 IP）与 129.80.151.214（A1），不计入全站额度。
- 非白名单：每 IP 每天最多 1 次成功调用；全站非白名单合计每天最多 30 次成功调用（环境变量 `JIEGUA_DAILY_CAP` 可改，默认 30）。
- 只计成功的调用（返回解读的才算）。超了返回 429（“今日免费 AI 解读已用完，请明天再试”）。
- 访客 IP 按 `CF-Connecting-IP` 取（站前有 Cloudflare），依次回落到 `X-Forwarded-For` 首项、`X-Real-IP`、直连 IP。
- 计数持久化在 `state.json`（按日期分，重启不丢失；跨天自动清零）。
- summary/question 缺失或超长返回 400。

前端成功调用后在 localStorage 记 `daotianji-ai-used`（当天日期），按钮显示“今日已用”——只是提示，后端 IP 计数才是真正的 enforcement。

日志只记状态和工具名，不记请求内容，不记 key。

## 运行

systemd 服务 `oneday-jiegua.service`（ubuntu 用户运行，失败自动重启）：

```
systemctl status oneday-jiegua
systemctl restart oneday-jiegua
journalctl -u oneday-jiegua -f
```

Nginx 在 `oneday.vitaglint.com` 的 server 块里把 `/api/jiegua` 反代到
`http://127.0.0.1:8091`（见 `/etc/nginx/sites-enabled/vitaglint`）。

## 开源说明

本目录会随站点一起开源（GPL-3.0），里面不含任何密钥、token、内网地址。
