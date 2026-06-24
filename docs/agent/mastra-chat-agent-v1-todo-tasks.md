# BloomAI Mastra Chat Agent v1 Todo Tasks

## 1. 总览

目标：基于 `docs/agent/mastra-chat-agent-v1-implementation-design.md`，把 BloomAI 聊天窗快速接入 Mastra Agent。第一版使用 Mastra Agent 的 ReAct-style 工具循环，默认 `maxSteps = 10`，Agent 可以调用现有 `web_search` 工具，聊天 SSE 支持 tool call 事件，前端能渲染 roadmap 中的 Tool Call 卡片。

核心约束：

- 不自研 ReAct loop，使用 Mastra Agent 执行。
- `chat.route.ts` 只作为聊天入口，调用 Mastra chat agent adapter。
- `chat-agent.ts` 不写死模型，模型来自当前后台 `Settings -> Models` 配置，并优先尊重 persona/session override。
- Mastra tool 调用现有 `executeTool('web_search')`，不能绕过工具系统。
- v1 不新增 Agent 市场、team、workflow、AgentSpec 持久化表。
- v1 先跑通 chat -> Mastra Agent -> web_search -> SSE tool_call -> ToolCallCard -> assistant delta。

## 2. Todo Tasks

## Task 1: Mastra Agent 程序骨架、主要函数和接口实现、文件建立

**目标**

建立第一版 Mastra Agent 接入的后端骨架，让后续 task 可以在稳定文件和接口上继续填充。这个任务只搭骨架，不要求真实调用 web_search，也不要求 chat route 正式切换。

**要实现的功能**

- 新增 `src/server/agent` 目录作为 Agent 后端域。
- 新增 `src/server/agent/mastra` 子目录，承载 Mastra v1 adapter。
- 定义 Chat Agent v1 的主要接口和占位实现。
- 定义 chat agent 运行输入、输出事件、trace 摘要类型。
- 定义 `DEFAULT_AGENT_MAX_STEPS = 10`。
- 定义 `createChatAgent(model: string)` 函数骨架。
- 定义 `runChatAgentV1(input)` 函数骨架，先返回可测试的占位事件流。
- 定义 `mapMastraChunkToBloomEvent` 的函数签名和占位实现。
- 定义 `resolveMastraModel` 的函数签名和占位实现。

**修改或增加功能和文件**

新增：

- `src/server/agent/index.ts`
- `src/server/agent/mastra/types.ts`
- `src/server/agent/mastra/constants.ts`
- `src/server/agent/mastra/chat-agent.ts`
- `src/server/agent/mastra/chat-agent-runtime-adapter.ts`
- `src/server/agent/mastra/mastra-event-mapper.ts`
- `src/server/agent/mastra/model-map.ts`

可选新增测试：

- `src/server/agent/mastra/chat-agent-runtime-adapter.test.ts`
- `src/server/agent/mastra/model-map.test.ts`

**不修改功能和文件**

- 不修改 `src/server/routes/chat.route.ts`。
- 不修改 `src/server/tools/*`。
- 不修改 renderer 前端。
- 不安装或真实调用 Mastra 前不改动现有聊天行为。
- 不新增数据库表。

**测试策略：单元测试**

- `model-map.test.ts` 验证未知模型返回 unsupported 状态。
- `chat-agent-runtime-adapter.test.ts` 验证默认 `maxSteps` 为 10。
- `chat-agent-runtime-adapter.test.ts` 验证 adapter 输出事件类型结构稳定。

**可验收的关键节点**

- 所有新增文件存在。
- `src/server/agent/index.ts` 能导出 v1 adapter 类型和函数。
- `DEFAULT_AGENT_MAX_STEPS` 明确为 10。
- `createChatAgent(model)` 的函数签名不写死模型。
- `runChatAgentV1(input)` 已有可测试的 AsyncGenerator 骨架。

**验收清单**

- [x] `src/server/agent/mastra` 目录已创建。
- [x] 主要接口类型已定义。
- [x] `createChatAgent(model: string)` 已定义。
- [x] `runChatAgentV1` 已定义。
- [x] `DEFAULT_AGENT_MAX_STEPS = 10` 已定义。
- [x] 单元测试覆盖骨架接口。
- [x] `npm test -- src/server/agent/mastra` 通过。

---

## Task 2: 安装 Mastra 依赖并接入 Mastra Agent 创建逻辑

**目标**

