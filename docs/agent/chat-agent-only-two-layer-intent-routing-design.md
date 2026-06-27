# Chat Agent Only With Two-Layer Intent Routing Design

## 目标

以后 chat 界面内容统一进入 Mastra chat agent runtime，不再维护 chat direct LLM 的独立后端路径和前端 legacy 兼容路径。

Agent 是否调用 tools 或 skills，需要经过两层判断：

1. 程序规则先做意图判断。
2. 程序判断不确定时，再交给 LLM 做结构化意图判断。

最终无论是否调用 tools/skills，前端显示仍走现有 v1 `ResponseStreamEvent`、Timeline、group view 和错误展示样式，显示格式不变。其它不再需要的 direct LLM route、legacy stream normalizer、legacy streaming state 和兼容 UI 分支应逐步删除。

## 当前代码现状

当前代码还不是 agent-only 状态。

`src/server/routes/chat.route.ts` 仍同时依赖：

- `streamChatCompletion`
- `mapLlmStreamToResponseEvents`
- `runChatAgentV1`
- `streamLegacyChat`
- `streamMastraChat`
- `agent_runtime_enabled` / `agent_runtime_provider` 开关
- agent 失败后 fallback direct LLM 的逻辑

这意味着后端仍然存在两套 chat runtime：

- Direct LLM runtime。
- Mastra agent runtime。

Task 1 已经新增 Agent Runtime router contract：

- `src/server/agent/runtime/chat-agent-router.ts`
- `DEFAULT_CHAT_AGENT_ID`
- `ChatAgentRouteInput`
- `streamChatAgentRoute`
- `resolveChatAgentRoute`

但是 `chat.route.ts` 还没有正式切换到 router。后续迁移应让 `chat.route.ts` 永远调用 `streamChatAgentRoute`，而不是直接调用 `runChatAgentV1` 或 fallback `streamChatCompletion`。

## 推荐架构

```text
Chat UI
  -> POST /chat/stream

chat.route.ts
  -> buildChatContext
  -> organizeChatPrompt
  -> selectRuntimeModel
  -> streamChatAgentRoute

chat-agent-router.ts
  -> resolve chat agent
  -> run Mastra chat agent runtime

Mastra chat agent runtime
  -> Layer 1: programmatic intent detector
  -> Layer 2: LLM intent classifier when uncertain
  -> dynamic tools/skills enablement
  -> agent answers directly or calls tools/skills before answering

Agent response mapper
  -> v1 ResponseStreamEvent

Frontend
  -> platform.chatStream
  -> reduceStreamingResponse
  -> Timeline
  -> ToolCallGroupCard
  -> TimelineErrorBlock
```

核心原则：

- `chat.route.ts` 只负责 HTTP/SSE、session、message persistence、prompt context 和 model selection。
- Agent Runtime router 只负责选择 chat-capable agent。
- Mastra adapter 负责具体 runtime 执行。
- Intent 判断属于 agent runtime，不属于 route，也不属于 frontend。
- Frontend 不感知 intent，只渲染 v1 response events。

## 设计补强后的模块边界

这份设计拆成 8 个可落地模块。后续 todo task 应围绕这些模块拆分，而不是把后端、intent、skills 和前端删除混在一个大任务里。

| 模块 | 主要职责 | 建议文件 |
|---|---|---|
| Agent Runtime Router | 让 `chat.route.ts` 面向 chat-capable agent 路由，不直接依赖 Mastra adapter | `src/server/agent/runtime/chat-agent-router.ts` |
| Prompt Handoff | 把 `buildChatContext` / `organizeChatPrompt` 的结果完整传入 agent runtime | `src/server/agent/mastra/types.ts`, `src/server/agent/mastra/chat-agent-runtime-adapter.ts` |
| Intent Contract | 定义 intent 输入、输出、能力描述、阈值和 schema | `src/server/agent/runtime/intent/types.ts` |
| Programmatic Intent Detector | 用确定性规则判断 no-tool、tool、skill、tool+skill | `src/server/agent/runtime/intent/programmatic-intent-detector.ts` |
| LLM Intent Classifier | 程序规则不确定时，用 LLM 输出结构化 intent JSON | `src/server/agent/runtime/intent/llm-intent-classifier.ts` |
| Capability Discovery | 汇总可用 tools 和 installed skills，并做 enabled/permission/schema 过滤 | `src/server/agent/runtime/capabilities.ts` |
| Dynamic Mastra Agent Runtime | 根据 intent 动态注入 tools/skills，并统一输出 agent runtime events | `src/server/agent/mastra/chat-agent.ts`, `src/server/agent/mastra/chat-agent-runtime-adapter.ts` |
| V1 Frontend Rendering | 保留 Timeline/group view/error block，只删除 legacy compatibility path | `src/renderer/api/index.ts`, `src/renderer/store/index.ts`, `src/renderer/pages/Chat/Timeline.tsx` |

