# BloomAI Chat 调用 Mastra Agent v1 实现方案

## 1. 目标

本方案用于快速实现第一版：用户在 BloomAI 聊天框输入内容后，后端不再只直接调用当前 LLM runtime，而是调用一个 Mastra.ai Agent。该 Agent 使用 ReAct-style 工具循环，默认最大 loop / step 数为 10，并可以调用现有工具系统中的 `web_search` 完成搜索。聊天 SSE 事件需要支持 tool call，前端需要渲染 roadmap 中定义的“对话中的 Tool Call 卡片”。

本方案是 v1 快速落地版，不试图一次完成完整 Agent 市场、team、workflow、持久化 AgentSpec。它的重点是打通：

1. Chat 输入
2. Mastra Agent 执行
3. Agent 调用 BloomAI 现有 `web_search`
4. SSE 输出 `tool_call` 事件
5. 前端渲染 `ToolCallCard`
6. 最终 assistant 文本流式输出

## 2. 依据与现状

### 2.1 Mastra 能力依据

Mastra 官方文档中，Agent 用 LLM 和工具处理开放式任务，会决定调用哪些工具、循环多少次、何时停止；Agent 适合步骤无法预先确定的任务。文档也说明 `agent.stream()` 可以流式输出，结果包含文本流、tool calls、tool results、steps 和 usage。

Mastra tools 通过 `createTool` 定义，包含 `id`、`description`、`inputSchema`、`outputSchema`、`execute`。Agent 通过 `tools` 属性挂载工具。`agent.stream()` 的 options 支持 `maxSteps`，用于限制执行步骤数；也支持 `onChunk`、`onError`、`toolChoice`、`hooks` 等扩展点。

参考：

- https://mastra.ai/docs/agents/overview
- https://mastra.ai/docs/agents/using-tools
- https://mastra.ai/reference/streaming/agents/stream
- https://mastra.ai/reference/streaming/agents/MastraModelOutput
- https://mastra.ai/reference/tools/create-tool

### 2.2 BloomAI 当前现状

当前项目现状：

- `package.json` 尚未安装 `@mastra/core`。
- `src/server/routes/chat.route.ts` 当前直接调用 `streamChatCompletion`。
- `src/server/tools/web-search.ts` 已存在可用的 `web_search` executor。
- `src/server/tools/execute-tool.ts` 已负责工具执行、超时、`tool_runs` 记录。
- `src/renderer/pages/Chat/ToolCallCard.tsx` 已有 running / success / error 三态 UI。
- `Timeline` 还没有把 tool call 节点接入聊天流。
- `ChatStore` 和 `platform.chatStream` 当前只处理 `delta / done / error`。

## 3. v1 设计原则

- 使用 Mastra Agent 作为第一版 Agent 执行引擎，不自研 ReAct loop。
- `ChatRuntime` 只作为过渡适配器，负责从 chat 请求进入 Mastra Agent。
- `src/server/agent` 放 Mastra adapter、Agent v1、事件转换、web_search tool 包装。
- `src/server/chat` 仍只做聊天入口、SSE、UI 协议适配。
- `src/server/tools` 仍是工具执行器，Mastra tool 必须调用 `executeTool('web_search')`，不能绕过现有工具系统。
- loop 上限默认 10，通过 Mastra `agent.stream(..., { maxSteps: 10 })` 控制。
- 前端只消费统一 SSE 事件，不感知 Mastra 内部对象。

## 4. 总体架构

```text
Chat UI
  -> platform.chatStream()
    -> POST /api/v1/chat/stream
      -> chat.route.ts
        -> ChatAgentRuntimeAdapter
          -> Mastra Agent.stream(..., { maxSteps: 10 })
            -> Mastra webSearchTool
              -> executeTool('web_search')
                -> src/server/tools/web-search.ts
          -> Mastra stream chunks -> BloomAI RuntimeEvent
        -> SSE: tool_call_start / tool_call_result / assistant_delta / done
      -> ChatStore reducer
        -> Timeline
          -> ToolCallCard
          -> MessageBubble
```

