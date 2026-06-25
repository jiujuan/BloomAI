# BloomAI LLM Response Contract v1 技术实现方案

## 1. 文档信息

- 日期：2026-06-25
- 状态：v1 技术实现方案
- 依据文档：`docs/llm/llm-response-contract-v1-design.md`
- 目标：把 BloomAI LLM Response Contract v1 落到现有工程结构中
- 范围：共享类型、后端 mapper、chat SSE、renderer api、chat store、Timeline、ToolCallCard、测试

## 2. 实现结论

推荐采用 **兼容式迁移方案**：

1. 先新增共享 contract 和 normalize 工具，不立刻删除旧事件。
2. 后端 direct LLM 和 Mastra agent 先通过 mapper 生成 v1 event。
3. 前端 api 层同时接受 legacy event 和 v1 event，并统一 normalize 成 v1 event。
4. Chat store 用 v1 `StreamingResponseState` 作为新的状态源。
5. Timeline 按 block 顺序渲染 streaming response。
6. 所有链路稳定后，再清理旧的 `streamingText`、`toolCallsBySession` 和 legacy event 分支。

这样每个阶段都能单独验证，避免一次性替换 `chat.route.ts`、store 和 UI 造成流式聊天回退。

## 3. 当前代码基线

### 3.1 后端 direct LLM 链路

相关文件：

```text
src/server/llm/types.ts
src/server/routes/chat.route.ts
src/server/llm/providers/*
```

当前 direct LLM stream event：

```ts
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'done' }
```

`chat.route.ts` 中 `streamLegacyChat` 直接发送：

```ts
sendSSE(res, { type: 'delta', text: event.text })
sendSSE(res, { type: 'done', tokens: { input, output } })
```

### 3.2 后端 Mastra agent 链路

相关文件：

```text
src/server/agent/mastra/types.ts
src/server/agent/mastra/mastra-event-mapper.ts
src/server/agent/mastra/chat-agent-runtime-adapter.ts
src/server/routes/chat.route.ts
```

当前 agent event：

```ts
export type ChatAgentRuntimeEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; call: ToolCallViewModel }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs?: number }
  | { type: 'tool_call_error'; callId: string; error: string }
  | { type: 'done'; trace: ChatAgentRunTrace }
  | { type: 'error'; error: string }
```

`chat.route.ts` 中 `streamMastraChat` 直接发送旧事件。

### 3.3 前端 chat stream 链路

相关文件：

```text
src/renderer/api/index.ts
src/renderer/store/index.ts
src/renderer/pages/Chat/Timeline.tsx
src/renderer/pages/Chat/MessageBubble.tsx
src/renderer/pages/Chat/ToolCallCard.tsx
```

当前前端状态：

```ts
streamingText: string
toolCallsBySession: Record<string, ToolCallState[]>
streamError: string | null
```

当前 Timeline props：

```ts
interface TimelineProps {
  messages: Message[]
  isStreaming: boolean
  streamingText: string
  streamError: string | null
  toolCalls?: ToolCallState[]
}
```

v1 的技术重点是把这三个状态合并成一个 streaming response。

## 4. 依赖图

```text
Phase 1 Shared Contract
  src/shared/schemas/response.ts
        |
        v
Phase 2 Server Mappers
  src/server/llm/response-event-mapper.ts
  src/server/agent/mastra/response-event-mapper.ts
        |
        v
Phase 3 Chat Route Emits v1
  src/server/routes/chat.route.ts
        |
        v
Phase 4 Renderer API Normalization
  src/renderer/api/chat-stream-normalizer.ts
  src/renderer/api/index.ts
        |
        v
Phase 5 Store Reducer
  src/renderer/store/chat-response-reducer.ts
  src/renderer/store/index.ts
        |
        v
Phase 6 Timeline Rendering
  src/renderer/pages/Chat/Timeline.tsx
  src/renderer/pages/Chat/ToolCallCard.tsx
```

实施顺序必须从共享 contract 开始。前端和后端都依赖它。

## 5. 关键技术决策

### 5.1 v1 event 是 canonical event

实现后，系统内部以 `ResponseStreamEvent` 为唯一标准事件。

legacy event 只存在于兼容层：

- 后端 mapper 输入可以是 legacy LLM 或 agent event。
- 前端 api normalizer 可以接受 legacy event。
- store 和 UI 不再直接处理 legacy event。

### 5.2 provider 层暂不直接输出 v1

`src/server/llm/providers/*` 继续输出当前 `ChatStreamEvent`。

原因：

- provider 只负责厂商协议解析，保持简单。
- v1 contract 是 BloomAI UI/Runtime 层协议，不要让 provider 知道 UI block。
- 后续如果有 provider 原生 tool calling，再通过 LLM mapper 转换。

### 5.3 route 层只做 orchestration，不做 event 细节拼装

`chat.route.ts` 当前包含大量事件发送、tool trace draft、token 统计逻辑。v1 不建议继续在 route 内拼接 v1 event。

推荐新增 server helper：

```text
src/server/chat/response-stream-writer.ts
```

如果暂时不想新增 `src/server/chat` 目录，也可以先放在：

```text
src/server/routes/chat-response-stream.ts
```

职责：

- 发送 v1 SSE event。
- 累积 markdown 正文。
- 累积 tool call trace。
- 累积 usage。
- 生成持久化 payload。

