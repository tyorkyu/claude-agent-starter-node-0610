# Claude Agent Starter

一个跑在 EdgeOne Makers 上的全栈 Agent 模板：基于 Claude Agent SDK 的流式聊天，通过 MCP 桥接 EdgeOne 沙箱工具，会话记忆持久化在 `context.agent.store`。

**Framework：** Claude Agent SDK · **Category：** Quick Start <!-- TODO: confirm --> · **Language：** TypeScript

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/makers/new?template=claude-agent-starter-node&from=within&fromAgent=1&agentLang=typescript)

<!-- ![preview](./assets/preview.png)  TODO: confirm -->

## 概述

一个最小但贴近生产形态的 Claude Agent SDK + EdgeOne Makers 模板。完整跑通了流式响应、沙箱工具调用、会话存储这条链路，方便你直接 fork，把精力放在替换 Prompt 和工具上，而不是搭水管。

- **SSE 流式聊天** —— 逐 token 推 `text_delta`，命中工具时推 `tool_called`。
- **沙箱工具走 MCP** —— `commands` / `files` / `code_interpreter` / `browser` 通过 `context.tools.toClaudeMcpServer()` 一次性变成 MCP Server 暴露给 Claude。
- **会话粘性记忆** —— `context.agent.store.claude_session_store()` 保存 Claude transcript；用户 / 助手消息再用 `store.appendMessage()` 镜像一份，便于回放与历史展示。
- **双重取消** —— 前端 `AbortController` + 后端 `context.utils.abortActiveRun()`，`/stop` 真正释放上游 LLM 连接。
- **后端拆两层** —— 有状态的长连接放 `agents/`，无状态的 CRUD 放 `cloud-functions/`，避免历史 / 列表 / 删除请求与活跃聊天抢同一会话的锁。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | 是 | 模型网关 API Key。可填 Makers Models 的 API Key，也可以是任意 OpenAI 兼容服务商的 Key。 |
| `AI_GATEWAY_BASE_URL` | 是 | 网关 Base URL。Makers Models 请使用 `https://ai-gateway.edgeone.link/v1`。 |
| `AI_GATEWAY_MODEL` | 否 | 模型 ID。默认 `@makers/deepseek-v4-flash`（内置免费模型）。 |
| `WSA_API_KEY` | 否 | 腾讯云 Web Search API Key。仅在使用联网搜索工具时需要，详见[如何获取 `WSA_API_KEY`](#如何获取-wsa_api_key)。 |

模板遵循 OpenAI 兼容协议，可以指向 Makers Models，也可以指向任意 OpenAI 兼容的服务商。

### 如何获取 `AI_GATEWAY_API_KEY`

1. 打开 [Makers 控制台](https://console.cloud.tencent.com/edgeone/makers)。
2. 登录并开通 Makers。
3. 进入 **Makers → Models → API Key**，新建一个 Key。
4. 把它粘到 `AI_GATEWAY_API_KEY`。

内置的 `@makers/deepseek-v4-flash` 免费但有用量限制，适合验证；生产建议自行绑定付费厂商（BYOK）。

### 如何获取 `WSA_API_KEY`

`WSA_API_KEY` 仅在调用联网搜索工具时需要。前往 [腾讯云 Web Search Agent 产品页](https://cloud.tencent.com/product/wsa) 申请开通，将下发的 Key 填入 `WSA_API_KEY` 即可。

### Provider fallbacks

`agents/_model.ts` 同时也会读取 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_CUSTOM_HEADERS`，方便直连 Anthropic API。两套都填的情况下，AI_GATEWAY 网关变量优先生效。可用 `CLAUDE_MODEL`（或 `AI_GATEWAY_MODEL`）覆盖默认模型，用 `ANTHROPIC_SMALL_FAST_MODEL` / `AI_GATEWAY_SMALL_MODEL` 覆盖 SDK 内部子调用使用的小模型。

## 本地开发

前置依赖：Node.js ≥ 18，已安装 EdgeOne CLI（`npm i -g edgeone`）。

```bash
npm install
cp .env.example .env       # 然后填入 AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL
edgeone makers dev
```

本地观测面板：`http://localhost:8080/agent-metrics`。

## 项目结构

```text
claude-agent-starter/
├── agents/                          # 有状态的 EdgeOne Makers Agent Functions（Node/TS）
│   ├── chat/index.ts               # POST /chat —— SSE 流式聊天
│   ├── stop/index.ts               # POST /stop —— 中断当前 agent
│   ├── _model.ts                   # 模型与网关环境变量（私有）
│   └── _logger.ts                  # 日志工具（私有）
├── cloud-functions/                 # 无状态的 EdgeOne Pages Node Functions
│   ├── history/index.ts            # POST /history —— 拉取对话消息
│   ├── conversations/index.ts      # POST /conversations —— 列出某用户的会话
│   ├── clear-history/index.ts      # POST /clear-history —— 清空某会话的消息
│   ├── delete-conversation/index.ts # POST /delete-conversation —— 彻底删除某会话
│   ├── _logger.ts                  # 日志工具
│   └── _redact.ts                  # 日志敏感字段脱敏
├── src/                             # React + Vite + TypeScript 前端
│   ├── App.tsx                     # conversation_id 管理 + SSE 流编排
│   ├── api.ts                      # /chat、/stop、/history 等接口封装与 SSE 解析
│   └── components/                 # ChatWindow、ChatInput、CodeViewer、ToolIndicators 等
├── package.json                     # 项目依赖（含 Claude Agent SDK）
├── edgeone.json                     # EdgeOne 部署配置
├── .env.example                     # 环境变量模板
├── vite.config.ts
├── tsconfig.json
└── index.html
```

> 以 `_` 开头的文件是私有模块，不会暴露为公开路由。

## 资源

- [EdgeOne Makers Agents 文档](https://pages.edgeone.ai/document/agents)
- [EdgeOne Makers 快速开始](https://pages.edgeone.ai/document/agents-quickstart)
- [Makers Models](https://pages.edgeone.ai/document/models)

## License

MIT.