## 5. 后端设计

### 5.1 新增目录

```text
src/server/agent/
  index.ts
  mastra/
    mastra-instance.ts
    chat-agent.ts
    bloomai-web-search.tool.ts
    mastra-event-mapper.ts
    chat-agent-runtime-adapter.ts
```

### 5.2 Mastra 实例

`mastra-instance.ts` 负责创建 Mastra 实例，并注册第一版 chat agent。

草案：

```ts
import { Mastra } from '@mastra/core'
import { chatAgent } from './chat-agent'

export const mastra = new Mastra({
  agents: { chatAgent },
})
```

### 5.3 Chat Agent

`chat-agent.ts` 定义第一版 ReAct-style Agent。

设计要点：

- Agent instructions 明确要求：需要最新资料、外部事实、搜索请求时使用 `web_search`。
- 不要求每轮都搜索，由模型自行判断。
- 工具只挂载 `web_search`。
- 模型必须使用后台 `Settings -> Models` 中当前生效的值，并优先尊重 session model override。
- `chat-agent.ts` 不写死模型；由 adapter 在每次请求时解析 BloomAI 当前模型，再创建或获取对应 Mastra Agent。
- 如果当前设置的模型无法映射到 Mastra model，返回友好错误或通过 feature flag 回退旧 chat。

草案：

```ts
import { Agent } from '@mastra/core/agent'
import { bloomaiWebSearchTool } from './bloomai-web-search.tool'

export function createChatAgent(model: string) {
  return new Agent({
    id: 'bloomai-chat-agent-v1',
    name: 'BloomAI Chat Agent v1',
    instructions: `
      You are BloomAI, a helpful AI assistant.
      Use ReAct-style reasoning internally: decide, act with tools when useful, observe results, then answer.
      Use web_search when the user asks for current information, latest news, links, external facts, prices, versions, or web research.
      Do not call tools unnecessarily.
      When search results are used, synthesize the answer clearly and mention useful source links when available.
    `,
    model,
    tools: { web_search: bloomaiWebSearchTool },
  })
}
```

`model` 参数由 `chat-agent-runtime-adapter.ts` 在运行时传入，来源顺序与现有聊天一致：persona override -> session model -> `Settings -> Models` 当前配置 -> 系统 fallback。adapter 负责把 BloomAI 模型 id 映射为 Mastra 可识别的 model 表达。

### 5.4 BloomAI web_search 包装为 Mastra tool

`bloomai-web-search.tool.ts` 将现有工具系统包装成 Mastra tool。

关键要求：

- 使用 `createTool`。
- input schema 为 `{ query: string; limit?: number }`。
- execute 内部调用 `executeTool('web_search', input, sessionId)`。
- sessionId 通过 Mastra execution context / requestContext / adapter closure 传入。
- 不直接 import `webSearchTool` 执行，避免绕过 `tool_runs`、timeout、enabled 状态。

草案：

```ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { executeTool } from '../../tools/execute-tool'

export const bloomaiWebSearchTool = createTool({
  id: 'web_search',
  description: 'Search the web and return relevant results with titles, URLs, and snippets.',
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().optional().default(8),
  }),
  outputSchema: z.object({
    query: z.string(),
    total: z.number().optional(),
    results: z.array(z.object({
      title: z.string(),
      url: z.string().optional(),
      snippet: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ query, limit }, context) => {
    const sessionId = context?.runtimeContext?.sessionId
    return executeTool('web_search', { query, limit }, sessionId)
  },
})
```

如果 Mastra 当前 `execute` context 结构与草案不同，实现时以实际 `@mastra/core` 类型为准，保持“通过 adapter 注入 sessionId”的设计不变。

### 5.5 ChatAgentRuntimeAdapter

`chat-agent-runtime-adapter.ts` 是 chat 与 Mastra Agent 的过渡层。

职责：