### 5.4 前端先保留旧状态字段，新增 v1 状态

第一轮实现中，store 可以同时保留：

```ts
streamingText: string
toolCallsBySession: Record<string, ToolCallState[]>
streamingResponsesBySession: Record<string, StreamingResponseState | null>
```

但新 UI 优先读 `streamingResponsesBySession`。

等测试稳定后，再删除旧字段。

### 5.5 修正 TypeScript block status 类型冲突

设计文档中有一个实现层需要修正的点：

```ts
type BaseBlock = {
  status: BlockStatus // 'pending' | 'streaming' | 'completed' | 'failed'
}

type ToolCallBlock = BaseBlock & {
  status: 'running' | 'success' | 'error'
}
```

这在 TypeScript 中会产生交叉类型冲突。wire schema 可以保持设计语义，但 TS 实现应拆开：

```ts
export type BaseBlockFields = {
  id: string
  createdAt: number
  completedAt?: number
}

export type MarkdownBlock = BaseBlockFields & {
  type: 'markdown'
  status: 'pending' | 'streaming' | 'completed' | 'failed'
  markdown: string
  role?: 'answer' | 'reasoning_summary' | 'notice'
}

export type ToolCallBlock = BaseBlockFields & {
  type: 'tool_call'
  status: 'running' | 'success' | 'error'
  callId: string
  toolId: string
  category: 'search' | 'web' | 'file' | 'shell' | 'image' | 'video' | 'tool'
  input: Record<string, unknown>
  output?: unknown
  outputSummary?: string
  error?: ResponseError
  durationMs?: number
  permission?: ToolPermissionView
}
```

## 6. 推荐文件结构

### 6.1 新增文件

```text
src/shared/schemas/response.ts
src/shared/schemas/response.test.ts

src/server/llm/response-event-mapper.ts
src/server/llm/response-event-mapper.test.ts

src/server/agent/mastra/response-event-mapper.ts
src/server/agent/mastra/response-event-mapper.test.ts

src/server/routes/chat-response-stream.ts
src/server/routes/chat-response-stream.test.ts

src/renderer/api/chat-stream-normalizer.ts
src/renderer/api/chat-stream-normalizer.test.ts

src/renderer/store/chat-response-reducer.ts
src/renderer/store/chat-response-reducer.test.ts
```

### 6.2 修改文件

```text
src/shared/schemas/index.ts
src/server/routes/chat.route.ts
src/renderer/api/index.ts
src/renderer/store/index.ts
src/renderer/pages/Chat/Timeline.tsx
src/renderer/pages/Chat/ToolCallCard.tsx
src/renderer/pages/Chat/ChatPanel.tsx
```

`ChatPanel.tsx` 需要同步 Timeline props。

## 7. Phase 1：共享 Contract

### 7.1 新增 `src/shared/schemas/response.ts`

建议内容：

```ts
import { z } from 'zod'

export const RESPONSE_SCHEMA_VERSION = 'bloom-response-v1' as const

export type ResponseRuntime =
  | 'direct-llm'
  | 'mastra-chat-agent-v1'
  | 'agent-runtime'
  | 'workflow'

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_limit'
  | 'error'
  | 'cancelled'
  | 'unknown'

export type ResponseError = {
  code: string
  message: string
  details?: unknown
}

export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  provider?: string
  model?: string
}

export type ToolPermissionView = {
  level: 'network' | 'write' | 'shell'
  status: 'not_required' | 'pending' | 'granted' | 'denied'
  scope?: 'once' | 'session' | 'always'
}

export type BaseBlockFields = {
  id: string
  createdAt: number
  completedAt?: number
}

export type MarkdownBlock = BaseBlockFields & {
  type: 'markdown'
  status: 'pending' | 'streaming' | 'completed' | 'failed'
  markdown: string
  role?: 'answer' | 'reasoning_summary' | 'notice'
}

export type ToolCallBlock = BaseBlockFields & {
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

export type ArtifactBlock = BaseBlockFields & {
  type: 'artifact'
  status: 'pending' | 'streaming' | 'completed' | 'failed'
  artifactId: string
  title: string
  artifactType: 'file' | 'image' | 'video' | 'code' | 'document' | 'data'
  mimeType?: string
  uri?: string
  localPath?: string
  preview?: string
  metadata?: Record<string, unknown>
}

export type Citation = {
  id: string
  title?: string
  url?: string
  sourceType: 'web' | 'file' | 'document' | 'tool' | 'unknown'
  snippet?: string
  metadata?: Record<string, unknown>
}

export type CitationBlock = BaseBlockFields & {
  type: 'citation'
  status: 'completed'
  citations: Citation[]
}

export type ErrorBlock = BaseBlockFields & {
  type: 'error'
  status: 'failed'
  error: ResponseError
  recoverable?: boolean
}

export type ResponseContentBlock =
  | MarkdownBlock
  | ToolCallBlock
  | ArtifactBlock
  | CitationBlock
  | ErrorBlock

export type ToolCallTrace = {
  callId: string
  toolId: string
  status: 'success' | 'error'
  input?: unknown
  outputSummary?: string
  durationMs?: number
}

export type ResponseTrace = {
  schemaVersion?: typeof RESPONSE_SCHEMA_VERSION
  runtime: ResponseRuntime
  runId?: string
  providerId?: string
  model?: string
  maxSteps?: number
  toolCalls?: ToolCallTrace[]
  finishReason?: FinishReason
  metadata?: Record<string, unknown>
}
```