两个删除边界必须保持清楚：

- 删除的是 chat route 里的 direct LLM 执行路径，不是 provider-level `streamChat` 能力。
- 删除的是前端 legacy stream/UI 兼容路径，不是 v1 `ResponseStreamEvent`、Timeline、ToolCallGroupCard。

## 后端数据流

`chat.route.ts` 应构建完整 context：

```ts
const promptContext = buildChatContext({ sessionId, userContent: content, contextOverride })
const prompt = organizeChatPrompt(promptContext, { maxTokens: 4096 })
```

然后统一进入 router：

```ts
streamChatAgentRoute({
  sessionId,
  agentId,
  content,
  model,
  maxSteps,
  prompt,
})
```

`prompt` 必须包含：

- persona system prompt
- history
- active app context
- clipboard context
- current user message

这是删除 direct LLM 前必须满足的条件。否则 agent-only 迁移会导致 chat memory/persona/context 行为退化。

## 两层意图判断设计

### Intent contract

新增 `src/server/agent/runtime/intent/types.ts`，集中定义 intent contract。这个 contract 是 programmatic detector、LLM classifier、Mastra adapter 和测试共同依赖的稳定接口。

建议类型：

```ts
export type ChatIntentMode = 'answer_only' | 'tool' | 'skill' | 'tool_and_skill'
export type ChatIntentSource = 'programmatic' | 'llm'

export type ToolCapability = {
  id: string
  description: string
  category: 'search' | 'web' | 'file' | 'shell' | 'image' | 'video' | 'tool'
  enabled: boolean
}

export type SkillCapability = {
  id: string
  name: string
  description: string
  type: string
  paramsSchema: Record<string, unknown>
  enabled: boolean
}

export type ChatIntentInput = {
  sessionId: string
  content: string
  prompt: OrganizedChatPrompt
  availableTools: ToolCapability[]
  availableSkills: SkillCapability[]
  contextOverride?: object
}

export type ChatIntentDecision = {
  mode: ChatIntentMode
  confidence: number
  selectedTools: string[]
  selectedSkills: string[]
  reason: string
  source: ChatIntentSource
}
```

设计约束：

- `ChatIntentDecision` 只能选择 `availableTools` / `availableSkills` 中 enabled 的能力。
- `answer_only` 必须对应空的 `selectedTools` 和 `selectedSkills`。
- `tool` 至少有一个 `selectedTools`。
- `skill` 至少有一个 `selectedSkills`。
- `tool_and_skill` 至少同时有一个 tool 和一个 skill。
- intent contract 不包含前端字段，不直接暴露给 renderer。

### Capability discovery

新增 `src/server/agent/runtime/capabilities.ts`，负责为 intent 判断提供当前可用能力。

当前代码里已经存在：

- `src/server/db/repositories/skill.repo.ts`
  - `skillRepo.listInstalled()`
  - `skillRepo.get(id)`
- `src/server/skills/run-skill.ts`
  - `runSkill(skillId, input)`
- `src/server/skills/registry.ts`
  - `skillRunnerRegistry`
- `src/server/agent/mastra/web-search-adapter.tool.ts`
  - `createWebSearchAdapterTool`

建议函数：

```ts
export function listChatToolCapabilities(): ToolCapability[]
export function listChatSkillCapabilities(): SkillCapability[]
export function resolveChatCapabilities(): {
  tools: ToolCapability[]
  skills: SkillCapability[]
}
```

初期 tool capability 可以只包含：

```ts
{
  id: 'web_search',
  category: 'search',
  enabled: true,
  description: 'Search the web for current or external information.'
}
```

Skill capability 从 `skillRepo.listInstalled()` 读取，并将 `params_schema` parse 成 `paramsSchema`。如果 schema parse 失败，该 skill 不应进入 enabled capability，或应被标记为 `enabled: false` 并记录原因。

