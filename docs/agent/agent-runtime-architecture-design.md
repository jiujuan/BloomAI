# BloomAI Agent Runtime 架构设计

## 1. 背景

BloomAI 的聊天窗会继续演进为 Agent 入口，但 Agent 不应被设计成 Chat 的附属能力。后续系统会出现独立运行的 Agent、`agent_create`、多 Agent team、agent workflows、agent market 等产品形态，因此运行时核心必须以 Agent 为中心，而不是以 Chat 为中心。

本设计明确一条边界：**不独立建立 `src/server/runtime` 目录。Runtime 是 Agent 的一部分，统一放在 `src/server/agent`。**

`src/server/chat` 只负责聊天入口、SSE、UI 协议适配；`src/server/tools` 只负责工具执行器；`src/server/agent` 承载 Agent Runtime、事件协议、trace、tool call、memory、policy、registry、workflow 等核心能力。

## 2. 核心结论

推荐目录边界：

```text
src/server/chat/
  聊天入口、SSE、UI 协议适配

src/server/agent/
  Agent 核心、Agent Runtime、ReAct、Plan-and-Execute、workflow、registry
  RuntimeEvent、RunTrace、StepTrace、ToolCall、ToolResult
  AgentSpec、AgentRun、ToolPolicy、PermissionPolicy
  Memory、ContextBuilder、Artifact、Output
  AgentRegistry、WorkflowRegistry

src/server/tools/
  工具注册、工具执行器、工具运行记录、工具权限落库
```

`ChatRuntime` 仍可作为过渡程序存在，但它不是长期核心。它最终应退化为“把聊天消息转换成 AgentRun 请求”的入口适配器。

## 3. 设计目标

- 让 Chat 成为 Agent Runtime 的一个入口，而不是 Agent Runtime 的归宿。
- 让未来独立运行的 Agent 不依赖聊天 UI。
- 让 `agent_create`、team、workflows、market 都围绕同一套 Agent 运行模型扩展。
- 让工具调用、权限、trace、memory、artifact 在 Chat、Agent、Workflow 中复用。
- 避免后续再从 `chat` 或独立 `runtime` 目录迁移核心运行时能力。

## 4. 非目标

- 本设计不要求当前一次性实现完整 Agent 系统。
- 本设计不要求立即支持多 Agent team 和 market。
- 本设计不新增独立 `src/server/runtime`。
- 本设计不把 ReAct 或 Plan-and-Execute 写进 `chat.route.ts`。
- 本设计不让前端直接调用工具执行器。

## 5. 模块职责

### 5.1 `src/server/chat`

`chat` 目录是用户从聊天窗进入 Agent Runtime 的适配层。

职责：

- 接收 `/api/v1/chat/stream` 请求
- 读取 session、message、persona、settings
- 构造聊天入口上下文
- 调用 `src/server/agent` 的 Agent Runtime
- 把 Agent Runtime 事件转换为聊天 SSE 事件
- 将最终 assistant message 与 trace 摘要写入消息表

不负责：

- 工具选择
- ReAct loop
- plan-and-execute 编排
- agent/team/workflow 注册
- memory 策略
- 权限策略决策

### 5.2 `src/server/agent`

`agent` 目录是所有智能体能力的核心目录。

职责：

- 定义 Agent Runtime 公共接口
- 定义 RuntimeEvent 事件协议
- 定义 RunTrace / StepTrace
- 定义 ToolCall / ToolResult
- 定义 AgentSpec / AgentRun
- 定义 ToolPolicy / PermissionPolicy
- 定义 Memory / ContextBuilder
- 定义 Artifact / Output
- 定义 AgentRegistry / WorkflowRegistry
- 实现 ReAct Runtime
- 实现 Plan-and-Execute Runtime
- 实现 workflow 编排器
- 支持未来 multi-agent team

### 5.3 `src/server/tools`

`tools` 目录保持工具系统职责，作为 Agent Runtime 的能力提供方。

职责：

- 工具 registry
- 工具 executor
- 工具参数校验
- 工具权限落库
- 工具运行记录 `tool_runs`
- 工具超时、错误、审计

Agent Runtime 通过统一工具执行入口调用工具，不直接绕过 `executeTool`。