Event union：

```ts
export type ResponseStartedEvent = {
  type: 'response_started'
  responseId: string
  sessionId?: string
  runtime: ResponseRuntime
  providerId?: string
  model?: string
  createdAt: number
}

export type ContentBlockStartedEvent = {
  type: 'content_block_started'
  responseId: string
  block: Omit<MarkdownBlock, 'markdown' | 'completedAt'> & { markdown?: string }
}

export type ContentDeltaEvent = {
  type: 'content_delta'
  responseId: string
  blockId: string
  delta: string
}

export type ToolCallStartedEvent = {
  type: 'tool_call_started'
  responseId: string
  block: ToolCallBlock
}

export type ToolCallCompletedEvent = {
  type: 'tool_call_completed'
  responseId: string
  callId: string
  output?: unknown
  outputSummary?: string
  durationMs?: number
  completedAt: number
}

export type ToolCallFailedEvent = {
  type: 'tool_call_failed'
  responseId: string
  callId: string
  error: ResponseError
  durationMs?: number
  completedAt: number
}

export type UsageUpdatedEvent = {
  type: 'usage_updated'
  responseId: string
  usage: TokenUsage
}

export type ResponseCompletedEvent = {
  type: 'response_completed'
  responseId: string
  messageId?: string
  usage?: TokenUsage
  trace?: ResponseTrace
  finishReason: FinishReason
  completedAt: number
}

export type ResponseFailedEvent = {
  type: 'response_failed'
  responseId: string
  error: ResponseError
  completedAt: number
}

export type ResponseStreamEvent =
  | ResponseStartedEvent
  | ContentBlockStartedEvent
  | ContentDeltaEvent
  | { type: 'content_block_completed'; responseId: string; blockId: string; completedAt: number }
  | ToolCallStartedEvent
  | { type: 'tool_call_delta'; responseId: string; callId: string; patch: Partial<Pick<ToolCallBlock, 'outputSummary' | 'durationMs' | 'permission'>> }
  | ToolCallCompletedEvent
  | ToolCallFailedEvent
  | UsageUpdatedEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent
```

### 7.2 Zod schema 范围

不需要第一版就为所有 block 写完整 schema。建议至少覆盖 SSE 边界：

- `ResponseErrorSchema`
- `TokenUsageSchema`
- `ResponseStreamEventSchema`

对复杂 `output`、`metadata` 使用 `z.unknown()`。

### 7.3 导出

修改：

```ts
// src/shared/schemas/index.ts
export * from './response'
```

### 7.4 验收标准

- `src/shared/schemas/response.ts` 能被 server 和 renderer import。
- `ResponseStreamEvent` union 能覆盖 direct LLM 和 agent 当前所有事件。
- `npm run build` 不出现类型循环或 renderer import server-only 模块。

## 8. Phase 2：后端 Mapper

### 8.1 Direct LLM mapper

新增：

```text
src/server/llm/response-event-mapper.ts
```

职责：

- 将 `ChatStreamEvent` 转换为 v1 event。
- 自动生成 `responseId` 和默认 markdown `blockId`。
- usage 从 `{ input, output }` 映射成 `TokenUsage`。

建议 API：

```ts
import { randomUUID } from 'crypto'
import type { ChatStreamEvent } from './types'
import type { ResponseStreamEvent, TokenUsage } from '@shared/schemas'

export type LlmResponseEventMapperOptions = {
  sessionId: string
  model: string
  providerId?: string
  responseId?: string
  now?: () => number
  idFactory?: () => string
}

export async function* mapLlmStreamToResponseEvents(
  source: AsyncGenerator<ChatStreamEvent>,
  options: LlmResponseEventMapperOptions,
): AsyncGenerator<ResponseStreamEvent> {
  // implementation
}
```

事件顺序：

1. 立即发送 `response_started`。
2. 第一个 `delta` 前发送 `content_block_started`。
3. 每个 `delta` 发送 `content_delta`。
4. `usage` 发送 `usage_updated`。
5. `done` 或 source 结束时发送 `content_block_completed` 和 `response_completed`。

边界：

- 如果没有 delta，也仍然发送 `response_completed`。
- 如果 source 抛错，发送 `response_failed`，并由 route 决定是否持久化 partial text。

### 8.2 Agent mapper

新增：

```text
src/server/agent/mastra/response-event-mapper.ts
```

职责：

- 将 `ChatAgentRuntimeEvent` 转换为 v1 event。
- 维护 tool call block id。
- 将 agent trace 映射为 `ResponseTrace`。
- 将 agent token usage 映射为 `TokenUsage`。

建议 API：

```ts
import type { ChatAgentRuntimeEvent } from './types'
import type { ResponseStreamEvent } from '@shared/schemas'

export type AgentResponseEventMapperOptions = {
  sessionId: string
  model: string
  responseId?: string
  maxSteps: number
  now?: () => number
  idFactory?: () => string
}

export function createAgentResponseEventMapper(options: AgentResponseEventMapperOptions): {
  map(event: ChatAgentRuntimeEvent): ResponseStreamEvent[]
  completeWithoutDone(): ResponseStreamEvent[]
  fail(error: unknown): ResponseStreamEvent[]
}
```