后续如果加入权限系统，可以在 `resolveChatCapabilities()` 内过滤。不要让 Mastra agent 看到未安装、未启用或无权限的 skills。

### Intent router

新增 `src/server/agent/runtime/intent/chat-intent-router.ts`，组合两层判断。

建议函数：

```ts
export async function resolveChatIntent(input: ChatIntentInput): Promise<ChatIntentDecision>
```

执行逻辑：

1. 调用 `detectProgrammaticIntent(input)`。
2. 如果 `confidence >= PROGRAMMATIC_INTENT_CONFIDENCE_THRESHOLD`，直接返回程序判断。
3. 如果程序判断低置信，调用 `classifyIntentWithLlm(input, programmaticDecision)`。
4. 对 LLM 输出做 schema validation 和 capability filtering。
5. 如果 LLM 失败或输出非法，返回安全 fallback。

推荐 fallback：

```ts
{
  mode: 'answer_only',
  confidence: 0,
  selectedTools: [],
  selectedSkills: [],
  reason: 'Intent classifier failed; defaulting to answer-only mode.',
  source: 'llm'
}
```

这个 fallback 不代表 direct LLM route。它只表示 Mastra agent 不开放 tools/skills，让 agent 直接用当前 model 回答。

### Layer 1: 程序规则判断

新增建议文件：

- `src/server/agent/runtime/intent/chat-intent-router.ts`
- `src/server/agent/runtime/intent/programmatic-intent-detector.ts`

建议输入：

```ts
type ChatIntentInput = {
  sessionId: string
  content: string
  prompt: OrganizedChatPrompt
  availableTools: ToolCapability[]
  availableSkills: SkillCapability[]
  contextOverride?: object
}
```

建议输出：

```ts
type ChatIntentDecision = {
  mode: 'answer_only' | 'tool' | 'skill' | 'tool_and_skill'
  confidence: number
  selectedTools: string[]
  selectedSkills: string[]
  reason: string
  source: 'programmatic' | 'llm'
}
```

程序规则适合处理高确定性场景。

需要 `web_search` 的典型信号：

- 用户说“最新”、“今天”、“新闻”、“查一下”、“搜索”。
- 用户询问价格、版本、官网链接、外部事实。
- 用户要求资料来源、引用链接、当前信息。
- 用户明确要求联网查询。

不需要 tool/skill 的典型信号：

- 普通知识解释。
- 写作、改写、翻译。
- 总结用户已提供内容。
- 代码解释。
- 基于当前 history、persona、clipboard、active app 回答。

需要 skill 的典型信号：

- 用户明确提到某个 skill 名称。
- 用户请求的动作能匹配 skill registry 中的能力描述。
- 用户请求是稳定的本地流程型任务，而不是一次普通问答。

程序规则只应在高置信时直接决定，例如：

```text
confidence >= 0.85
```

低置信或多意图场景交给 Layer 2。

建议规则输出示例：

| 用户意图 | 程序判断 | confidence | 说明 |
|---|---|---:|---|
| “今天 OpenAI 有什么新闻？” | `tool` + `web_search` | 0.95 | 明确当前信息 |
| “查一下 React 19 最新文档” | `tool` + `web_search` | 0.95 | 明确搜索和最新文档 |
| “把这段话翻译成英文” | `answer_only` | 0.9 | 不需要外部工具 |
| “总结我刚才问过什么” | `answer_only` | 0.88 | 依赖 prompt history |
| “运行 skill xxx” | `skill` + `xxx` | 0.95 | 明确 skill id/name |
| “帮我处理这个任务” | 低置信 | 0.4 | 意图模糊，交给 LLM classifier |

程序规则不要尝试覆盖所有自然语言情况。它只负责高确定性路径，避免不必要的 LLM classifier 调用。

### Layer 2: LLM 结构化意图判断

新增建议文件：

- `src/server/agent/runtime/intent/llm-intent-classifier.ts`

LLM intent classifier 不是恢复 direct LLM chat answer。它只是 agent runtime 内部的 planning step，只返回结构化 JSON，不向前端输出正文。

建议输出格式：

```json
{
  "mode": "tool",
  "selectedTools": ["web_search"],
  "selectedSkills": [],
  "confidence": 0.76,
  "reason": "User asks for current external information."
}
```

约束：

- 不允许输出给用户看的回答正文。
- 只允许选择已注册、已启用、被允许的 tools/skills。
- 输出必须 schema validate。
- validation 失败时 fallback 为 `answer_only` 或保守的 safe mode。
- classifier 的 model 仍走现有 model resolution，不新建 provider 系统。