引入 Mastra 依赖，让 Task 1 的 Agent 骨架变成真实 Mastra Agent 创建逻辑，但仍不接入 chat route。

**要实现的功能**

- 安装 `@mastra/core`。
- 如果 Mastra 当前版本需要额外 provider 包，按实际文档安装最小必要包。
- 在 `chat-agent.ts` 中使用 Mastra `Agent` 实现 `createChatAgent(model)`。
- Agent instructions 写入 v1 行为约束：需要当前信息、外部事实、链接或资料时可调用 `web_search`。
- `createChatAgent` 接收运行时传入的 model，不写死任何模型。
- `mastra-instance.ts` 如确实需要 Mastra 实例，则只注册 chat agent factory 或保留轻量实例。

**修改或增加功能和文件**

修改：

- `package.json`
- `package-lock.json`
- `src/server/agent/mastra/chat-agent.ts`

新增或补齐：

- `src/server/agent/mastra/mastra-instance.ts`
- `src/server/agent/mastra/chat-agent.test.ts`

**不修改功能和文件**

- 不修改 `chat.route.ts`。
- 不修改现有 LLM runtime。
- 不修改 `settings` 页面。
- 不修改 `src/server/tools`。
- 不修改前端聊天 UI。

**测试策略：单元测试**

- mock Mastra `Agent` 构造器，验证 `model` 来自函数参数。
- 验证 Agent 挂载 `web_search` tool 的占位引用或接口。
- 验证 instructions 包含 tool 使用约束。

**可验收的关键节点**

- 项目依赖安装后能通过 TypeScript 编译。
- `createChatAgent('some-model')` 创建 Agent 时使用传入 model。
- 文档中要求的“不写死模型”在代码中成立。

**验收清单**

- [x] `package.json` 包含 Mastra 依赖。
- [x] `package-lock.json` 更新。
- [x] `createChatAgent(model)` 使用真实 Mastra Agent。
- [x] Agent instructions 已实现。
- [x] 没有 `model: 'openai/gpt-4o-mini'` 这类硬编码默认模型。
- [x] `npm run typecheck` 通过。
- [x] 相关单元测试通过。

---

## Task 3: 将 BloomAI `web_search` 包装为 Mastra tool

**目标**

让 Mastra Agent 可以调用现有 `web_search` 工具，同时继续复用 BloomAI 工具系统的 enabled 状态、timeout、`tool_runs` 审计和错误记录。

**要实现的功能**

- 新增 Mastra `web_search` tool。
- 使用 zod 定义 input schema：`query: string`、`limit?: number`。
- output schema 兼容现有 `webSearchTool` 返回：`query`、`total`、`results`、`error`。
- `execute` 内部调用 `executeTool('web_search', input, sessionId)`。
- sessionId 通过 adapter 注入，不直接依赖全局状态。
- 不直接 import 并调用 `webSearchTool`。

**修改或增加功能和文件**

新增：

- `src/server/agent/mastra/bloomai-web-search.tool.ts`
- `src/server/agent/mastra/bloomai-web-search.tool.test.ts`

可能修改：

- `src/server/agent/mastra/chat-agent.ts`

**不修改功能和文件**

- 不修改 `src/server/tools/web-search.ts` 的搜索逻辑。
- 不修改 `src/server/tools/execute-tool.ts` 的执行流程。
- 不修改 `src/server/routes/tools.route.ts`。
- 不新增权限弹窗。

**测试策略：单元测试**

- mock `executeTool`，验证 tool execute 调用 `executeTool('web_search', { query, limit }, sessionId)`。
- 验证 query 为空时 schema 校验失败。
- 验证 output.results 能被前端 ToolCallCard 消费。

**可验收的关键节点**

- Mastra tool id 为 `web_search`。
- tool execute 经过 `executeTool`。
- sessionId 能进入工具执行上下文。

**验收清单**

- [ ] `bloomai-web-search.tool.ts` 存在。
- [ ] `createTool` 已使用。
- [ ] input / output schema 已定义。
- [ ] 内部调用 `executeTool('web_search')`。
- [ ] 不直接调用 `webSearchTool`。
- [ ] 单元测试通过。

---

## Task 4: 实现 Settings -> Models 到 Mastra model 的运行时映射

**目标**

保证 Mastra Agent 使用后台管理 `Settings -> Models` 中当前生效的模型值，并优先尊重 persona / session override，彻底避免 Agent 中写死模型。

