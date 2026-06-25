# BloomAI LLM Response Contract v1 设计文档

## 1. 文档信息

- 日期：2026-06-25
- 状态：v1 设计稿
- 范围：统一大模型直接回复、Agent 运行回复、前端 Chat Timeline 渲染协议
- 目标目录：`src/shared`、`src/server/llm`、`src/server/agent`、`src/server/routes/chat.route.ts`、`src/renderer/pages/Chat`

## 2. 背景

BloomAI 当前已经有两条 LLM 输出链路：

1. Chat 直接调用 LLM provider runtime。
   - 后端类型在 `src/server/llm/types.ts`。
   - 当前流式事件是 `delta / usage / done`。
   - 前端把 `delta.text` 累积成一个 assistant message。

2. Chat 通过 Mastra Agent Runtime 调用 LLM 和工具。
   - 后端类型在 `src/server/agent/mastra/types.ts`。
   - 当前流式事件是 `delta / tool_call_start / tool_call_result / tool_call_error / done / error`。
   - 前端把正文渲染成 `MessageBubble`，把工具调用渲染成 `ToolCallCard`。

这两条链路已经在行为上接近统一，但协议仍然分散在不同模块：

- `src/server/llm` 只知道 provider delta。
- `src/server/agent/mastra` 定义了 agent tool call 事件。
- `src/server/routes/chat.route.ts` 手动把不同事件转成 SSE。
- `src/renderer/store/index.ts` 手动处理 chat stream chunk。
- `src/renderer/pages/Chat/Timeline.tsx` 把 streaming text 和 tool calls 分开渲染。

随着后续支持 AgentSpec、workflow、artifact、image/video、引用来源、权限确认和消息回放，如果继续让每条链路各自定义回复格式，前端会越来越难维护，后端也会产生重复适配层。

因此 v1 需要建立一套统一契约：**BloomAI LLM Response Contract**。

## 3. 目标

v1 的目标是定义一套稳定、可扩展、前后端共享的大模型回复规范，让以下调用路径使用同一种输出协议：

- Chat 直接调用 LLM。
- Chat 调用 Agent，Agent 再调用 LLM 和工具。
- 未来独立 Agent Run 调用 LLM 和工具。
- 未来 workflow step 调用 LLM、工具或生成 artifact。

具体目标：

1. 统一流式事件名称和字段。
2. 统一最终消息的内容块结构。
3. 统一前端 Timeline 的渲染输入。
4. 统一工具调用、usage、trace、error 的表达方式。
5. 保持当前 `delta / tool_call_* / done` 协议可兼容迁移。
6. 不把 Mastra、OpenAI、Anthropic 等第三方内部结构暴露给 renderer 或数据库。

## 4. 非目标

v1 不解决以下问题：

- 不实现完整 AgentSpec / workflow / team 数据模型。
- 不强制所有 provider 支持原生 tool calling。
- 不要求一次性重写 Chat UI。
- 不要求迁移已有数据库 schema。
- 不保存完整 RuntimeEvent 回放日志。
- 不设计复杂 artifact 编辑器。
- 不替代 `src/server/agent` 里的 Agent Runtime 长期架构。

v1 是协议底座，重点是先把回复内容和 UI 渲染语义统一。

## 5. 核心决策

### 5.1 使用内容块而不是单一字符串

当前 `messages.content` 是 assistant 最终文本，适合普通 chat，但不适合表达工具调用、引用、文件、图片和中间步骤。

v1 采用 `ResponseContentBlock[]` 表达一次 assistant 回复。文本只是其中一种 block：

```ts
type ResponseContentBlock =
  | MarkdownBlock
  | ToolCallBlock
  | ArtifactBlock
  | CitationBlock
  | ErrorBlock
```

为了兼容当前数据库，v1 仍然把最终 assistant 可读文本保存到 `messages.content`，把非文本结构以 trace 摘要形式保存到 `messages.tool_calls`。未来可以新增 `messages.blocks_json` 或 `response_blocks` 表。

### 5.2 使用统一流式事件驱动 UI

v1 不再让前端分别理解 “LLM delta” 和 “Agent tool call event”。后端统一输出 `ResponseStreamEvent`：

```ts
type ResponseStreamEvent =
  | ResponseStartedEvent
  | ContentBlockStartedEvent
  | ContentDeltaEvent
  | ContentBlockCompletedEvent
  | ToolCallStartedEvent
  | ToolCallDeltaEvent
  | ToolCallCompletedEvent
  | ToolCallFailedEvent
  | UsageUpdatedEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent
```