LLM classifier 的实现边界：

- 可以复用 provider-level `streamChatCompletion` 或新增一个 low-level non-stream helper，但它只能在 agent runtime 内部用于 intent classification。
- 不允许从 `chat.route.ts` 直接调用 classifier。
- 不允许 classifier 产出的文本进入 SSE timeline。
- classifier 的 system prompt 应明确要求“只返回 JSON，不回答用户问题”。
- classifier 输出必须经过 Zod 或等价 schema 校验。
- classifier 选择的 tool/skill 必须再经过 capability filtering，不能信任模型输出。

建议 classifier 输入消息：

```ts
{
  system: 'Classify the user intent for tool/skill routing. Return JSON only.',
  messages: [
    { role: 'user', content: buildIntentClassificationPrompt(input, programmaticDecision) }
  ]
}
```

这里使用 provider-level LLM 能力是允许的，因为它不是 chat direct LLM answer path。它不持久化 assistant message，不输出给前端，只产生内部 intent decision。

## Dynamic Tools And Skills Enablement

当前 `src/server/agent/mastra/chat-agent.ts` 只挂载了 `web_search`：

```ts
tools: {
  web_search: createWebSearchAdapterTool({ sessionId: options.sessionId }),
}
```

推荐改为根据 intent 动态注入：

```ts
createChatAgent(model, {
  sessionId,
  prompt,
  intent,
  enabledTools,
  enabledSkills,
})
```

建议扩展 `CreateChatAgentOptions`：

```ts
export type CreateChatAgentOptions = {
  sessionId?: string
  prompt?: OrganizedChatPrompt
  intent?: ChatIntentDecision
  enabledTools?: ToolCapability[]
  enabledSkills?: SkillCapability[]
}
```

`prompt` 用于构造 agent 输入或 runtime instructions，`intent` 用于决定开放哪些 tools/skills。`content` 可以继续作为 convenience field，但不能再是 agent 唯一输入。

当 intent 是 `answer_only`：

```ts
tools: {}
```

Mastra agent 直接使用 LLM model 回答。

当 intent 需要 tool：

```ts
tools: {
  web_search: createWebSearchAdapterTool(...)
}
```

当 intent 需要 skill：

- 将 `src/server/skills/run-skill.ts` 包装成 Mastra tool adapter。
- 每个允许的 skill 暴露为 `skill:<skillId>`。
- skill 执行结果映射为普通 tool result。

建议新增文件：

- `src/server/agent/mastra/skill-adapter.tool.ts`

建议函数：

```ts
export function createSkillAdapterTool(skill: SkillCapability): MastraToolLike
export function createSkillAdapterTools(skills: SkillCapability[]): Record<string, MastraToolLike>
```

执行边界：

- adapter 执行前必须确认 skill 仍然 installed/enabled。
- adapter input 必须按 skill `paramsSchema` 做基础校验。
- adapter 内部调用 `runSkill(skill.id, input)`。
- adapter 捕获错误后应抛给 Mastra，使 mapper 能产生 `tool_call_error` 或 `tool_call_failed`。
- skill output 应保持 object，便于 `summarizeToolOutput` 和 trace persistence。

这样前端不用新增 skill 专属 UI。skill 调用在 Timeline 中仍表现为 tool call group：

```text
type: tool_call
category: tool
toolId: skill:<skillId>
```

Trace 中 skill call 仍使用 `ToolCallTrace`：

```ts
{
  callId: '...',
  toolId: 'skill:<skillId>',
  status: 'success' | 'error',
  input,
  outputSummary,
  durationMs,
}
```

## 前端显示保留方案

现有 v1 显示链应保留：

- `src/shared/schemas/response.ts`
- `src/renderer/store/chat-response-reducer.ts`
- `src/renderer/pages/Chat/Timeline.tsx`
- `src/renderer/pages/Chat/ToolCallGroupCard.tsx`
- `TimelineWaitState`
- `TimelineErrorBlock`
- grouped tool call rendering

错误显示仍走现有事件：

```text
response_failed -> error block -> TimelineErrorBlock
tool_call_failed -> tool group failed / partial failed / interrupted
```

因此前端样式、格式、group view 不需要重新设计。

需要做的是删除 legacy fallback UI，而不是重写现有 v1 UI。