- 接收 `sessionId`、用户输入、prompt context、模型配置。
- 按现有聊天模型优先级解析模型：persona override -> session model -> `Settings -> Models` 当前配置 -> fallback。
- 将解析出的 BloomAI 模型 id 映射为 Mastra model 表达，并传入 `createChatAgent(model)`。
- 调用 `agent.stream(content, { maxSteps: 10, onChunk })`。
- 将 Mastra chunk 转换为 BloomAI SSE 事件。
- 收集 `toolCalls`、`toolResults`、`usage`、最终文本。
- 返回 trace，用于写入 `messages.tool_calls`。

伪流程：

```ts
const stream = await agent.stream(content, {
  maxSteps: 10,
  toolChoice: 'auto',
  requestContext: { sessionId },
  onChunk: chunk => emit(mapMastraChunkToBloomEvent(chunk)),
})

for await (const text of stream.textStream) {
  emit({ type: 'assistant_delta', text })
}

const toolCalls = await stream.toolCalls
const toolResults = await stream.toolResults
const usage = await stream.usage
```

为了减少 v1 复杂度，可以先使用 `fullStream` 做事件映射；如果具体 chunk 类型兼容有差异，再退回 `onChunk + stream.toolCalls/toolResults` 的组合方案。

## 6. SSE 事件协议

v1 推荐事件：

```ts
type ChatSseEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; call: ToolCallData }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs?: number }
  | { type: 'tool_call_error'; callId: string; error: string }
  | { type: 'done'; tokens?: { input: number; output: number }; trace?: ChatToolTrace }
  | { type: 'error'; error: string }
```

前端兼容策略：

- `delta` 保持现有行为，继续累积 assistant 文本。
- `tool_call_start` 创建一张 running 状态 ToolCallCard。
- `tool_call_result` 将对应卡片更新为 success，并展示 output。
- `tool_call_error` 将对应卡片更新为 error。
- `done` 持久化最终消息，并触发重新加载消息。

## 7. 前端设计

### 7.1 ChatStore

`src/renderer/store/index.ts` 增加工具调用状态：

```ts
toolCallsBySession: Record<string, ToolCallData[]>
```

处理新事件：

- `tool_call_start`：append running call
- `tool_call_result`：按 callId 更新 success
- `tool_call_error`：按 callId 更新 error

### 7.2 Timeline

`Timeline` 需要支持在一轮 assistant streaming 前展示工具卡片。

v1 简化方案：

- 当前 session 的 in-flight tool calls 显示在 streaming assistant bubble 之前。
- 历史消息中的 `tool_calls` 后续再渲染；v1 可以先只保证 streaming 时可见。
- 后续持久化后再将 `messages.tool_calls` 渲染为历史 ToolCallCard。

### 7.3 ToolCallCard

复用现有 `ToolCallCard`。

需要小改：

- 增加 `callId` 字段，方便更新状态。
- 修复当前 emoji 乱码显示，优先使用 lucide 图标或纯文本 category。
- 确保 `web_search` output.results 展示 Top 3，与 roadmap 的“完成、耗时、结果条数、摘要”一致。

## 8. 后端文件变更清单

新增：

- `src/server/agent/index.ts`
- `src/server/agent/mastra/mastra-instance.ts`
- `src/server/agent/mastra/chat-agent.ts`
- `src/server/agent/mastra/bloomai-web-search.tool.ts`
- `src/server/agent/mastra/mastra-event-mapper.ts`
- `src/server/agent/mastra/chat-agent-runtime-adapter.ts`
- `src/server/agent/mastra/model-map.ts`

修改：

- `package.json`
  - 增加 `@mastra/core`
  - 如 Mastra 模型路由需要额外 provider 包，按实际安装文档补充

- `src/server/routes/chat.route.ts`
  - 改为调用 `runChatAgentV1`
  - 仍保留旧 `streamChatCompletion` 作为 fallback 开关

- `src/server/db/repositories/message.repo.ts`
  - 继续使用 `tool_calls` 保存 trace 摘要

- `src/renderer/api/index.ts`
  - 扩展 chat stream event union