映射规则：

| Agent event | v1 event |
|---|---|
| mapper 创建时 | `response_started` |
| 第一个 `delta` 前 | `content_block_started` |
| `delta` | `content_delta` |
| `tool_call_start` | `tool_call_started` |
| `tool_call_result` | `tool_call_completed` |
| `tool_call_error` | `tool_call_failed` |
| `done` | `response_completed` |
| `error` | `response_failed` |

工具 category 归一化：

```ts
function normalizeToolCategory(category: string, toolId: string): ToolCallBlock['category'] {
  if (category === 'web' || toolId.includes('web')) return 'web'
  if (category === 'search' || toolId.includes('search')) return 'search'
  if (category === 'execution' || toolId.includes('shell')) return 'shell'
  if (category === 'fs' || toolId.includes('fs_')) return 'file'
  return 'tool'
}
```

### 8.3 工具输出摘要

当前 `chat.route.ts` 内有 `summarizeToolOutput`。v1 建议抽出：

```text
src/server/tools/output-summary.ts
```

或先放在：

```text
src/server/agent/mastra/response-event-mapper.ts
```

推荐函数：

```ts
export function summarizeToolOutput(output: unknown): string | undefined {
  if (output == null) return undefined
  if (typeof output === 'string') return output.slice(0, 160)
  if (Array.isArray(output)) return `${output.length} items`
  if (typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (Array.isArray(record.results)) return `${record.results.length} results`
    if (typeof record.summary === 'string') return record.summary
    if (typeof record.text === 'string') return record.text.slice(0, 160)
  }
  return undefined
}
```

### 8.4 验收标准

- direct LLM mapper 单测覆盖 `delta / usage / done / empty stream / thrown error`。
- agent mapper 单测覆盖 `tool_call_start/result/error/delta/done/error`。
- mapper 输出不包含 Mastra raw chunk。
- mapper 输出符合 `ResponseStreamEvent` 类型。

## 9. Phase 3：Chat Route 改造

### 9.1 新增 response stream writer

新增：

```text
src/server/routes/chat-response-stream.ts
```

职责：

- `send(event)`：发送 SSE，并累积状态。
- `getPersistedContent()`：返回 assistant markdown 正文。
- `getTrace()`：返回 `ResponseTrace`。
- `getTokenCount()`：返回 token 总数。
- `persistAssistantMessage()`：统一写入 `messageRepo`。

建议 API：

```ts
import type { Response } from 'express'
import type { ResponseStreamEvent, ResponseTrace, TokenUsage, ToolCallTrace } from '@shared/schemas'

export type ChatResponseStreamState = {
  responseId: string
  text: string
  usage?: TokenUsage
  trace?: ResponseTrace
  toolCalls: ToolCallTrace[]
}

export function createChatResponseStreamWriter(input: {
  res: Response
  sessionId: string
  sendSSE: (res: Response, payload: unknown) => void
}): {
  send(event: ResponseStreamEvent): void
  state(): ChatResponseStreamState
}
```

状态归约规则：

- `content_delta` append 到 `text`。
- `usage_updated` 更新 `usage`。
- `tool_call_started` 初始化 tool trace draft。
- `tool_call_completed` 标记 success。
- `tool_call_failed` 标记 error。
- `response_completed.trace` 覆盖或补充当前 trace。

### 9.2 改造 `streamLegacyChat`

旧逻辑：

```ts
for await (const event of streamChatCompletion(...)) {
  if (event.type === 'delta') sendSSE(res, { type: 'delta', text: event.text })
}
sendSSE(res, { type: 'done', tokens })
```

新逻辑：

```ts
const writer = createChatResponseStreamWriter({ res, sessionId, sendSSE })
const responseEvents = mapLlmStreamToResponseEvents(streamChatCompletion(...), {
  sessionId,
  model,
  providerId: resolvedProviderId,
})

for await (const event of responseEvents) {
  writer.send(event)
}

persistAssistantFromWriter(sessionId, writer.state())
```

`providerId` 可选。v1 可以只填 model，后续从 `selectRuntimeModel` 或 `llm registry` 返回 providerId。

### 9.3 改造 `streamMastraChat`

旧逻辑：

- 手动处理 `delta`。
- 手动 track tool draft。
- 手动 persist assistant。

新逻辑：

```ts
const writer = createChatResponseStreamWriter({ res, sessionId, sendSSE })
const mapper = createAgentResponseEventMapper({ sessionId, model, maxSteps })

for await (const agentEvent of runChatAgentV1(...)) {
  for (const responseEvent of mapper.map(agentEvent)) {
    writer.send(responseEvent)
  }
}

persistAssistantFromWriter(sessionId, writer.state())
```

如果 agent 初始化失败且没有非错误事件，仍然保留现有 fallback 到 direct LLM 的行为。

### 9.4 错误处理

direct LLM：

- source 已经输出部分文本后失败：发送 `response_failed`，保存 partial assistant。
- source 未输出任何文本就失败：发送 `response_failed`，不保存 assistant。

agent：

- agent 第一个事件就是 error：返回 `false`，触发 direct LLM fallback。
- agent 已经输出非错误事件后 error：发送 `response_failed`，保存 partial assistant 和已有 tool trace。