Chat route 可以在过渡期继续发送旧事件，但推荐新增 mapper，让所有旧事件先映射成 v1 事件，再进入前端 store。

### 5.3 让 UI 组件消费稳定 view model

前端不直接消费 provider event、Mastra chunk、tool raw output。前端只消费 contract 规约后的 Timeline item：

```ts
type ChatTimelineItem =
  | { type: 'message'; message: MessageViewModel }
  | { type: 'streaming_message'; responseId: string; blocks: ResponseContentBlock[] }
  | { type: 'tool_call'; block: ToolCallBlock }
  | { type: 'error'; block: ErrorBlock }
```

`MessageBubble`、`ToolCallCard` 等组件只依赖这些 view model。

### 5.4 保持字段可加不可破坏

v1 契约遵循加法演进：

- 新增字段必须是 optional。
- 已有字段不改名、不换类型、不移除。
- enum 新值需要前端有 fallback 渲染。
- renderer 不依赖事件顺序之外的隐藏实现细节。

## 6. 命名约定

TypeScript 字段使用 camelCase。

事件 `type` 使用 lower_snake_case，与当前 SSE 习惯保持一致。

状态字段使用 lower_snake_case：

```ts
type ResponseStatus = 'running' | 'completed' | 'failed' | 'cancelled'
type BlockStatus = 'pending' | 'streaming' | 'completed' | 'failed'
type FinishReason = 'stop' | 'length' | 'tool_limit' | 'error' | 'cancelled' | 'unknown'
```

ID 字段保持字符串：

```ts
type ResponseId = string
type BlockId = string
type ToolCallId = string
type RunId = string
type SessionId = string
```

v1 不强制 branded type，但实现时可以在 `src/shared/schemas` 内部逐步引入。

## 7. 分层架构

```text
Provider Raw Stream
  OpenAI / Anthropic / DeepSeek / Agnes / Ollama / Mastra
        |
        v
Provider Adapter
  src/server/llm/providers/*
  src/server/agent/mastra/*
        |
        v
BloomAI Response Contract
  src/shared/schemas/response.ts
        |
        v
Chat SSE Mapper
  src/server/routes/chat.route.ts
        |
        v
Renderer Stream Reducer
  src/renderer/store/index.ts
        |
        v
Timeline View Model
  src/renderer/pages/Chat/Timeline.tsx
```

边界原则：

- Provider adapter 负责把第三方输出转成 BloomAI contract。
- Chat route 不理解 provider 细节，只转发 contract event。
- Renderer 不理解 provider 或 Mastra 结构，只理解 Timeline view model。
- 数据库保存最终用户可读文本和 trace 摘要，不保存第三方 raw chunk。

## 8. 核心类型设计

建议新增文件：

```text
src/shared/schemas/response.ts
```

并从 `src/shared/schemas/index.ts` 导出。

### 8.1 ResponseEnvelope

`ResponseEnvelope` 表示一次 assistant 回复的最终快照。

```ts
export type ResponseEnvelope = {
  schemaVersion: 'bloom-response-v1'
  responseId: string
  sessionId?: string
  messageId?: string
  role: 'assistant'
  status: ResponseStatus
  blocks: ResponseContentBlock[]
  usage?: TokenUsage
  trace?: ResponseTrace
  error?: ResponseError
  createdAt: number
  completedAt?: number
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `schemaVersion` | 固定为 `bloom-response-v1`，用于未来迁移 |
| `responseId` | 一次回复的稳定 ID，streaming 和 final snapshot 使用同一个 |
| `sessionId` | chat 场景所属 session |
| `messageId` | 持久化后的 message id，streaming 期间可以没有 |
| `role` | v1 只规范 assistant 输出 |
| `status` | 当前回复状态 |
| `blocks` | 内容块列表 |
| `usage` | token 用量 |
| `trace` | runtime trace 摘要 |
| `error` | 回复失败原因 |
| `createdAt` | 创建时间 |
| `completedAt` | 完成时间 |

### 8.2 ResponseContentBlock

```ts
export type ResponseContentBlock =
  | MarkdownBlock
  | ToolCallBlock
  | ArtifactBlock
  | CitationBlock
  | ErrorBlock