**要实现的功能**

- 将当前聊天的模型解析逻辑抽出为可复用函数，或在 adapter 中复用等价逻辑。
- 模型优先级：persona override -> session model -> `Settings -> Models` 当前配置 -> fallback。
- 新增 `resolveMastraModel`，将 BloomAI model id 映射成 Mastra model 表达。
- 未支持模型返回明确错误或 fallback 指令。
- 保留 feature flag 控制是否回退旧 chat。

**修改或增加功能和文件**

新增或补齐：

- `src/server/agent/mastra/model-map.ts`
- `src/server/agent/mastra/model-map.test.ts`

可能修改：

- `src/server/routes/chat.route.ts` 中的模型解析函数导出或迁移到共享位置。
- `src/server/agent/mastra/chat-agent-runtime-adapter.ts`

**不修改功能和文件**

- 不修改 Settings UI。
- 不修改 `llm_models` 表结构。
- 不修改 LLM provider runtime。
- 不写死默认 Mastra 模型到 `chat-agent.ts`。

**测试策略：单元测试**

- persona override 优先于 session model。
- session model 优先于 settings model。
- settings model 可映射到 Mastra model。
- 未映射模型返回 unsupported。
- `createChatAgent` 接收到映射后的 model。

**可验收的关键节点**

- 后台设置的模型值实际进入 Mastra Agent。
- 代码中无硬编码默认 Agent model。
- 未支持模型有可读错误。

**验收清单**

- [ ] `resolveMastraModel` 已实现。
- [ ] 模型优先级与现有 chat 一致。
- [ ] `Settings -> Models` 当前值能影响 Mastra Agent。
- [ ] unsupported model 有测试覆盖。
- [ ] `chat-agent.ts` 不包含固定 model 字符串。

---

## Task 5: 实现 Mastra stream 到 BloomAI SSE 事件映射

**目标**

将 Mastra Agent 的 stream 输出转换为 BloomAI 聊天 SSE 事件，让后端可以发出 `tool_call_start / tool_call_result / tool_call_error / delta / done`。

**要实现的功能**

- 实现 `mapMastraChunkToBloomEvent`。
- 支持文本 delta -> `delta`。
- 支持 tool call start -> `tool_call_start`。
- 支持 tool result -> `tool_call_result`。
- 支持 tool error -> `tool_call_error`。
- 支持 usage -> `done.tokens` 或 trace。
- 生成稳定 `callId`，用于前端更新卡片。
- 对 Mastra chunk 类型不稳定做兼容：实时 chunk 优先，结束后用 `toolCalls/toolResults` 补齐。

**修改或增加功能和文件**

修改：

- `src/server/agent/mastra/mastra-event-mapper.ts`
- `src/server/agent/mastra/chat-agent-runtime-adapter.ts`

新增：

- `src/server/agent/mastra/mastra-event-mapper.test.ts`

**不修改功能和文件**

- 不修改前端 reducer。
- 不修改 `ToolCallCard`。
- 不修改 `executeTool`。
- 不改变旧 `delta / done / error` 事件含义。

**测试策略：单元测试**

- text chunk 映射为 `delta`。
- tool-call chunk 映射为 running 卡片数据。
- tool-result chunk 映射为 success 更新。
- tool error 映射为 error 更新。
- 未识别 chunk 被忽略或记录为 debug，不导致 stream 中断。

**可验收的关键节点**

- 后端能生成 tool call SSE 事件。
- 事件结构足够前端渲染 `ToolCallCard`。
- 旧文本流行为不破坏。

**验收清单**

- [ ] `tool_call_start` 事件包含 `callId/toolId/category/status/input`。
- [ ] `tool_call_result` 能通过 callId 找到对应卡片。
- [ ] `tool_call_error` 有错误信息。
- [ ] `delta` 行为保持兼容。
- [ ] event mapper 单元测试通过。

---

## Task 6: 接入 `chat.route.ts` feature flag，调用 Mastra Chat Agent v1

**目标**

让 `/api/v1/chat/stream` 在 feature flag 开启时调用 Mastra Agent v1，关闭或失败时可以回退旧 LLM chat 路径。

**要实现的功能**