### 9.5 持久化

新增 helper：

```ts
function persistAssistantFromWriter(sessionId: string, state: ChatResponseStreamState): void {
  messageRepo.save({
    session_id: sessionId,
    role: 'assistant',
    content: state.text,
    tool_calls: state.trace ? JSON.stringify({ schemaVersion: 'bloom-response-v1', ...state.trace }) : null,
    tokens: getTokenCount(state.usage),
  })
}
```

注意：

- 如果 `state.text` 为空但有 tool calls，v1 可以保存空 assistant message，或者不保存 message。推荐保存空 message，因为 tool trace 属于本轮 assistant response。
- `tool_calls` 不再保存裸数组，保存带 `schemaVersion` 的 trace object。
- 读取旧数据时要兼容裸数组。

### 9.6 测试调整

修改：

```text
src/server/routes/chat.route.test.ts
```

旧断言：

```ts
expect(parseSse(responseText)).toEqual([
  { type: 'delta', text: 'Hello' },
  { type: 'done', tokens: { input: 3, output: 5 } },
])
```

新断言：

```ts
expect(events.map((event) => event.type)).toEqual([
  'response_started',
  'content_block_started',
  'content_delta',
  'usage_updated',
  'content_block_completed',
  'response_completed',
])
```

不要断言动态 `responseId` 和 timestamp 的精确值，使用 `expect.any(String)` 和 `expect.any(Number)`。

## 10. Phase 4：Renderer API Normalizer

### 10.1 新增 normalizer

新增：

```text
src/renderer/api/chat-stream-normalizer.ts
```

职责：

- 判断 chunk 是 legacy 还是 v1。
- 将 legacy chunk 转为 v1 event。
- 如果后端已经发送 v1，直接返回。

建议 API：

```ts
import type { ResponseStreamEvent } from '@shared/schemas'

export type LegacyChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; call: LegacyToolCallView }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs?: number }
  | { type: 'tool_call_error'; callId: string; error: string }
  | { type: 'done'; tokens?: { input: number; output: number } | null; trace?: unknown }
  | { type: 'error'; error: string }

export function createChatStreamNormalizer(input: {
  sessionId: string
  responseId?: string
  now?: () => number
  idFactory?: () => string
}): {
  normalize(chunk: LegacyChatStreamEvent | ResponseStreamEvent): ResponseStreamEvent[]
  flush(): ResponseStreamEvent[]
}
```

### 10.2 修改 `platform.chatStream`

当前：

```ts
async *chatStream(...): AsyncGenerator<ChatStreamEvent> {
  // yield JSON.parse(raw)
}
```

改为：

```ts
async *chatStream(...): AsyncGenerator<ResponseStreamEvent> {
  const normalizer = createChatStreamNormalizer({ sessionId: payload.sessionId })
  // ...
  const chunk = JSON.parse(raw)
  for (const event of normalizer.normalize(chunk)) {
    yield event
  }
  // stream end
  for (const event of normalizer.flush()) {
    yield event
  }
}
```

### 10.3 为什么前端还需要 normalizer

即使后端开始发送 v1，前端 normalizer 仍有价值：

- 支持旧桌面端/旧开发服务返回 legacy event。
- 支持测试中直接 mock legacy event。
- 允许后端分阶段迁移。

后续可以在确认所有后端只发送 v1 后删除 legacy normalizer。

## 11. Phase 5：Chat Store Reducer

### 11.1 新增 reducer

新增：

```text
src/renderer/store/chat-response-reducer.ts
```

类型：

```ts
import type { ResponseContentBlock, ResponseError, ResponseStreamEvent, TokenUsage } from '@shared/schemas'

export type StreamingResponseState = {
  responseId: string
  sessionId: string
  blocks: ResponseContentBlock[]
  usage?: TokenUsage
  error?: ResponseError
  isComplete: boolean
}

export function reduceStreamingResponse(
  current: StreamingResponseState | null,
  event: ResponseStreamEvent,
  sessionId: string,
): StreamingResponseState | null {
  // implementation
}
```

### 11.2 reducer 行为

| Event | Behavior |
|---|---|
| `response_started` | 创建 state，清空旧 blocks |
| `content_block_started` | append markdown block，默认 `markdown: ''` |
| `content_delta` | 找到 blockId，append delta |
| `content_block_completed` | markdown block status -> completed |
| `tool_call_started` | append tool call block |
| `tool_call_delta` | patch tool call block |
| `tool_call_completed` | tool call status -> success，写 output/summary/duration |
| `tool_call_failed` | tool call status -> error，写 error |
| `usage_updated` | 更新 usage |
| `response_completed` | `isComplete = true`，合并 usage/trace |
| `response_failed` | `isComplete = true`，写 error，append error block |

### 11.3 修改 store 状态

新增：

```ts
streamingResponsesBySession: Record<string, StreamingResponseState | null>
```

保留过渡字段：

```ts
streamingText: string
toolCallsBySession: Record<string, ToolCallState[]>
```

过渡期间由 v1 state 派生旧字段：

```ts
function deriveStreamingText(response: StreamingResponseState | null): string {
  return response?.blocks
    .filter((block): block is MarkdownBlock => block.type === 'markdown')
    .map((block) => block.markdown)
    .join('') ?? ''
}

function deriveToolCalls(response: StreamingResponseState | null): ToolCallState[] {
  return response?.blocks
    .filter((block): block is ToolCallBlock => block.type === 'tool_call')
    .map(toToolCallState) ?? []
}
```