```

所有 block 共享基础字段：

```ts
export type BaseBlock = {
  id: string
  status: BlockStatus
  createdAt: number
  completedAt?: number
}
```

### 8.3 MarkdownBlock

用于 assistant 正文。普通文本也作为 markdown 处理，因为当前前端已经使用 `ReactMarkdown`。

```ts
export type MarkdownBlock = BaseBlock & {
  type: 'markdown'
  markdown: string
  role?: 'answer' | 'reasoning_summary' | 'notice'
}
```

约束：

- `markdown` 可以流式追加。
- 前端必须对 markdown 做安全渲染，不允许执行 HTML script。
- v1 默认只显示 `role: 'answer'` 的正文。
- `reasoning_summary` 只保存简短总结，不保存模型隐藏思维链。

### 8.4 ToolCallBlock

用于工具调用过程和结果展示。

```ts
export type ToolCallBlock = BaseBlock & {
  type: 'tool_call'
  callId: string
  toolId: string
  title?: string
  category: 'search' | 'web' | 'file' | 'shell' | 'image' | 'video' | 'tool'
  status: 'running' | 'success' | 'error'
  input: Record<string, unknown>
  output?: unknown
  outputSummary?: string
  error?: ResponseError
  durationMs?: number
  permission?: ToolPermissionView
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `callId` | 工具调用 ID，用于 start/result/error 事件配对 |
| `toolId` | 工具注册 ID，例如 `web_search` |
| `title` | UI 展示标题，可选 |
| `category` | 用于 UI 图标和基础样式 |
| `status` | 工具调用状态 |
| `input` | 已校验后的工具输入 |
| `output` | 工具输出预览，不能依赖完整 raw output |
| `outputSummary` | 适合卡片折叠态展示的摘要 |
| `error` | 工具失败原因 |
| `durationMs` | 工具耗时 |
| `permission` | 权限展示信息 |

v1 约束：

- 工具执行必须经过 `src/server/tools/execute-tool.ts`。
- `output` 应经过后端裁剪，避免把超大结果直接推给 renderer。
- `web_search` 输出建议保留 Top 3 结果供 UI 展示。

### 8.5 ArtifactBlock

用于文件、图片、视频、代码产物等。v1 先定义结构，允许后续逐步渲染。

```ts
export type ArtifactBlock = BaseBlock & {
  type: 'artifact'
  artifactId: string
  title: string
  artifactType: 'file' | 'image' | 'video' | 'code' | 'document' | 'data'
  mimeType?: string
  uri?: string
  localPath?: string
  preview?: string
  metadata?: Record<string, unknown>
}
```

约束：

- `localPath` 只允许指向 BloomAI 可访问的本地文件。
- renderer 展示本地文件前要走已有安全策略。
- v1 可以先把 artifact 渲染成普通卡片，不要求完整预览。

### 8.6 CitationBlock

用于来源引用。v1 不要求所有回答都有 citation，但需要为 web search 和文档读取预留统一结构。

```ts
export type CitationBlock = BaseBlock & {
  type: 'citation'
  citations: Citation[]
}

export type Citation = {
  id: string
  title?: string
  url?: string
  sourceType: 'web' | 'file' | 'document' | 'tool' | 'unknown'
  snippet?: string
  metadata?: Record<string, unknown>
}
```

约束：

- Citation 是 UI 辅助信息，不替代正文。
- `url` 必须是安全可打开链接。
- `snippet` 需要裁剪长度。

### 8.7 ErrorBlock

用于在 Timeline 中展示可恢复或不可恢复错误。

```ts
export type ErrorBlock = BaseBlock & {
  type: 'error'
  error: ResponseError
  recoverable?: boolean
}

export type ResponseError = {
  code: string
  message: string
  details?: unknown
}
```

错误语义：

| code | 场景 |
|---|---|
| `VALIDATION_ERROR` | 请求参数错误 |
| `LLM_CONFIG_ERROR` | 模型或 provider 配置错误 |
| `LLM_PROVIDER_ERROR` | provider 调用失败 |
| `LLM_RESPONSE_PARSE_ERROR` | provider 响应解析失败 |
| `TOOL_CALL_ERROR` | 工具调用失败 |
| `AGENT_RUNTIME_ERROR` | Agent Runtime 失败 |
| `STREAM_ABORTED` | 流式请求中断 |
| `UNKNOWN_ERROR` | 未分类错误 |

### 8.8 TokenUsage

```ts
export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  provider?: string
  model?: string
}
```

兼容当前旧格式：

```ts
{ input: number; output: number }
```

迁移时映射为：

```ts
{
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output
}
```

### 8.9 ResponseTrace

v1 trace 只保存摘要，不保存完整事件流。

```ts
export type ResponseTrace = {
  runtime: 'direct-llm' | 'mastra-chat-agent-v1' | 'agent-runtime' | 'workflow'
  runId?: string
  providerId?: string
  model?: string
  maxSteps?: number
  toolCalls?: ToolCallTrace[]
  finishReason?: FinishReason
  metadata?: Record<string, unknown>
}

export type ToolCallTrace = {
  callId: string
  toolId: string
  status: 'success' | 'error'
  input?: unknown
  outputSummary?: string
  durationMs?: number
}
```

## 9. 流式事件协议

### 9.1 总体规则

所有 SSE data payload 都应是 `ResponseStreamEvent`。

```ts
export type ResponseStreamEvent =
  | ResponseStartedEvent
  | ContentBlockStartedEvent
  | ContentDeltaEvent
  | ContentBlockCompletedEvent
  | ToolCallStartedEvent
  | ToolCallDeltaEvent
  | ToolCallCompletedEvent
  | ToolCallFailedEvent
  | UsageUpdatedEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent
```

事件规则：

- `response_started` 必须是一次回复的第一个 v1 事件。
- 所有事件必须带 `responseId`。
- 文本流式输出必须归属于一个 `blockId`。
- 工具事件必须使用 `callId` 配对。
- `response_completed` 或 `response_failed` 必须结束一次回复。
- usage 可以在中途更新，也可以只在完成时给出。

### 9.2 response_started

```ts
export type ResponseStartedEvent = {
  type: 'response_started'
  responseId: string
  sessionId?: string
  runtime: ResponseTrace['runtime']
  providerId?: string
  model?: string
  createdAt: number
}
```

用途：

- 前端创建 streaming response 容器。
- 记录当前 runtime、provider、model。

### 9.3 content_block_started

```ts
export type ContentBlockStartedEvent = {
  type: 'content_block_started'
  responseId: string
  block: Pick<MarkdownBlock, 'id' | 'type' | 'status' | 'role' | 'createdAt'>
}
```

用途：

- 前端创建一个 markdown block。
- v1 普通 chat 可以默认只创建一个 markdown block。

### 9.4 content_delta

```ts
export type ContentDeltaEvent = {
  type: 'content_delta'
  responseId: string
  blockId: string
  delta: string
}
```

用途：

- 追加 markdown 文本。
- 替代旧 `delta`。

### 9.5 content_block_completed

```ts
export type ContentBlockCompletedEvent = {
  type: 'content_block_completed'
  responseId: string
  blockId: string
  completedAt: number
}
```

用途：

- 标记 markdown block 完成。
- 前端可以停止显示 block 内 cursor。

### 9.6 tool_call_started

```ts
export type ToolCallStartedEvent = {
  type: 'tool_call_started'
  responseId: string
  block: ToolCallBlock
}
```

用途：

- 创建 `ToolCallCard`。
- 替代旧 `tool_call_start`。

### 9.7 tool_call_delta

v1 预留给长时间运行工具的进度更新。

```ts
export type ToolCallDeltaEvent = {
  type: 'tool_call_delta'
  responseId: string
  callId: string
  patch: Partial<Pick<ToolCallBlock, 'outputSummary' | 'durationMs' | 'permission'>>
}
```

用途：

- 展示工具运行进度。
- 展示权限等待、下载进度、视频生成进度等。

### 9.8 tool_call_completed

```ts
export type ToolCallCompletedEvent = {
  type: 'tool_call_completed'
  responseId: string
  callId: string
  output?: unknown
  outputSummary?: string
  durationMs?: number
  completedAt: number
}
```

用途：

- 将 `ToolCallCard` 更新为 success。
- 替代旧 `tool_call_result`。

### 9.9 tool_call_failed

```ts
export type ToolCallFailedEvent = {
  type: 'tool_call_failed'
  responseId: string
  callId: string
  error: ResponseError
  durationMs?: number
  completedAt: number
}
```

用途：

- 将 `ToolCallCard` 更新为 error。
- 替代旧 `tool_call_error`。

### 9.10 usage_updated

```ts
export type UsageUpdatedEvent = {
  type: 'usage_updated'
  responseId: string
  usage: TokenUsage
}
```

用途：

- 更新当前回复 token 用量。
- 兼容 provider 在最后才返回 usage 的情况。

### 9.11 response_completed

```ts
export type ResponseCompletedEvent = {
  type: 'response_completed'
  responseId: string
  messageId?: string
  usage?: TokenUsage
  trace?: ResponseTrace
  finishReason: FinishReason
  completedAt: number
}
```

用途：

- 标记流式回复完成。
- 前端停止 streaming 状态。
- 前端可触发重新加载 server messages，拿到真实 message id。

### 9.12 response_failed

```ts
export type ResponseFailedEvent = {
  type: 'response_failed'
  responseId: string
  error: ResponseError
  partialResponse?: ResponseEnvelope
  completedAt: number
}
```

用途：

- 标记回复失败。
- 如果已有部分文本，可以通过 `partialResponse` 保留。

## 10. 旧协议兼容映射

当前协议不需要一次性删除。v1 推荐先新增 mapper。

### 10.1 LLM 旧事件映射

旧事件：

```ts
type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'done' }
```

映射：

| 旧事件 | v1 事件 |
|---|---|
| 第一个 `delta` 前 | `response_started` + `content_block_started` |
| `delta` | `content_delta` |
| `usage` | `usage_updated` |
| `done` | `content_block_completed` + `response_completed` |

### 10.2 Agent 旧事件映射

旧事件：

```ts
type ChatAgentRuntimeEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; call: ToolCallViewModel }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs?: number }
  | { type: 'tool_call_error'; callId: string; error: string }
  | { type: 'done'; trace: ChatAgentRunTrace }
  | { type: 'error'; error: string }
```

映射：

| 旧事件 | v1 事件 |
|---|---|
| 第一个非错误事件前 | `response_started` |
| 第一个 `delta` 前 | `content_block_started` |
| `delta` | `content_delta` |
| `tool_call_start` | `tool_call_started` |
| `tool_call_result` | `tool_call_completed` |
| `tool_call_error` | `tool_call_failed` |
| `done` | `response_completed` |
| `error` | `response_failed` |

## 11. 后端接入设计

### 11.1 共享类型

新增：

```text
src/shared/schemas/response.ts
```

修改：

```text
src/shared/schemas/index.ts
```

导出：

```ts
export * from './response'
```

如果需要运行时校验，使用 zod schema 定义：

```ts
export const ResponseErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})
```

v1 推荐至少为 SSE 边界和数据库反序列化提供 schema。

### 11.2 LLM provider runtime

`src/server/llm` 继续保留现有 provider 抽象：

```ts
export interface ChatProvider {
  streamChat(input: ChatStreamRequest): AsyncGenerator<ChatStreamEvent>
}
```

v1 不强制 provider 直接输出 `ResponseStreamEvent`。推荐新增适配函数：

```ts
function mapLlmStreamToResponseEvents(input: {
  sessionId: string
  model: string
  providerId?: string
  source: AsyncGenerator<ChatStreamEvent>
}): AsyncGenerator<ResponseStreamEvent>
```

这样 provider 层可以保持轻量，只负责厂商协议解析；contract 映射放到更靠近 runtime 的位置。

### 11.3 Agent runtime

Mastra adapter 继续把 Mastra chunk 转成 BloomAI 内部 agent event。v1 再新增映射：

```ts
function mapAgentEventToResponseEvent(input: {
  responseId: string
  sessionId: string
  model: string
  event: ChatAgentRuntimeEvent
}): ResponseStreamEvent[]
```

后续当 `src/server/agent` 定义正式 `RuntimeEvent` 时，可以直接从 `RuntimeEvent` 映射到 `ResponseStreamEvent`。

### 11.4 Chat route

`src/server/routes/chat.route.ts` 的职责调整为：

1. 建立 SSE。
2. 保存 user message。
3. 选择 direct LLM 或 agent runtime。
4. 把 runtime 输出统一映射为 `ResponseStreamEvent`。
5. 通过 SSE 输出 v1 event。
6. 持久化 assistant readable text、usage、trace 摘要。

route 不应直接理解 provider chunk 或 Mastra chunk。

### 11.5 SSE 输出

当前 `sendSSE(res, payload)` 可以继续使用。

v1 推荐 payload shape：

```json
{
  "type": "content_delta",
  "responseId": "resp_123",
  "blockId": "block_answer",
  "delta": "hello"
}
```

为了兼容旧前端，可以在一段时间内提供双模式：

- 默认模式：旧事件。
- 实验模式：v1 事件。

或者后端只发送 v1，前端 api 层把 v1 降级成旧 store 所需字段。推荐第二种，因为新协议越早成为唯一源头，后续越少分叉。

## 12. 前端接入设计

### 12.1 API 层

`src/renderer/api/index.ts` 中 `chatStream` 返回类型改为：

```ts
AsyncGenerator<ResponseStreamEvent>
```

过渡期可定义：

```ts
type ChatStreamChunk = LegacyChatStreamEvent | ResponseStreamEvent
```

并在 api 层统一 normalize：

```ts
function normalizeChatStreamChunk(chunk: ChatStreamChunk): ResponseStreamEvent[]
```

### 12.2 Store reducer

`src/renderer/store/index.ts` 需要把 streaming state 从单一字符串升级为 response 状态：

```ts
type StreamingResponseState = {
  responseId: string
  sessionId: string
  blocks: ResponseContentBlock[]
  usage?: TokenUsage
  error?: ResponseError
}
```

推荐 reducer 操作：

| 事件 | Store 行为 |
|---|---|
| `response_started` | 创建 streaming response |
| `content_block_started` | append markdown block |
| `content_delta` | 追加到对应 block.markdown |
| `tool_call_started` | append tool call block |
| `tool_call_completed` | 更新 tool block success |
| `tool_call_failed` | 更新 tool block error |
| `usage_updated` | 更新 usage |
| `response_completed` | 结束 streaming，追加临时 assistant message，随后 reload server messages |
| `response_failed` | 结束 streaming，显示 error |

### 12.3 Timeline

`Timeline` 不再分别接收 `streamingText` 和 `toolCalls`，而是接收统一 streaming response：

```ts
interface TimelineProps {
  messages: Message[]
  streamingResponse?: StreamingResponseState
  streamError: ResponseError | null
}
```

渲染规则：

- 历史 `messages` 按原逻辑渲染。
- streaming response 的 `markdown` block 渲染为 streaming `MessageBubble`。
- streaming response 的 `tool_call` block 渲染为 `ToolCallCard`。
- streaming response 的 `error` block 渲染为错误提示。

v1 可以继续保持工具卡片显示在 streaming message 前面或后面，但必须由 block 顺序决定。

### 12.4 MessageBubble

`MessageBubble` 当前渲染 markdown 字符串。v1 保持它的职责：

- 渲染 `MarkdownBlock`。
- 不处理工具调用。
- 不处理 provider/agent 内部状态。

### 12.5 ToolCallCard

`ToolCallCard` 当前已经有 running/success/error 三态。v1 需要把 props 统一为 `ToolCallBlock` 或从 `ToolCallBlock` 派生的 view model：

```ts
type ToolCallCardProps = {
  data: ToolCallBlock
}
```

`web_search` 专门展示：

- query
- result count
- Top 3 result title/url/snippet
- duration

其他工具 fallback 展示：

- toolId
- input preview
- outputSummary
- status

## 13. 数据持久化设计

v1 不改数据库 schema。

当前保存：

```text
messages.content      最终 assistant 文本
messages.tool_calls   工具 trace 摘要 JSON
messages.tokens       token 总数
```

v1 保存策略：

1. 将所有 `MarkdownBlock` 中 `role === 'answer'` 的 markdown 拼接为 `messages.content`。
2. 将所有 `ToolCallBlock` 归约为 `ResponseTrace.toolCalls`，保存到 `messages.tool_calls`。
3. 将 `TokenUsage.totalTokens` 保存到 `messages.tokens`。
4. `ArtifactBlock` 和 `CitationBlock` v1 暂不持久化到独立字段，可以放入 `ResponseTrace.metadata`，但不建议依赖它做长期能力。

推荐 `messages.tool_calls` v1 JSON：

```json
{
  "schemaVersion": "bloom-response-v1",
  "runtime": "mastra-chat-agent-v1",
  "providerId": "openai",
  "model": "gpt-4o",
  "finishReason": "stop",
  "toolCalls": [
    {
      "callId": "call_123",
      "toolId": "web_search",
      "status": "success",
      "input": { "query": "BloomAI response contract" },
      "outputSummary": "3 results",
      "durationMs": 420
    }
  ]
}
```

未来 schema 升级建议：

```text
messages.blocks_json
responses
response_blocks
response_events
```

但这些不属于 v1 必须项。

## 14. 安全与边界校验

### 14.1 第三方响应不可信

Provider 和 agent SDK 输出都视为外部输入。进入 contract 前必须归一化：

- 字符串字段裁剪长度。
- JSON output 只保留 UI 需要的摘要。
- URL 做协议校验。
- error details 不直接暴露敏感配置。

### 14.2 Markdown 渲染安全

前端 `ReactMarkdown` 默认不应启用原始 HTML。

链接渲染：

- `target="_blank"`
- `rel="noopener noreferrer"`
- 只允许安全协议。

### 14.3 工具输出裁剪

工具输出可能很大。v1 约束：

- SSE 中的 `ToolCallBlock.output` 只传预览。
- 完整工具输出仍由 `tool_runs.output_json` 保存。
- `outputSummary` 是 ToolCallCard 折叠态主显示字段。

### 14.4 权限信息

```ts
export type ToolPermissionView = {
  level: 'network' | 'write' | 'shell'
  status: 'not_required' | 'pending' | 'granted' | 'denied'
  scope?: 'once' | 'session' | 'always'
}
```

v1 不实现完整权限弹窗联动，但 ToolCallBlock 需要为 UI 预留位置。

## 15. 示例

### 15.1 直接 LLM 回复

SSE：

```json
{ "type": "response_started", "responseId": "resp_1", "sessionId": "s1", "runtime": "direct-llm", "providerId": "openai", "model": "gpt-4o", "createdAt": 1782316800000 }
```

```json
{ "type": "content_block_started", "responseId": "resp_1", "block": { "id": "block_1", "type": "markdown", "status": "streaming", "role": "answer", "createdAt": 1782316800000 } }
```

```json
{ "type": "content_delta", "responseId": "resp_1", "blockId": "block_1", "delta": "你好，我可以帮你。" }
```

```json
{ "type": "usage_updated", "responseId": "resp_1", "usage": { "inputTokens": 12, "outputTokens": 8, "totalTokens": 20, "provider": "openai", "model": "gpt-4o" } }
```

```json
{ "type": "response_completed", "responseId": "resp_1", "finishReason": "stop", "completedAt": 1782316801000 }
```

### 15.2 Agent 工具调用回复

```json
{ "type": "response_started", "responseId": "resp_2", "sessionId": "s1", "runtime": "mastra-chat-agent-v1", "providerId": "openai", "model": "gpt-4o", "createdAt": 1782316800000 }
```

```json
{
  "type": "tool_call_started",
  "responseId": "resp_2",
  "block": {
    "id": "block_tool_1",
    "type": "tool_call",
    "callId": "call_1",
    "toolId": "web_search",
    "category": "search",
    "status": "running",
    "input": { "query": "BloomAI latest release" },
    "createdAt": 1782316800000
  }
}
```

```json
{ "type": "tool_call_completed", "responseId": "resp_2", "callId": "call_1", "outputSummary": "3 results", "durationMs": 560, "completedAt": 1782316800560 }
```

```json
{ "type": "content_block_started", "responseId": "resp_2", "block": { "id": "block_answer", "type": "markdown", "status": "streaming", "role": "answer", "createdAt": 1782316800561 } }
```

```json
{ "type": "content_delta", "responseId": "resp_2", "blockId": "block_answer", "delta": "我查到的结果是..." }
```

```json
{
  "type": "response_completed",
  "responseId": "resp_2",
  "finishReason": "stop",
  "trace": {
    "runtime": "mastra-chat-agent-v1",
    "model": "gpt-4o",
    "maxSteps": 10,
    "toolCalls": [
      {
        "callId": "call_1",
        "toolId": "web_search",
        "status": "success",
        "input": { "query": "BloomAI latest release" },
        "outputSummary": "3 results",
        "durationMs": 560
      }
    ]
  },
  "completedAt": 1782316803000
}
```

## 16. 实施计划

### 阶段 1：定义共享 contract

新增：

```text
src/shared/schemas/response.ts
```

内容：

- TypeScript 类型。
- zod schema。
- legacy event 到 v1 event 的 normalize helper 可以放在 shared 或 renderer api 层。

验收：

- 类型可被 server 和 renderer import。
- `npm run build` 通过。

### 阶段 2：后端 v1 mapper

新增：

```text
src/server/llm/response-event-mapper.ts
src/server/agent/response-event-mapper.ts
```

或按现有目录命名：

```text
src/server/llm/response.ts
src/server/agent/mastra/response-event-mapper.ts
```

职责：

- direct LLM stream -> `ResponseStreamEvent`
- Mastra agent event -> `ResponseStreamEvent`

验收：

- direct chat 输出 v1 event。
- agent chat 输出 v1 event。
- 工具调用仍能正常持久化。

### 阶段 3：前端 store 支持 v1

修改：

```text
src/renderer/api/index.ts
src/renderer/store/index.ts
```

职责：

- `chatStream` 识别 v1 event。
- store 使用 `StreamingResponseState`。
- 保持旧事件兼容。

验收：

- 普通 chat 流式显示不回退。
- Agent tool call 卡片不回退。

### 阶段 4：Timeline 统一 block 渲染

修改：

```text
src/renderer/pages/Chat/Timeline.tsx
src/renderer/pages/Chat/MessageBubble.tsx
src/renderer/pages/Chat/ToolCallCard.tsx
```

职责：

- 按 block 顺序渲染 streaming response。
- `MessageBubble` 渲染 markdown block。
- `ToolCallCard` 渲染 tool call block。

验收：

- 同一轮回复可以显示多个工具卡片和正文。
- 工具卡片状态 running -> success/error 正确更新。

### 阶段 5：持久化和回放增强

v1 可选。

职责：

- 从 `messages.tool_calls` 读取 trace 并渲染历史 ToolCallCard。
- 历史 message 可恢复基础 blocks。

验收：

- 刷新页面后，历史工具调用仍可见。

## 17. 测试策略

### 17.1 单元测试

新增或扩展：

```text
src/shared/schemas/response.test.ts
src/server/llm/response-event-mapper.test.ts
src/server/agent/mastra/response-event-mapper.test.ts
src/renderer/store/index.test.ts
src/renderer/pages/Chat/Timeline.test.tsx
src/renderer/pages/Chat/ToolCallCard.test.tsx
```

测试点：

- v1 event schema 校验成功。
- legacy `delta` 映射为 `content_delta`。
- legacy `usage` 映射为 `usage_updated`。
- legacy `tool_call_start` 映射为 `tool_call_started`。
- legacy `tool_call_result` 映射为 `tool_call_completed`。
- legacy `tool_call_error` 映射为 `tool_call_failed`。
- reducer 能按 `responseId` 和 `blockId` 更新 streaming response。
- reducer 能按 `callId` 更新工具卡片状态。

### 17.2 集成测试

后端：

1. POST `/api/v1/chat/stream` 普通 chat。
2. 验证 SSE 包含 `response_started`。
3. 验证 SSE 包含 `content_delta`。
4. 验证 SSE 包含 `response_completed`。

Agent：

1. mock Mastra agent 产生 tool call。
2. 验证 SSE 包含 `tool_call_started`。
3. 验证 SSE 包含 `tool_call_completed` 或 `tool_call_failed`。
4. 验证 trace 中包含 toolCalls。

前端：

1. mock `platform.chatStream` 返回 v1 event。
2. 验证 streaming markdown 出现。
3. 验证 ToolCallCard 出现。
4. 验证完成后停止 streaming。

### 17.3 手动验收

普通 chat：

- 输入“解释一下 BloomAI 是什么”
- UI 流式显示正文
- 无工具卡片
- 完成后消息保存

Agent 搜索：

- 输入“帮我搜索 BloomAI 最新资料并总结”
- UI 出现 `web_search` running 卡片
- 卡片更新为 success
- assistant 正文继续流式显示
- 完成后 `messages.tool_calls` 有 trace 摘要

失败场景：

- 模拟 provider 失败
- UI 显示统一错误
- 不出现永久 loading

## 18. 风险与取舍

### 18.1 一次性迁移风险

如果直接替换所有 `delta/tool_call_*`，可能造成前端 streaming 回退。

取舍：

- 先实现 normalize layer。
- store 同时支持 legacy 和 v1。
- UI 稳定后再移除 legacy。

### 18.2 内容块持久化不足

v1 不新增 `blocks_json`，历史消息无法完整回放所有 block。

取舍：

- 当前先用 `messages.content` 和 `messages.tool_calls`。
- 等 artifact/citation 真正成为核心能力时再升级 schema。

### 18.3 工具 output 结构差异

不同工具 output shape 差异很大。

取舍：

- `ToolCallBlock.output` 只作为预览。
- UI 优先使用 `outputSummary`。
- 特定工具可写专门 presenter，例如 `web_search`。

### 18.4 事件顺序复杂

Agent 可能先调用工具，再输出正文，也可能边输出边调用工具。

取舍：

- block 顺序以事件到达顺序为准。
- 每个 block 有独立 `id/status`。
- 前端 reducer 不假设只有一个 markdown block 或一个 tool call。

## 19. 完成标准

v1 完成时应满足：

1. `src/shared/schemas/response.ts` 定义统一 contract。
2. direct LLM 和 agent runtime 都能映射为 `ResponseStreamEvent`。
3. 前端 Chat Store 能消费 v1 event。
4. Timeline 能按 block 渲染 markdown 和 tool call。
5. 旧 `delta / tool_call_* / done` 协议有明确兼容路径。
6. `messages.content`、`messages.tool_calls`、`messages.tokens` 持久化不回退。
7. 单元测试覆盖 event mapper 和 reducer。
8. 普通 chat、agent tool call、错误场景都通过手动验收。

## 20. 结论

BloomAI Response Contract v1 的核心是把“模型输出什么”和“前端怎么渲染”解耦。模型、Agent、工具、workflow 都只需要产出同一套 `ResponseStreamEvent` 和 `ResponseContentBlock`，前端 Timeline 只需要理解这套稳定 UI 语义。

这样未来无论是 chat 直接调用 LLM，还是 agent 调用 LLM，或者 workflow 中的某个 step 调用 LLM，BloomAI 都可以复用同一套回复协议、同一套工具卡片、同一套消息持久化和同一套错误处理。