## 后端删除范围

从 `src/server/routes/chat.route.ts` 删除：

- `streamChatCompletion` import。
- `mapLlmStreamToResponseEvents` import。
- `streamLegacyChat`。
- `createLegacyChatSource`。
- `LegacyChatInput`。
- `shouldUseAgentRuntime`。
- `getAgentRuntimeEnabled`。
- `getAgentRuntimeProvider`。
- agent 失败后 fallback direct LLM 逻辑。
- “falling back to direct LLM” 相关日志。

从 `src/server/routes/chat-response-stream.ts` 调整：

- 不再默认 fallback 到 `runtime: 'direct-llm'`。
- 新写入 trace 默认或显式使用 `mastra-chat-agent-v1`。

保留：

- provider `streamChat` 能力。
- `createOllamaProvider`。
- `LlmMessage`。
- model/provider registry。
- image/video generation。
- provider-level tests。

## 前端删除范围

删除或迁移：

- `src/renderer/api/chat-stream-normalizer.ts`
- legacy `ChatStreamEvent` 类型。
- `ChatToolCallStartEvent`
- `ChatToolCallResultEvent`
- `ChatToolCallErrorEvent`
- `streamingText` state。
- `streamError` state，如果错误完全由 v1 error block 渲染。
- `toolCallsBySession` state。
- `clearStreamingToolCalls`。
- Timeline 中非 v1 `streamingResponse` 的 legacy fallback branch。

保留：

- `streamingResponsesBySession`。
- `reduceStreamingResponse`。
- `deriveStreamingText`，如果仍作为 selector 或测试辅助有价值。
- `deriveToolCalls`，如果仍作为 selector 或测试辅助有价值。
- `Timeline`。
- `ToolCallGroupCard`。
- `TimelineErrorBlock`。
- group view 相关 CSS。

## 错误处理策略

Agent-only 后，不再有隐藏 fallback answer。

错误处理规则：

- Agent 在输出前失败：发送 `response_failed`，Timeline 显示 error block。
- Tool 失败但 agent 可以继续：发送 `tool_call_failed`，之后继续 markdown answer；group view 显示 partial failed。
- 必需 tool/skill 失败且 agent 无法继续：发送 `tool_call_failed` 后发送 `response_failed`。
- Agent 已输出部分内容后失败：保留已输出内容，同时通过 v1 failure event 标记失败。
- 不再调用 direct LLM 生成替代回答。

## 风险和缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Agent 没拿到完整 context | memory、persona、active app、clipboard 行为退化 | 删除 direct LLM 前，先完成 organized prompt handoff 并测试 |
| 程序 intent 误判 | 不该调用 tool 时调用，或该调用时未调用 | 高置信才直接决定，低置信交给 LLM classifier |
| LLM classifier 输出不合法 | runtime 决策异常 | 使用 schema validate，失败时保守 fallback |
| skills 权限过宽 | agent 可调用不应调用的能力 | 只开放 selectedSkills，并校验 enabled、permission、input schema |
| 前端误删仍使用的 CSS | UI 回归 | 先删除 legacy data path，再用 rg 和组件测试确认 CSS 使用 |
| 旧 direct trace 无法加载 | 老会话显示异常 | shared schema 中保留旧 trace parsing，禁止新 trace emission |

## 可执行任务拆分准备

后续 todo task 文档应至少包含这些任务，且每个任务都要包含功能目标、功能列表、涉及文件、边界、单元测试、集成测试、用例测试、验收 checkpoint 和关键验收证据。

1. Agent Runtime Router 和 route 接入。
2. Organized prompt handoff 到 Mastra adapter。
3. Intent contract 和 capability discovery。
4. Programmatic intent detector。
5. LLM intent classifier。
6. Intent router 集成两层判断。
7. Dynamic Mastra tools injection。
8. Skill adapter tool。
9. Agent runtime no-tool/tool/skill 路径测试。
10. Backend direct LLM branch 删除。
11. Shared runtime contract 清理 `direct-llm` 新 emission。
12. Frontend legacy stream normalizer 删除。
13. Chat store 单一 v1 streaming response state。
14. Timeline 只渲染 v1 blocks，保留 group view 样式。
15. ToolCallCard legacy shape 和 CSS 安全裁剪。
16. Backend end-to-end verification。
17. Frontend end-to-end verification。
18. Full regression 和 documentation closeout。

## 推荐实施顺序