这样 Timeline 可以先不一次性大改。

### 11.4 修改 `sendMessage`

核心循环：

```ts
for await (const event of platform.chatStream({ sessionId, content, contextOverride })) {
  set((state) => {
    const current = state.streamingResponsesBySession[sessionId] ?? null
    const next = reduceStreamingResponse(current, event, sessionId)
    return {
      streamingResponsesBySession: {
        ...state.streamingResponsesBySession,
        [sessionId]: next,
      },
      streamingText: deriveStreamingText(next),
      toolCallsBySession: {
        ...state.toolCallsBySession,
        [sessionId]: deriveToolCalls(next),
      },
      streamError: next?.error?.message ?? null,
    }
  })
}
```

完成后：

- 从 v1 state 派生 assistant 临时 message content。
- reload server messages。
- 清空当前 session streaming response。

## 12. Phase 6：Timeline 和 UI

### 12.1 Timeline props 迁移

第一步兼容 props：

```ts
interface TimelineProps {
  messages: Message[]
  isStreaming: boolean
  streamingText: string
  streamError: string | null
  toolCalls?: ToolCallState[]
  streamingResponse?: StreamingResponseState | null
}
```

渲染优先级：

1. 如果有 `streamingResponse`，按 blocks 渲染。
2. 否则使用旧 `toolCalls + streamingText`。

第二步删除旧 props。

### 12.2 block renderer

新增内部组件：

```tsx
function StreamingResponseBlocks({ response }: { response: StreamingResponseState }) {
  return (
    <>
      {response.blocks.map((block) => {
        if (block.type === 'markdown') {
          return <MessageBubble key={block.id} message={streamingMessage} isStreaming streamText={block.markdown} />
        }
        if (block.type === 'tool_call') {
          return <ToolCallCard key={block.callId} data={block} />
        }
        if (block.type === 'error') {
          return <div key={block.id} className="stream-error">{block.error.message}</div>
        }
        return null
      })}
    </>
  )
}
```

### 12.3 ToolCallCard props

当前 `ToolCallCard` 使用：

```ts
export interface ToolCallData {
  callId: string
  toolId: string
  category: string
  status: 'running' | 'success' | 'error'
  input: Record<string, any>
  output?: any
  error?: string
  durationMs?: number
}
```

改为：

```ts
import type { ToolCallBlock } from '@shared/schemas'

export function ToolCallCard({ data, onRetry }: { data: ToolCallBlock; onRetry?: () => void }) {
  // data.error?.message
}
```

兼容层：

- 如果 store 仍传旧 `ToolCallState`，先用 adapter 转成 `ToolCallBlock`。
- `error` 从 string 变为 `ResponseError`，UI 展示 `data.error?.message`。

### 12.4 类别映射

当前 category label 包含 `fs/document/multimodal/execution`，v1 category 是：

```ts
'search' | 'web' | 'file' | 'shell' | 'image' | 'video' | 'tool'
```

需要更新：

```ts
const CATEGORY_LABEL: Record<string, React.ReactNode> = {
  search: <Search size={12} />,
  web: <Search size={12} />,
  file: <Folder size={12} />,
  shell: <TerminalSquare size={12} />,
  image: <ImageIcon size={12} />,
  video: <Video size={12} />,
  tool: <Wrench size={12} />,
}
```

## 13. 历史消息和旧数据兼容

v1 不改数据库 schema，但历史 `messages.tool_calls` 可能有两种格式：

旧格式：

```json
[
  {
    "callId": "call-1",
    "toolId": "web_search",
    "status": "success"
  }
]
```

新格式：

```json
{
  "schemaVersion": "bloom-response-v1",
  "runtime": "mastra-chat-agent-v1",
  "toolCalls": []
}
```

建议新增 parser：

```text
src/shared/schemas/message-trace.ts
```

或先放在 renderer Chat 工具函数中：

```ts
function parseMessageToolTrace(raw: string | null | undefined): ResponseTrace | null {
  if (!raw) return null
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return {
      schemaVersion: 'bloom-response-v1',
      runtime: 'mastra-chat-agent-v1',
      toolCalls: parsed,
    }
  }
  if (parsed?.schemaVersion === 'bloom-response-v1') return parsed
  return null
}
```

历史 ToolCallCard 渲染可以放到后续阶段，不阻塞 v1 streaming。

## 14. 测试计划

### 14.1 Shared contract tests

新增：

```text
src/shared/schemas/response.test.ts
```

覆盖：

- `ResponseStreamEventSchema` 接受 `content_delta`。
- `ResponseStreamEventSchema` 接受 `tool_call_started`。
- `ResponseStreamEventSchema` 拒绝未知 event type。
- `ToolCallBlock` status 不与 markdown status 冲突。

### 14.2 LLM mapper tests

新增：

```text
src/server/llm/response-event-mapper.test.ts
```

覆盖：

- delta 前自动发 `response_started` 和 `content_block_started`。
- 多个 delta 使用同一个 `blockId`。
- usage 映射为 `inputTokens/outputTokens/totalTokens`。
- done 发 `content_block_completed` 和 `response_completed`。
- 空 stream 也发 `response_completed`。

