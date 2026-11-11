# xread

X 公开帖子只读中继（Cloudflare Pages + `_worker.js`）。服务端抓 `api.fxtwitter.com`（无长文时转 `api.vxtwitter.com` 预览兜底），只读公开数据，不登录、不带 Cookie。

## 接口

| 方式 | 地址 | 说明 |
|---|---|---|
| 纯文本 | `GET /?url=<X帖子链接>` 或 `/?u=<用户名>&id=<帖子ID>` | 人或普通抓取器直接打开即读全文 |
| JSON API | `GET /api/read?url=<X帖子链接>` | 结构化返回：作者/数据/标题/段落（含类型）/全文 |
| MCP | `POST /mcp` | 无状态 MCP（JSON-RPC over Streamable HTTP），工具：`read_x_post`、`search`、`fetch`（均只读标注） |
| OpenAPI | `GET /openapi.json` | 供 Custom GPT Actions 导入的模式（备选路径） |

安全：服务端只请求由「用户名/帖子 ID」拼出的镜像接口地址，绝不抓取调用方传入的任意 URL（不是开放代理）；帖子结果经 Cache API 缓存 600 秒；`/api/read` 与 `/mcp` 有每 IP 限流（120 次 / 10 分钟，隔离级尽力而为）。

## 在 ChatGPT 里使用（推荐：MCP 连接器，日常对话可用）

1. ChatGPT 网页版 → 设置 → 「安全与登录」→ 开启 **Developer mode（开发者模式）**（Plus/Pro 等付费 plan 才有；部分账号默认已开）。
2. 打开 chatgpt.com/plugins → 点 **+（Add）** → **Create MCP App**。
3. 名称填 `X Read`；Connection 选 Server URL，填 `https://xread.madebyyong.com/mcp`；**Authentication 选 No Authentication**；创建。
4. 任意普通对话里，点输入框 **+ 菜单 → Developer mode → 勾选 X Read**，之后把 X 帖子链接发给它即可读全文并分析/写评论。

备选（Custom GPT Actions）：新建一个 Custom GPT，在 Actions 里导入 `https://xread.madebyyong.com/openapi.json`（Authentication: None）——缺点是只能在那个 GPT 里用。

## 部署

GitHub 仓库 `wyyq-ljy/x-read`，Cloudflare Pages 项目 `x-read`（Git 集成，push 到 main 自动部署），自定义域 `xread.madebyyong.com`。