- `src/renderer/store/index.ts`
  - 增加 tool call reducer

- `src/renderer/pages/Chat/Timeline.tsx`
  - 渲染 streaming tool calls

- `src/renderer/pages/Chat/ToolCallCard.tsx`
  - 增加 callId，优化 web_search 展示

## 9. 关键开关

为降低风险，建议 v1 加 feature flag：

```text
settings.agent_runtime_enabled = true | false
settings.agent_runtime_provider = mastra
settings.agent_runtime_max_steps = 10
```

默认策略：

- 开发环境默认开启。
- 生产环境可默认关闭，或只对新 session 开启。
- 如果 Mastra 初始化失败、模型不支持、依赖未安装，回退到原 chat route。

## 10. ReAct 与 max loop

v1 不自研 ReAct。使用 Mastra Agent 的开放式工具循环作为 ReAct-style 实现：

- Agent 根据用户目标决定是否调用 `web_search`。
- 调用工具后观察结果。
- 可继续调用工具或输出最终答案。
- `maxSteps` 默认 10，防止无限 loop。

建议常量：

```ts
export const DEFAULT_AGENT_MAX_STEPS = 10
```

请求可覆盖，但必须设置上限：

```ts
const maxSteps = Math.min(input.maxSteps ?? DEFAULT_AGENT_MAX_STEPS, 10)
```

## 11. 持久化设计

v1 不新增 Agent 表，快速复用现有结构：

- `messages.content`：最终 assistant 文本
- `messages.tool_calls`：本轮工具 trace 摘要 JSON
- `tool_runs`：由 `executeTool` 自动记录 `web_search` 执行

`messages.tool_calls` 示例：

```json
{
  "runtime": "mastra-chat-agent-v1",
  "maxSteps": 10,
  "toolCalls": [
    {
      "callId": "call_123",
      "toolId": "web_search",
      "status": "success",
      "input": { "query": "...", "limit": 8 },
      "durationMs": 389,
      "outputSummary": "6 results"
    }
  ]
}
```

## 12. 错误处理

- Mastra stream 报错：发送 `error` SSE，保留已生成文本。
- `web_search` 报错：发送 `tool_call_error`，由 Agent 决定是否继续回答；若 Mastra 终止，则显示友好错误。
- loop 超过 10：返回当前最好答案，或提示“已达到工具调用上限”。
- 搜索返回空结果：ToolCallCard 显示 success，但结果为空，Agent 用空结果继续回答。
- 权限拒绝：v1 `web_search` 为 network 低危，默认不弹窗；后续 write/shell 再接权限弹窗。

## 13. 测试策略

### 13.1 单元测试

- `bloomai-web-search.tool.test.ts`
  - 调用 Mastra tool 时内部走 `executeTool('web_search')`
  - input schema 校验 query
  - output 可被 ToolCallCard 使用

- `mastra-event-mapper.test.ts`
  - `tool-call` chunk 映射为 `tool_call_start`
  - `tool-result` chunk 映射为 `tool_call_result`
  - text delta 映射为 `delta`
  - error 映射为 `tool_call_error` 或 `error`

- `chat-agent-runtime-adapter.test.ts`
  - 调用 `agent.stream` 时传入 `maxSteps: 10`
  - 可收集 final text、tool calls、tool results、usage

- `ChatStore` reducer 测试
  - running -> success
  - running -> error
  - 多个 tool call 顺序稳定

- `ToolCallCard` 测试
  - running / success / error 三态
  - web_search 结果只默认展示 Top 3

### 13.2 集成测试

后端集成测试：

1. mock Mastra Agent stream
2. POST `/api/v1/chat/stream`
3. 验证 SSE 包含 `tool_call_start`
4. 验证 SSE 包含 `tool_call_result`
5. 验证 SSE 包含 `delta`
6. 验证 `messageRepo.save` 写入 assistant content 和 tool_calls

工具链路集成测试：