## 6. 与 Mastra.ai 的关系

本设计不要求 BloomAI 自研一套与 Mastra.ai 平级竞争的 Agent / Workflow / Tool loop。相反，BloomAI 的 `src/server/agent` 应定位为 **Agent 产品域封装层 + Mastra 适配层**，Mastra.ai 是优先执行引擎。

### 6.1 分层原则

```text
src/server/agent/
  BloomAI Agent 产品域层
  - AgentSpec
  - AgentRun
  - PermissionPolicy
  - ToolPolicy
  - RunTrace / StepTrace
  - Market metadata
  - Team / Workflow 产品模型
  - Mastra adapter

Mastra.ai
  底层执行引擎
  - Agent
  - Workflow
  - Tool
  - Memory
  - streaming
  - steps / toolCalls / toolResults
```

也就是说，BloomAI 的 `AgentSpec` 不必直接等同于 Mastra 的 Agent 实例。`AgentSpec` 是可持久化、可发布、可安装、可在市场流通的产品定义；运行时再由 adapter 将它编译或映射为 Mastra Agent / Workflow。

### 6.2 不重复实现 Mastra 已提供的能力

BloomAI 不应重复实现 Mastra 已经提供的通用能力：

- Agent 的工具选择 loop
- Workflow 的步骤编排
- Tool schema 与执行封装
- Memory 基础能力
- streaming 与 step 输出
- toolCalls / toolResults 结构

BloomAI 应重点封装 Mastra 没有直接替产品做完的部分：

- 本地优先的数据库持久化
- AgentSpec / WorkflowSpec 的产品模型
- agent market 的安装、发布、版本与元数据
- team 中多个 Agent 的成员关系与协作策略
- BloomAI 自有权限策略与安全确认
- tool_runs、agent_runs、agent_run_events 审计
- 聊天 UI 的 SSE 事件映射
- Tool Call 卡片与 Agent Step 可视化

### 6.3 Mastra Adapter

建议在 `src/server/agent` 内部保留 Mastra 适配层：

```text
src/server/agent/mastra/
  mastra-agent-adapter.ts
  mastra-workflow-adapter.ts
  mastra-tool-adapter.ts
  mastra-memory-adapter.ts
```

适配层职责：

- 将 `AgentSpec` 转换为 Mastra Agent 配置
- 将 `WorkflowSpec` 转换为 Mastra Workflow 配置
- 将 BloomAI tools 包装成 Mastra tools
- 将 Mastra 的 steps / toolCalls / toolResults 转换为 BloomAI `RuntimeEvent`
- 将 Mastra 运行结果转换为 BloomAI `RunTrace`、`ToolResult`、`Artifact`、`Output`

### 6.4 关键约束

- BloomAI `src/server/agent` 是产品域与编排边界，不是 Mastra 的替代品。
- Mastra 是首选执行引擎；只有当 Mastra 无法覆盖某个能力时，才在 BloomAI 内做补充实现。
- BloomAI 的事件、trace、权限、market、team 模型必须稳定，不直接泄漏 Mastra 内部对象到 renderer 或数据库 schema。
- Chat、market、team、workflow 都依赖 BloomAI 的 AgentSpec / RuntimeEvent / RunTrace，而不是直接依赖 Mastra SDK 类型。

## 7. 推荐目录骨架

```text
src/server/agent/
  index.ts

  runtime/
    agent-runtime.ts
    react-agent-runtime.ts
    plan-execute-runtime.ts
    runtime-events.ts
    run-trace.ts
    step-trace.ts

  model/
    agent-spec.ts
    agent-run.ts
    agent-step.ts
    agent-output.ts
    artifact.ts

  tools/
    tool-call.ts
    tool-result.ts
    tool-policy.ts
    permission-policy.ts
    tool-router.ts

  memory/
    memory.ts
    context-builder.ts
    context-window.ts

  registry/
    agent-registry.ts
    workflow-registry.ts

  workflow/
    workflow-spec.ts
    workflow-runtime.ts
    workflow-step.ts

  team/
    team-spec.ts
    team-runtime.ts
```

说明：这里的 `runtime/` 是 `src/server/agent/runtime/` 子目录，不是独立的 `src/server/runtime` 模块。它属于 Agent 域内部。