### 14.3 Agent mapper tests

新增：

```text
src/server/agent/mastra/response-event-mapper.test.ts
```

覆盖：

- tool call start -> `tool_call_started`。
- tool result -> `tool_call_completed`。
- tool error -> `tool_call_failed`。
- delta -> `content_delta`。
- done trace -> `response_completed.trace`。
- error -> `response_failed`。

### 14.4 Route tests

修改：

```text
src/server/routes/chat.route.test.ts
```

覆盖：

- direct LLM SSE event types 是 v1 sequence。
- direct LLM 仍保存 assistant content 和 token。
- agent SSE event types 是 v1 sequence。
- agent tool call trace 保存为 v1 trace object。
- partial failure 发 `response_failed` 且保存 partial text。

### 14.5 Renderer normalizer tests

新增：

```text
src/renderer/api/chat-stream-normalizer.test.ts
```

覆盖：

- legacy `delta` -> v1。
- legacy `tool_call_start` -> v1。
- legacy `done` -> v1。
- v1 chunk 原样通过。
- flush 能补齐缺失的 completed event。

### 14.6 Store reducer tests

新增：

```text
src/renderer/store/chat-response-reducer.test.ts
```

覆盖：

- content delta append。
- tool call running -> success。
- tool call running -> error。
- usage update。
- response failed append error block。

### 14.7 UI tests

修改：

```text
src/renderer/pages/Chat/Timeline.test.tsx
src/renderer/pages/Chat/ToolCallCard.test.tsx
```

覆盖：

- Timeline 按 block 顺序渲染 tool card 和 markdown。
- ToolCallCard 展示 v1 `ResponseError.message`。
- web_search 仍只展示 Top 3 results。

## 15. 具体任务拆分

### Task 1：新增共享 contract

描述：新增 `src/shared/schemas/response.ts`，定义 v1 类型和基础 zod schema。

验收：

- `src/shared/schemas/index.ts` 导出 response contract。
- server 和 renderer 都能 import `ResponseStreamEvent`。
- `npm run build` 通过。

文件：

```text
src/shared/schemas/response.ts
src/shared/schemas/index.ts
src/shared/schemas/response.test.ts
```

规模：M

### Task 2：实现 direct LLM mapper

描述：将 `ChatStreamEvent` 转换成 `ResponseStreamEvent`。

验收：

- mapper 单测通过。
- delta/usage/done 都能映射。
- thrown error 产生 `response_failed`。

文件：

```text
src/server/llm/response-event-mapper.ts
src/server/llm/response-event-mapper.test.ts
```

规模：S

### Task 3：实现 Mastra agent mapper

描述：将 `ChatAgentRuntimeEvent` 转换成 `ResponseStreamEvent`。

验收：

- tool start/result/error 单测通过。
- done trace 转成 v1 trace。
- event 中不泄漏 Mastra raw chunk。

文件：

```text
src/server/agent/mastra/response-event-mapper.ts
src/server/agent/mastra/response-event-mapper.test.ts
```

规模：M

### Task 4：新增 chat response stream writer

描述：抽出 route 中的 SSE 发送、正文累积、tool trace 累积、usage 累积。

验收：

- writer 单测能从 v1 events 归约出 text、usage、trace。
- tool call success/error trace 正确。

文件：

```text
src/server/routes/chat-response-stream.ts
src/server/routes/chat-response-stream.test.ts
```

规模：M

### Task 5：改造 chat route 输出 v1

描述：`streamLegacyChat` 和 `streamMastraChat` 使用 mapper + writer 输出 v1 SSE。

验收：

- `chat.route.test.ts` 全部更新并通过。
- direct chat 持久化不回退。
- agent fallback 行为不回退。
- agent tool call 持久化不回退。

文件：

```text
src/server/routes/chat.route.ts
src/server/routes/chat.route.test.ts
```

规模：M

### Task 6：实现 renderer chat stream normalizer

描述：前端 api 层统一输出 v1 event，并兼容 legacy chunk。

验收：

- legacy 和 v1 mock 都能 normalize。
- `platform.chatStream` 返回 `AsyncGenerator<ResponseStreamEvent>`。

文件：

```text
src/renderer/api/chat-stream-normalizer.ts
src/renderer/api/chat-stream-normalizer.test.ts
src/renderer/api/index.ts
```

规模：M

### Task 7：实现 store reducer

描述：新增 `StreamingResponseState` 和 reducer，改造 `sendMessage` 消费 v1 event。

验收：

- reducer 单测通过。
- 普通 streaming text 正常显示。
- tool call running/success/error 正常进入 state。

文件：

```text
src/renderer/store/chat-response-reducer.ts
src/renderer/store/chat-response-reducer.test.ts
src/renderer/store/index.ts
src/renderer/store/index.test.ts
```

规模：M

### Task 8：Timeline 按 block 渲染

描述：Timeline 支持 `streamingResponse`，按 block 顺序渲染 markdown 和 tool call。

验收：

- Timeline 单测覆盖 block 顺序。
- 旧 props fallback 仍可用。
- ChatPanel 正确传入 streaming response。

文件：

```text
src/renderer/pages/Chat/Timeline.tsx
src/renderer/pages/Chat/Timeline.test.tsx
src/renderer/pages/Chat/ChatPanel.tsx
```

规模：M