- 增加读取 `settings.agent_runtime_enabled`。
- 增加读取 `settings.agent_runtime_provider = mastra`。
- 增加读取 `settings.agent_runtime_max_steps`，默认 10，上限 10。
- feature flag 开启时调用 `runChatAgentV1`。
- 将 `runChatAgentV1` 事件写成 SSE。
- 收集最终文本，保存 assistant message。
- 收集 tool trace，写入 `messages.tool_calls`。
- 关闭 feature flag 时保持旧 `streamChatCompletion` 行为。

**修改或增加功能和文件**

修改：

- `src/server/routes/chat.route.ts`
- `src/server/db/repositories/message.repo.ts`（如保存 tool_calls 需要类型补齐）
- `src/server/agent/mastra/chat-agent-runtime-adapter.ts`

测试：

- `src/server/routes/chat.route.test.ts`

**不修改功能和文件**

- 不改 sessions API。
- 不改 personas API。
- 不改 tools route。
- 不改前端 UI。
- 不新增 agent 数据库表。

**测试策略：单元测试**

- feature flag 关闭时走旧 LLM runtime。
- feature flag 开启时调用 `runChatAgentV1`。
- `maxSteps` 默认 10，超过 10 被截断。
- agent 事件转成 SSE。
- assistant message 保存 `content` 和 `tool_calls`。

**可验收的关键节点**

- 后端 chat route 可以走 Mastra Agent。
- fallback 路径仍可用。
- SSE 能看到 tool_call 事件。

**验收清单**

- [ ] `settings.agent_runtime_enabled` 生效。
- [ ] `settings.agent_runtime_provider = mastra` 生效。
- [ ] `maxSteps` 默认 10。
- [ ] route 测试覆盖 agent on/off 两条路径。
- [ ] assistant message 正常保存。
- [ ] tool trace 保存到 `messages.tool_calls`。

---

## Task 7: 前端 API 与 ChatStore 支持 tool_call 事件

**目标**

让前端能消费后端新 SSE 事件，并在 store 中维护 tool call running / success / error 状态。

**要实现的功能**

- 扩展 `platform.chatStream` 返回事件类型。
- `useChatStore` 增加 `toolCallsBySession` 或等价状态。
- 处理 `tool_call_start`：新增 running call。
- 处理 `tool_call_result`：更新为 success 并写入 output。
- 处理 `tool_call_error`：更新为 error。
- 发送下一条消息时清理上一轮 streaming tool calls。
- 保持 `delta/done/error` 原行为。

**修改或增加功能和文件**

修改：

- `src/renderer/api/index.ts`
- `src/renderer/store/index.ts`

测试：

- `src/renderer/store/index.test.ts` 或新建 `src/renderer/pages/Chat/chat-tool-events.test.ts`

**不修改功能和文件**

- 不修改后端。
- 不修改 `ToolCallCard` 视觉。
- 不渲染历史 `messages.tool_calls`。
- 不新增权限弹窗。

**测试策略：单元测试**

- reducer 收到 `tool_call_start` 后有 running call。
- reducer 收到 `tool_call_result` 后状态为 success。
- reducer 收到 `tool_call_error` 后状态为 error。
- 多个 tool call 顺序稳定。
- delta 仍累积 streamingText。

**可验收的关键节点**

- 前端状态层能完整表达工具卡片生命周期。
- 旧聊天文本流不回退。

**验收清单**

- [ ] `platform.chatStream` 类型包含 tool call 事件。
- [ ] `useChatStore` 保存 tool call 状态。
- [ ] running -> success 状态可测。
- [ ] running -> error 状态可测。
- [ ] 现有 chat store 测试不破坏。

---

## Task 8: Timeline 渲染 ToolCallCard

**目标**

在聊天时间线里展示 Mastra Agent 调用 `web_search` 的工具卡片，符合 roadmap 中“对话中的 Tool Call 卡片”running / success / error 体验。

**要实现的功能**

- `ChatPanel` 将当前 session 的 streaming tool calls 传给 `Timeline`。
- `Timeline` 在 streaming assistant bubble 前渲染 `ToolCallCard`。
- `ToolCallCard` 增加 `callId` 支持。
- `ToolCallCard` 保持三态：running / success / error。
- `web_search` success 状态展示 Top 3 搜索结果、URL、snippet。
- 修正当前乱码图标问题，使用 lucide 图标或纯文本 category。

**修改或增加功能和文件**

修改：

- `src/renderer/pages/Chat/ChatPanel.tsx`
- `src/renderer/pages/Chat/Timeline.tsx`
- `src/renderer/pages/Chat/ToolCallCard.tsx`
- `src/renderer/styles/global.css`（如需要样式微调）