## 8. 核心类型设计

### 8.1 RuntimeEvent

RuntimeEvent 是 Agent Runtime 向外输出的统一事件协议。Chat SSE、Agent run log、workflow 运行日志都从这里派生。

```ts
type RuntimeEvent =
  | { type: 'run_started'; runId: string; agentId: string }
  | { type: 'step_started'; step: StepTrace }
  | { type: 'assistant_delta'; text: string }
  | { type: 'tool_call_started'; toolCall: ToolCall }
  | { type: 'tool_call_completed'; toolCallId: string; result: ToolResult }
  | { type: 'tool_call_failed'; toolCallId: string; error: string }
  | { type: 'artifact_created'; artifact: Artifact }
  | { type: 'run_completed'; trace: RunTrace; output: Output }
  | { type: 'run_failed'; trace: RunTrace; error: string }
```

### 8.2 RunTrace / StepTrace

Trace 是未来可观测性、调试、回放、market 质量评估的基础。

```ts
type RunTrace = {
  runId: string
  agentId: string
  workflowId?: string
  status: 'running' | 'success' | 'error' | 'cancelled'
  steps: StepTrace[]
  toolCalls: ToolCall[]
  artifacts: Artifact[]
  startedAt: number
  finishedAt?: number
}

type StepTrace = {
  stepId: string
  kind: 'reasoning' | 'tool' | 'plan' | 'execute' | 'synthesize'
  title: string
  status: 'running' | 'success' | 'error'
  input?: unknown
  output?: unknown
  error?: string
  startedAt: number
  finishedAt?: number
}
```

### 8.3 ToolCall / ToolResult

ToolCall 是 Agent Runtime 对工具系统的一次调用意图；ToolResult 是工具系统返回给 Agent 的观察结果。

```ts
type ToolCall = {
  id: string
  toolId: string
  status: 'running' | 'success' | 'error'
  input: unknown
  permission?: PermissionPolicy
  runId?: string
  startedAt: number
  finishedAt?: number
}

type ToolResult = {
  toolCallId: string
  output?: unknown
  outputSummary?: string
  error?: string
  durationMs?: number
}
```

### 8.4 AgentSpec / AgentRun

`agent_create` 的结果就是一份 `AgentSpec`。Agent Runtime 读取 `AgentSpec` 创建 `AgentRun`。

```ts
type AgentSpec = {
  id: string
  name: string
  description?: string
  runtime: 'react' | 'plan-and-execute' | 'rule-based-search'
  model: string
  systemPrompt: string
  tools: string[]
  memory?: MemoryPolicy
  permissions?: ToolPolicy
  createdAt: number
  updatedAt: number
}

type AgentRun = {
  id: string
  agentId: string
  input: unknown
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled'
  trace?: RunTrace
  output?: Output
  createdAt: number
  updatedAt: number
}
```

## 9. 产品能力如何挂载

### 9.1 `agent_create`

`agent_create` 不需要发明新运行模型。它只是：

1. 收集名称、描述、system prompt、模型、工具、memory、权限策略
2. 生成 `AgentSpec`
3. 注册到 `AgentRegistry`
4. 后续运行时由 `AgentRuntime` 根据 `AgentSpec` 创建 `AgentRun`

### 9.2 Team

Team 是多个 `AgentSpec` 和成员关系的组合。

```ts
type TeamSpec = {
  id: string
  name: string
  members: Array<{
    agentId: string
    role: string
    handoffPolicy?: string
  }>
  coordinator: 'sequential' | 'manager' | 'debate' | 'vote'
}
```

Team Runtime 不改变工具模型，只改变 Agent 之间的调度方式。

### 9.3 Workflows

Workflow 是换一套 runtime 编排器，不是换一套工具系统。

```ts
type WorkflowSpec = {
  id: string
  name: string
  steps: WorkflowStep[]
}

type WorkflowStep =
  | { type: 'agent'; agentId: string; input: unknown }
  | { type: 'tool'; toolId: string; input: unknown }
  | { type: 'condition'; expression: string }
```

Workflow Runtime 复用 RuntimeEvent、RunTrace、ToolCall、Artifact。

### 9.4 Agent Market

Market 发布和安装的对象是：