1. 让 `chat.route.ts` 调用 `streamChatAgentRoute`，并通过测试证明 route 能把完整 prompt 传到 router。
2. 将 `organizeChatPrompt` 的结果完整传入 Mastra adapter 和 agent input，保证 agent 不只看到最新 `content`。
3. 新增 intent contract 和 capability discovery，让后续 programmatic detector、LLM classifier、dynamic tools/skills 共用同一接口。
4. 新增 programmatic intent detector，只处理高置信场景。
5. 新增 LLM intent classifier，作为不确定场景的第二层判断，并确保它只输出结构化 JSON。
6. 新增 intent router，组合 programmatic detector 和 LLM classifier。
7. 改造 `createChatAgent` 和 runtime adapter，根据 intent 动态开放 tools。
8. 增加 skill adapter，将 skill execution 映射成 v1 tool call。
9. 完成 agent runtime 的 no-tool、web_search、skill、failure 测试。
10. 删除 backend direct LLM branch 和 fallback。
11. 删除 frontend legacy normalizer 和 legacy streaming state。
12. 保留 Timeline/group view 样式，只移除 legacy fallback branch。
13. 完成 backend/frontend/shared schema 全链路测试和文档 closeout。

## 验收标准

后端：

- `chat.route.ts` 不再 import `streamChatCompletion`。
- `chat.route.ts` 不再 import `mapLlmStreamToResponseEvents`。
- `chat.route.ts` 不再包含 `streamLegacyChat`。
- Agent failure 不再 fallback direct LLM。
- 新 chat trace 不再发出 `runtime: 'direct-llm'`。
- Provider-level `streamChat`、`createOllamaProvider`、`LlmMessage` 仍保留。

Intent runtime：

- `ChatIntentInput`、`ChatIntentDecision`、`ToolCapability`、`SkillCapability` 有稳定类型定义和 tests。
- Programmatic detector 覆盖 `answer_only`、`web_search`、明确 skill、低置信 fallback。
- LLM classifier 输出经过 schema validation，非法 JSON 或非法 capability 会 fallback 到 safe decision。
- Intent router 高置信时不调用 LLM classifier，低置信时调用 LLM classifier。
- Dynamic Mastra agent 在 `answer_only` 时不注入 tools/skills。
- Dynamic Mastra agent 在 `tool` 时只注入 selected tools。
- Dynamic Mastra agent 在 `skill` 时只注入 selected skills。
- Skill adapter 调用 `runSkill`，并把结果映射为普通 tool call trace。

前端：

- `platform.chatStream` 只 yield v1 `ResponseStreamEvent`。
- 不再 import `createChatStreamNormalizer`。
- Store 以 `streamingResponsesBySession` 为 active response 单一来源。
- Timeline 只从 v1 response blocks 渲染 active assistant output。
- Tool 和 skill 调用通过 `ToolCallGroupCard` 显示。
- Agent error 通过 `TimelineErrorBlock` 显示。

测试：

- No-tool answer：agent 直接回答，trace `toolCalls: []`。
- Web search answer：agent 调用 `web_search`，Timeline 显示 group view。
- Skill answer：agent 调用 `skill:<skillId>`，Timeline 显示 group view。
- Programmatic high-confidence intent：不调用 LLM classifier。
- Programmatic low-confidence intent：调用 LLM classifier。
- LLM classifier failure：fallback 到 safe `answer_only` decision。
- Agent startup failure：只显示 failed response，不出现 fallback answer。
- Old direct trace：如果保留兼容，旧消息仍能加载。

文档完整性：

- 后续 todo task 文档必须覆盖 intent contract、programmatic detector、LLM classifier、capability discovery、dynamic tools injection、skill adapter。
- 每个 task 必须列出涉及函数、接口、文件、边界、测试策略、验收 checkpoint 和关键验收证据。
- 文档末尾必须包含任务依赖、可并行任务、Mermaid 依赖图、阶段 checkpoint 和推荐实施顺序。

## 最终形态

最终 chat 不再是“route 决定 direct LLM 还是 agent”。最终 chat 是：

```text
route 永远进入 agent runtime
agent runtime 判断是否需要 tools/skills
不需要时 agent 直接调用 LLM model 回答
需要时 agent 调用 tools/skills 后回答
前端永远渲染 v1 response stream
```

这能消除双后端路径和双前端兼容路径，同时保留当前 Timeline、group view 和错误展示体验。