### Task 9：ToolCallCard 接入 ToolCallBlock

描述：ToolCallCard 使用 v1 `ToolCallBlock`，并兼容错误对象。

验收：

- web_search Top 3 结果测试通过。
- error 显示 `ResponseError.message`。
- category fallback 正常。

文件：

```text
src/renderer/pages/Chat/ToolCallCard.tsx
src/renderer/pages/Chat/ToolCallCard.test.tsx
```

规模：S

### Task 10：历史 trace 解析和文档收尾

描述：兼容旧 `messages.tool_calls` 裸数组和新 v1 trace object。

验收：

- parser 能读取旧格式。
- parser 能读取新格式。
- 不合法 JSON 返回 null，不影响页面。

文件：

```text
src/shared/schemas/message-trace.ts
src/shared/schemas/message-trace.test.ts
```

规模：S

## 16. Checkpoints

### Checkpoint A：Contract 和 mapper 完成

完成 Task 1-3 后检查：

- `npm test -- response`
- `npm run build`
- mapper 输出 event sequence 可读。

### Checkpoint B：后端 SSE 完成

完成 Task 4-5 后检查：

- `npm test -- chat.route`
- 手动 POST `/api/v1/chat/stream` 可看到 v1 SSE。
- direct LLM 和 agent runtime 都能保存 assistant message。

### Checkpoint C：前端状态完成

完成 Task 6-7 后检查：

- renderer normalizer tests 通过。
- store reducer tests 通过。
- mock v1 event 能更新 streaming response。

### Checkpoint D：UI 完成

完成 Task 8-10 后检查：

- Timeline 和 ToolCallCard tests 通过。
- 普通 chat 手动验收通过。
- agent web_search 手动验收通过。
- provider error 手动验收通过。

## 17. 迁移策略

### 17.1 第一阶段：双读单写

- 后端开始写 v1 SSE。
- 前端 normalizer 继续能读 legacy。
- 数据库 `tool_calls` 新写 v1 trace object。
- 读取历史时兼容旧裸数组。

### 17.2 第二阶段：UI 只读 v1 state

- Timeline 优先使用 `streamingResponse`。
- `streamingText` 和 `toolCallsBySession` 只作为 fallback。

### 17.3 第三阶段：删除 legacy 分支

条件：

- 所有 route tests 已经断言 v1 events。
- renderer tests 不再 mock legacy event，除了 normalizer legacy tests。
- 手动验收稳定。

可删除：

- store 中对 `delta/tool_call_*` 的直接分支。
- Timeline 的旧 props fallback。
- `ToolCallState` 或把它改为 `ToolCallBlock` alias。

## 18. 风险与规避

| 风险 | 影响 | 规避 |
|---|---|---|
| 事件序列过早变化导致前端不显示 streaming | 高 | 前端 normalizer 先落地，store 保留 fallback |
| `ToolCallBlock.status` 与 BaseBlock status 类型冲突 | 中 | 使用 `BaseBlockFields`，各 block 自定义 status |
| route 改造过大 | 中 | 先新增 writer 和 mapper，route 只替换调用点 |
| 历史 `tool_calls` JSON 解析失败 | 中 | parser catch 错误并返回 null |
| 动态 ID/timestamp 让测试脆弱 | 低 | 测试断言 event type 和关键字段，用 `expect.any` |
| 工具 output 太大造成 UI 卡顿 | 中 | mapper 只传 preview，完整 output 留在 `tool_runs` |

## 19. 手动验收脚本

### 19.1 普通 direct chat

输入：

```text
解释一下 BloomAI 是什么
```

期望：

- SSE 包含 `response_started`。
- SSE 包含 `content_delta`。
- SSE 包含 `response_completed`。
- UI 流式显示正文。
- 无 ToolCallCard。
- `messages.content` 保存完整正文。

### 19.2 Agent web_search

前置：

```text
settings.agent_runtime_enabled = true
settings.agent_runtime_provider = mastra
settings.agent_runtime_max_steps = 10
```

输入：

```text
帮我搜索 BloomAI 最新资料并总结
```

期望：

- SSE 包含 `tool_call_started`。
- ToolCallCard 显示 running。
- SSE 包含 `tool_call_completed`。
- ToolCallCard 显示 Done 和耗时。
- assistant markdown 继续流式显示。
- `messages.tool_calls` 保存 v1 trace object。

### 19.3 失败场景

模拟 provider 抛错。

期望：

- SSE 包含 `response_failed`。
- UI 显示错误。
- 不出现永久 loading。
- 如果已有 partial text，partial text 保存为 assistant message。

## 20. 最终完成标准

实现完成后应满足：

1. `ResponseStreamEvent` 成为 chat stream 的标准输出。
2. Direct LLM 和 Mastra agent 都通过 mapper 输出 v1 event。
3. Renderer API 输出统一的 v1 event。
4. Chat store 使用 `StreamingResponseState` 管理正文、工具调用、usage 和 error。
5. Timeline 按 block 顺序渲染 streaming response。
6. ToolCallCard 使用 `ToolCallBlock`。
7. `messages.tool_calls` 新写入 v1 trace object，并兼容读取旧数组格式。
8. `npm run build` 通过。
9. 相关单元测试和 route/UI tests 通过。
10. 普通 chat、agent tool call、失败场景手动验收通过。