测试：

- `src/renderer/pages/Chat/Timeline.test.tsx` 或现有 ChatPanel 测试扩展
- `src/renderer/pages/Chat/ToolCallCard.test.tsx`

**不修改功能和文件**

- 不修改后端 SSE。
- 不渲染历史 `tool_calls`。
- 不新增 Agent StepCard。
- 不做 Agent 市场 UI。

**测试策略：单元测试**

- Timeline 有 running tool call 时渲染 ToolCallCard。
- ToolCallCard success 时展示 Top 3 results。
- ToolCallCard error 时展示 error 文案。
- streaming assistant text 仍正常显示。

**可验收的关键节点**

- 用户输入触发 search 时，UI 先看到 `web_search` running 卡片。
- 工具返回后卡片变 Done。
- 结果摘要不超过 Top 3。

**验收清单**

- [ ] `Timeline` 支持 tool call items。
- [ ] `ToolCallCard` 有 callId。
- [ ] running/success/error 三态可见。
- [ ] web_search 结果摘要展示正确。
- [ ] 图标或 category 无乱码。
- [ ] 相关前端测试通过。

---

## Task 9: 后端端到端测试 Mastra chat agent SSE 流

**目标**

用后端集成测试证明 `/api/v1/chat/stream` 能输出 tool call 事件、assistant delta、done，并保存消息与 trace。

**要实现的功能**

- mock Mastra Agent stream。
- mock `executeTool` 或 web_search tool 输出。
- POST `/api/v1/chat/stream`。
- 收集 SSE 数据。
- 验证事件顺序包含 tool call 和 delta。
- 验证 messageRepo 保存 assistant content。
- 验证 `messages.tool_calls` 保存 trace。

**修改或增加功能和文件**

新增或修改：

- `src/server/routes/chat.route.test.ts`
- `src/server/agent/mastra/chat-agent-runtime-adapter.test.ts`

**不修改功能和文件**

- 不修改生产逻辑，除非测试发现前序 task 缺陷。
- 不接真实网络搜索。
- 不依赖真实 Mastra provider API key。

**测试策略：单元测试**

- 本 task 以集成测试为主；必要时补 adapter 单元测试。

**可验收的关键节点**

- 测试不依赖外部网络。
- SSE 事件顺序稳定。
- trace 持久化可断言。

**验收清单**

- [ ] 后端测试覆盖 `tool_call_start`。
- [ ] 后端测试覆盖 `tool_call_result`。
- [ ] 后端测试覆盖 `delta`。
- [ ] 后端测试覆盖 `done`。
- [ ] 测试验证 `messages.tool_calls`。
- [ ] `npm test -- src/server/routes/chat.route.test.ts src/server/agent/mastra` 通过。

---

## Task 10: 手动验收与回归检查

**目标**

确认 v1 从用户视角可用：聊天框输入请求，Mastra Agent 调用 `web_search`，UI 显示 ToolCallCard，最终回答流式输出。

**要实现的功能**

- 配置 feature flag 开启 Mastra Agent。
- 配置后台 `Settings -> Models` 为可映射模型。
- 启动应用。
- 输入搜索类 prompt。
- 验证工具卡片、回答、数据库记录。
- 再输入普通聊天 prompt，验证不强制调用工具。

**修改或增加功能和文件**

可能新增：

- `docs/agent/mastra-chat-agent-v1-verification.md`

**不修改功能和文件**

- 不新增功能。
- 不做 UI 大改。
- 不接入更多工具。
- 不新增 Agent market / team / workflow。

**测试策略：单元测试**

- 本 task 不新增单元测试，依赖前序测试。
- 如发现 bug，回到对应 task 补测试。

**可验收的关键节点**

- 搜索请求能看到 ToolCallCard。
- ToolCallCard 能从 running 变 success。
- assistant 最终回答出现。
- `tool_runs` 有 web_search 成功记录。
- `messages.tool_calls` 有 trace。
- 普通聊天仍可用。

**验收清单**

- [ ] `npm run typecheck` 通过。
- [ ] `npm test` 或相关测试集合通过。
- [ ] 手动搜索 prompt 通过。
- [ ] 手动普通聊天 prompt 通过。
- [ ] feature flag 关闭后旧 chat 路径可用。
- [ ] 记录验收证据到 verification 文档。

## 3. Checkpoints

### Checkpoint A: 后端骨架完成（Task 1-4）