1. mock `fetch` DuckDuckGo 返回
2. Mastra web_search tool 调用 `executeTool`
3. `tool_runs` 记录 success
4. output.results 可渲染

前端集成测试：

1. mock `platform.chatStream` 返回 tool call + delta
2. Timeline 出现 ToolCallCard
3. ToolCallCard 成功态显示结果摘要
4. streaming text 正常追加

### 13.3 手动验收

- 输入：“帮我搜索 OpenAI 最新 Responses API 文档并总结”
- UI 先出现 `web_search` running 卡片
- 搜索成功后卡片显示 Done、耗时、Top 3 结果
- assistant 最终回答流式出现
- `tool_runs` 中有 `web_search` success 记录
- `messages.tool_calls` 有本轮 trace
- loop 不超过 10 步

## 14. 实施顺序

1. 安装 Mastra 依赖，并确认项目能 build。
2. 新增 `src/server/agent/mastra` 目录。
3. 包装 `web_search` 为 Mastra tool。
4. 创建 `chatAgent`。
5. 创建 `chat-agent-runtime-adapter`。
6. 修改 `chat.route.ts`，通过 feature flag 切换 Mastra Agent。
7. 扩展 SSE 事件类型。
8. 扩展前端 ChatStore，支持 tool call 状态。
9. Timeline 渲染 ToolCallCard。
10. 补单元测试和集成测试。
11. 手动验收搜索场景。

## 15. 风险与取舍

### 15.1 Mastra 模型映射风险

当前 BloomAI 有自有 LLM provider runtime，Mastra 使用自己的 model 表达。v1 必须使用后台 `Settings -> Models` 中当前生效的模型值，而不是在 Agent 中写死模型。

模型来源顺序：

1. persona model override
2. session model
3. `Settings -> Models` 当前配置
4. 系统 fallback

adapter 负责把解析出的 BloomAI model id 映射为 Mastra model 表达：

```ts
const MODEL_MAP = {
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'claude-3-5-sonnet-20241022': 'anthropic/claude-3-5-sonnet-20241022',
}
```

如果后台设置的模型尚未支持 Mastra 映射，v1 应返回友好错误，或在 feature flag 允许时回退到旧 LLM runtime。DeepSeek、Agnes、Ollama 可在 v2 接入。

### 15.2 Tool call 实时事件风险

Mastra stream 的 `fullStream` chunk 类型需要以实际安装版本为准。若实时 tool call chunk 不稳定，v1 可以先：

- 使用 `onChunk` 优先映射
- stream 结束后用 `stream.toolCalls` / `stream.toolResults` 补齐
- UI 仍能在最终完成时展示工具卡片

### 15.3 权限风险

v1 只挂载 `web_search`，避免 write/shell 权限弹窗阻塞第一版。后续工具接入时再统一接权限弹窗。

## 16. 验收证据

- `package.json` 包含 Mastra 依赖
- `src/server/agent/mastra/chat-agent.ts` 存在
- `src/server/agent/mastra/bloomai-web-search.tool.ts` 存在
- `chat.route.ts` 能通过 feature flag 调用 Mastra Agent
- SSE 中可观察到 `tool_call_start / tool_call_result / delta / done`
- 前端聊天流显示 ToolCallCard
- `web_search` 通过 `executeTool` 执行并写入 `tool_runs`
- `messages.tool_calls` 保存本轮 trace
- 测试覆盖后端 adapter、tool wrapper、event mapper、前端 reducer、ToolCallCard

## 17. 结论

v1 应该用 Mastra Agent 直接实现 chat -> agent -> tool 的最短路径。BloomAI 不自研 ReAct loop，而是通过 Mastra Agent 的工具循环和 `maxSteps: 10` 快速获得可用 Agent 能力。

这一版的核心价值不是做完整 Agent 平台，而是打通用户可见的第一条闭环：聊天输入、Agent 判断、调用 `web_search`、Tool Call 卡片可视化、最终流式回答。这个闭环跑通后，再继续扩展 AgentSpec、AgentRun、team、workflow、market，会更稳。