- `AgentSpec`
- `WorkflowSpec`
- tool bundle
- prompt / memory / policy preset

Market 不应该发布“某个 chat 页面能力”。Chat 只是安装后调用 Agent 的一个入口。

## 10. Chat 如何接入 Agent Runtime

当前阶段可以保留 `ChatRuntime`，但它应被定义为过渡适配器。

```text
chat.route.ts
  -> ChatRuntimeAdapter
      -> AgentRuntime.run(AgentRunRequest)
          -> RuntimeEvent stream
      -> ChatSseMapper
          -> SSE events for UI
```

`ChatRuntimeAdapter` 的职责：

- 把 `sessionId + user message + persona + model` 转成 `AgentRunRequest`
- 选择默认 Agent 或临时 AgentSpec
- 调用 `AgentRuntime`
- 把 RuntimeEvent 映射成聊天 UI 能理解的事件

后续当用户在 chat 中选择具体 Agent 时：

```text
Chat session
  -> selectedAgentId
  -> AgentRegistry.get(selectedAgentId)
  -> AgentRuntime.run(spec, input)
```

## 11. Tool Calling 与权限

工具调用必须始终经过 `src/server/tools/execute-tool.ts`，这样才能统一：

- enabled / disabled 状态
- 参数校验
- 权限策略
- timeout
- `tool_runs` 审计
- 错误记录

Agent Runtime 持有的是 `ToolPolicy / PermissionPolicy`，而不是直接绕过工具系统。

权限分层：

- `network`：默认自动放行，例如 `web_search`
- `write`：session 级确认，例如 `fs_write`
- `shell`：高危确认，例如 `shell`

## 12. 数据持久化建议

短期可复用现有表：

- `messages.tool_calls`
- `tool_runs`
- `tools`
- `tool_permissions`

Agent 阶段建议新增：

- `agents`
- `agent_runs`
- `agent_run_events`
- `agent_workflows`
- `agent_teams`
- `agent_market_items`

其中 `agent_run_events` 保存 RuntimeEvent 流，`agent_runs.trace_json` 保存最终 RunTrace 快照。

## 13. 测试策略

### 13.1 单元测试

- AgentSpec 校验
- RuntimeEvent reducer
- RunTrace / StepTrace 生成
- ToolPolicy / PermissionPolicy 决策
- AgentRegistry / WorkflowRegistry 注册与查询
- ChatRuntimeAdapter 映射逻辑

### 13.2 集成测试

- Chat 输入触发默认 AgentRun
- AgentRun 调用 `web_search`
- RuntimeEvent 正确映射为 chat SSE
- ToolCall 写入 `tool_runs`
- AgentRun 写入 trace
- 普通聊天不触发工具
- 工具失败时产生 `tool_call_failed` 和失败 trace

### 13.3 未来 E2E 测试

- 创建 AgentSpec 后从 chat 运行
- 创建 TeamSpec 后多 Agent 接力运行
- 创建 WorkflowSpec 后按步骤运行
- 从 market 安装 AgentSpec 后运行

## 14. 验收证据

- 文档中不存在独立 `src/server/runtime` 目录设计
- `src/server/chat` 被定义为入口适配层
- `src/server/agent` 被定义为 Agent 核心运行区
- RuntimeEvent、RunTrace、ToolCall、Memory、Policy、Registry 均归属 Agent 域
- `agent_create` 被描述为创建 `AgentSpec`
- team 被描述为组合多个 `AgentSpec`
- workflows 被描述为切换编排器
- market 被描述为发布和安装 `AgentSpec` / workflow / tool bundle

## 15. 结论

Agent Runtime 应该成为 BloomAI 后续智能体能力的中心。Chat 是入口，Tools 是执行器，Agent 是运行时和产品模型。Mastra.ai 是优先执行引擎，BloomAI 在其上封装产品域、权限、审计、市场、团队、workflow 和 UI 事件映射。

因此，不应建立独立 `src/server/runtime`。所有运行时事件、trace、tool call、memory、policy、artifact、registry、workflow 都属于 `src/server/agent`。这样后续无论是 `agent_create`、team、workflow，还是 agent market，都可以围绕同一套 Agent 核心模型自然扩展。