- [ ] Mastra 依赖可编译。
- [ ] Agent v1 骨架存在。
- [ ] web_search Mastra tool 包装完成。
- [ ] Settings -> Models 模型映射完成。
- [ ] 后端基础单元测试通过。

### Checkpoint B: SSE Agent 链路完成（Task 5-6）

- [ ] Mastra stream 可映射为 BloomAI SSE。
- [ ] chat route 可通过 feature flag 调用 agent。
- [ ] 旧 chat fallback 仍可用。
- [ ] assistant message 和 tool trace 可保存。

### Checkpoint C: 前端可视化完成（Task 7-8）

- [ ] ChatStore 支持 tool call 状态。
- [ ] Timeline 渲染 ToolCallCard。
- [ ] ToolCallCard 展示 web_search Top 3 结果。
- [ ] 旧文本流 UI 不回退。

### Checkpoint D: v1 完成（Task 9-10）

- [ ] 后端集成测试通过。
- [ ] 前端相关测试通过。
- [ ] 手动搜索验收通过。
- [ ] 手动普通聊天验收通过。
- [ ] 验收证据已记录。

## 4. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Mastra stream chunk 类型与预期不同 | tool_call 实时卡片可能延迟 | 先用 `fullStream/onChunk`，结束后用 `toolCalls/toolResults` 补齐 |
| 当前 Settings 模型无法映射 Mastra | Agent 无法启动 | 返回友好错误，或 feature flag 回退旧 chat |
| Mastra 依赖引入导致 build 问题 | 阻塞开发 | Task 2 独立验证依赖和 typecheck |
| ToolCallCard 历史渲染复杂 | v1 范围膨胀 | v1 只做 streaming tool call，历史渲染后续 task |
| 权限弹窗范围膨胀 | 阻塞 v1 | v1 只挂 `web_search`，network 默认放行 |

## 5. 不在 v1 范围

- AgentSpec 数据库持久化。
- Agent market。
- Multi-agent team。
- Agent workflows。
- 历史消息中的 ToolCallCard 完整回放。
- write / shell 工具权限弹窗。
- 多工具挂载。
- DeepSeek、Agnes、Ollama 的完整 Mastra model mapping。

可以并行，但要先完成 **Task 1**。它是共同骨架，后面多数 task 都依赖它。

## 6. 并行的任务

**必须顺序执行**

1. **Task 1**：Mastra Agent 骨架
   所有后续任务的接口和文件边界都依赖它。
2. **Task 2 -> Task 3 -> Task 5 -> Task 6** 这条后端主链建议顺序：
   - Task 2：安装 Mastra + Agent 创建
   - Task 3：包装 `web_search`
   - Task 5：Mastra stream 映射 SSE
   - Task 6：`chat.route.ts` 接入 feature flag
3. **Task 7 -> Task 8** 前端主链建议顺序：
   - Task 7：ChatStore 先能接收 tool_call 状态
   - Task 8：Timeline 才能渲染 ToolCallCard

**可以并行**
在 Task 1 完成后：

- **Task 2 和 Task 4 可以并行**
  - Task 2 做 Mastra Agent 创建
  - Task 4 做 `Settings -> Models` 到 Mastra model 的映射
  - 两者最后在 adapter 里汇合
- **Task 3 和 Task 4 可以并行**
  - Task 3 包装 `web_search`
  - Task 4 做模型映射
  - 两者互不依赖
- **Task 5 和 Task 7 可以部分并行**
  - Task 5 定义后端 SSE 事件映射
  - Task 7 做前端 ChatStore reducer
  - 前提是先约定事件 contract：`tool_call_start / tool_call_result / tool_call_error / delta / done`
- **Task 8 可以在 Task 7 的类型和状态结构稳定后并行推进**
  - 如果 ToolCallData 结构已定，UI 可先用 mock 数据开发
- **Task 9 的测试准备可以并行**
  - 可以先写 mock stream、测试 scaffolding
  - 但最终断言要等 Task 5/6 完成

**最后收口**

- Task 10 必须最后做
  - 它依赖后端、前端、测试链路都完成。

推荐并行批次：

```
Batch 1:
  Task 1

Batch 2:
  Task 2
  Task 3
  Task 4

Batch 3:
  Task 5
  Task 7
  Task 8 mock UI 部分

Batch 4:
  Task 6
  Task 8 final integration
  Task 9

Batch 5:
  Task 10
```
