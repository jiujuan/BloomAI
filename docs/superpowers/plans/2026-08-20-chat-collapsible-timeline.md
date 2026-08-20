# 聊天可折叠工作摘要时间线 UI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变聊天协议、模型行为和 Deep Research 工作台的前提下，将普通聊天改造成“右侧用户问题气泡 + 助手工作摘要折叠时间线 + 无气泡最终回答”的中文 UI。

**Architecture:** 新增一个纯函数展示模型，把现有 `parts` 分成活动摘要和最终回答；新增一个 React 时间线展示组件统一处理活动分组、中文状态、箭头语义和默认展开策略。现有工具详情、Markdown、审批、计划和 Deep Research 组件继续复用，消息持久化仍使用现有 JSON `parts`。

**Tech Stack:** React 18、TypeScript、Lucide React、现有 `@renderer` alias、Vitest、现有 `global.css` 设计变量。

**Design reference:** `D:\codeproject\JS\bloomai\docs\superpowers\specs\2026-08-19-chat-collapsible-timeline-design.md`

---

## 文件结构与职责

本次实施只涉及普通 Chat renderer 和定向测试：

- **Create:** `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\chat-timeline.ts`
  - 纯 TypeScript 展示模型、part 分组、中文标签、状态和默认展开策略。
  - 不包含 React、DOM、CSS 或持久化逻辑。
- **Create:** `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\ChatTimeline.tsx`
  - 用户问题、助手回合、工作摘要、活动行、待回答状态和计划提案的 React 组件。
  - 负责本地折叠状态、键盘交互、详情组件组合和消息操作菜单。
- **Create:** `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\chat-timeline.test.ts`
  - 纯函数和展示模型的 Vitest 测试，不引入新的 React 测试依赖。
- **Modify:** `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\ChatPanelMastra.tsx`
  - 接入新时间线组件，传入消息 id、流式状态、审批回调和 Deep Research 打开回调。
  - 删除旧的头像/助手气泡渲染分支，保留会话、发送、持久化和错误处理逻辑。
- **Modify:** `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\ToolGroupCard.tsx`
  - 提供时间线详情模式，保留工具调用详情复用能力，并把可见状态改成中文。
- **Modify:** `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\WorkflowSteps.tsx`
  - 将未知工作流/步骤名称的可见回退文案改为中文，支持时间线详情样式。
- **Modify:** `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\SkillRunPart.tsx`
  - 将技能运行卡片中仍存在的英文标题和元数据改成中文；保留刷新和打开详情行为。
- **Modify:** `D:\codeproject\JS\bloomai\src\renderer\styles\global.css`
  - 重做消息布局、用户气泡、工作摘要行、活动详情、状态、焦点和窄屏规则。
  - 保留非 Chat 页面和 Deep Research 工作台样式。
- **Modify:** `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\ChatPanelMastra.test.ts`
  - 只在移动纯 helper 后补充导入/兼容性断言；主要新增行为测试放在 `chat-timeline.test.ts`。

不修改服务端、数据库 schema、`restoreParts()` 的存储格式、Deep Research 状态机或聊天输入区。

## Task 1: 建立助手回合的纯展示模型

**Files:**
- Create: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\chat-timeline.ts`
- Create: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\chat-timeline.test.ts`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\ChatPanelMastra.tsx:101-190`（只在 helper 被移动时更新 import）

- [ ] **Step 1: 先写展示模型的失败测试。**

在 `chat-timeline.test.ts` 中使用现有 Vitest 风格，覆盖以下输入和输出：

```ts
import { describe, expect, it } from 'vitest'
import {
  buildAssistantTurnModel,
  activityLabelForTool,
  defaultActivityOpen,
} from './chat-timeline'

const tool = (name: string, state = 'output-available', output?: unknown) => ({
  type: `tool-${name}`,
  toolCallId: `${name}-1`,
  state,
  input: { path: 'src/example.ts' },
  output,
})

describe('buildAssistantTurnModel', () => {
  it('separates final text from work activities', () => {
    const result = buildAssistantTurnModel([
      { type: 'reasoning', text: '先检查文件', state: 'done' },
      tool('fs_read'),
      { type: 'text', text: '检查完成。' },
    ])

    expect(result.activities).toHaveLength(2)
    expect(result.activities[0]).toMatchObject({ kind: 'reasoning', label: '思考过程', expandable: true })
    expect(result.activities[1]).toMatchObject({ kind: 'tool', label: '读取文件', expandable: true })
    expect(result.answerParts).toEqual([{ type: 'text', text: '检查完成。' }])
  })

  it('groups only adjacent tool calls with the same semantic name', () => {
    const result = buildAssistantTurnModel([tool('shell_run'), tool('shell_run'), tool('fs_read'), tool('shell_run')])

    expect(result.activities.filter((item) => item.kind === 'tool')).toHaveLength(3)
    expect(result.activities[0].parts).toHaveLength(2)
    expect(result.activities[1].parts).toHaveLength(1)
    expect(result.activities[2].parts).toHaveLength(1)
  })

  it('does not create a fake activity for plain text or unknown non-renderable parts', () => {
    const result = buildAssistantTurnModel([
      { type: 'text', text: '只有答案。' },
      { type: 'step-start' },
      { type: 'data-context-compacted' },
    ])

    expect(result.activities).toEqual([])
    expect(result.answerParts).toEqual([{ type: 'text', text: '只有答案。' }])
  })
})

describe('timeline labels and defaults', () => {
  it('uses Chinese labels for known tools', () => {
    expect(activityLabelForTool('fs_read')).toBe('读取文件')
    expect(activityLabelForTool('shell_run')).toBe('运行命令')
    expect(activityLabelForTool('web_search')).toBe('搜索资料')
  })

  it('keeps critical activities open by default', () => {
    expect(defaultActivityOpen({ status: 'running', critical: true }, { streaming: true, historical: false })).toBe(true)
    expect(defaultActivityOpen({ status: 'permission', critical: true }, { streaming: false, historical: true })).toBe(true)
    expect(defaultActivityOpen({ status: 'success', critical: false }, { streaming: false, historical: true })).toBe(false)
  })
})
```

- [ ] **Step 2: 运行新测试，确认当前缺少 helper。**

Run:

```powershell
npx vitest run src/renderer/pages/Chat/parts/chat-timeline.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because `chat-timeline.ts` and its exported functions do not exist yet.

- [ ] **Step 3: 写入纯模型类型和分组算法。**

在 `chat-timeline.ts` 定义以下稳定接口：

```ts
export type ChatActivityKind =
  | 'reasoning'
  | 'tool'
  | 'workflow'
  | 'plan'
  | 'skill'
  | 'approval'
  | 'error'
  | 'research'

export type ChatActivityStatus = 'running' | 'success' | 'error' | 'permission' | 'neutral'

export type ChatActivity = {
  id: string
  kind: ChatActivityKind
  label: string
  status: ChatActivityStatus
  critical: boolean
  expandable: boolean
  parts: any[]
}

export type AssistantTurnModel = {
  activities: ChatActivity[]
  answerParts: any[]
}

export function buildAssistantTurnModel(parts: any[]): AssistantTurnModel
export function activityLabelForTool(name: string): string
export function defaultActivityOpen(
  activity: Pick<ChatActivity, 'status' | 'critical'>,
  context: { streaming: boolean; historical: boolean },
): boolean
```

实现规则：

1. `text` part 进入 `answerParts`，保留原字符串和原顺序。
2. `reasoning` 进入一个可展开的 `思考过程` 活动；空 reasoning 且不在流式状态时忽略。
3. 连续同名 `isToolPart()` 进入同一个工具活动，调用 `toToolCallView()` 判断状态；活动 label 通过工具名映射到 `读取文件`、`运行命令`、`搜索资料`、`生成图片`、`处理视频` 或 `工具调用`。
4. `data-workflow`、`data-plan`、`data-skill-run`、`data-tool-call-approval`、`data-error`、`data-research-run` 分别映射到中文活动类型。
5. `data-tool-call-approval`、`data-error`、运行中工具和等待输入的技能运行标记为 `critical: true`。
6. 未知 part、`step-start`、空数据和当前没有明确协议的上下文压缩 part 不创建活动；不能凭 CSS 或固定文案伪造“上下文已自动压缩”。
7. 活动 id 使用 `activity-${partIndex}`，工具组使用第一个调用的 index；不依赖数组引用，保证历史消息重新加载后稳定。
8. `expandable` 只有存在可显示详情时才为 true；静态活动项不显示箭头。

工具状态聚合顺序必须是：`running` > `error` > `permission` > `success`；这与现有 `ToolGroupCard` 的关键状态优先级一致。

- [ ] **Step 4: 实现中文标签和默认展开策略。**

`activityLabelForTool()` 使用小写工具名匹配：

```ts
if (name.includes('search') || name.includes('web')) return '搜索资料'
if (name.includes('fs') || name.includes('file') || name.includes('doc')) return '读取文件'
if (name.includes('shell') || name.includes('bash') || name.includes('runner')) return '运行命令'
if (name.includes('image')) return '生成图片'
if (name.includes('video')) return '处理视频'
return '工具调用'
```

`defaultActivityOpen()` 必须满足：

- 流式运行中的活动打开。
- 待确认、失败和等待输入活动打开。
- 历史成功活动收起。
- 当前非关键已完成活动保留打开，避免流式完成瞬间跳变。

- [ ] **Step 5: 运行测试并提交纯模型。**

Run:

```powershell
npx vitest run src/renderer/pages/Chat/parts/chat-timeline.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: PASS。

Commit:

```powershell
git add src/renderer/pages/Chat/parts/chat-timeline.ts src/renderer/pages/Chat/parts/chat-timeline.test.ts
git commit -m "feat(chat): add assistant timeline display model"
```

## Task 2: 创建统一的聊天时间线 React 组件

**Files:**
- Create: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\ChatTimeline.tsx`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\ToolGroupCard.tsx`（只调用其时间线详情接口，不在本任务中改变工具数据逻辑）

- [ ] **Step 1: 定义组件 props，固定消息操作和审批接口。**

在 `ChatTimeline.tsx` 使用现有类型和回调，组件接口固定为：

```ts
export type ChatTimelineApprovalProps = {
  decidedApprovals: Record<string, boolean>
  onDecide: (approvalId: string, approved: boolean) => void
}

export type AssistantTurnProps = ChatTimelineApprovalProps & {
  messageId: string
  parts: any[]
  streaming?: boolean
  onOpenResearchRun?: (runId: string) => void
}

export type UserQuestionProps = {
  parts: any[]
}

export function UserQuestion(props: UserQuestionProps): React.ReactElement
export function AssistantTurn(props: AssistantTurnProps): React.ReactElement
export function PendingAssistantTurn(): React.ReactElement
```

`UserQuestion` 继续使用 `useSelectionMenu()` 和 `AttachmentChips`，但输出结构只允许 `msg-group user`、`msg-col`、`msg-bubble user`，不渲染 `msg-avatar`。

- [ ] **Step 2: 写摘要标题和活动行。**

`TurnActivitySummary` 在有活动时渲染：

```tsx
<section className="assistant-activity-summary" aria-label="助手工作摘要">
  <button
    type="button"
    className="assistant-activity-summary-head"
    aria-expanded={summaryOpen}
    aria-controls={`${messageId}-activities`}
    onClick={() => setSummaryOpen((open) => !open)}
  >
    <span>{summaryLabel}</span>
    {summaryOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
  </button>
  {summaryOpen && (
    <div id={`${messageId}-activities`} className="assistant-activity-list">
      {activities.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}
    </div>
  )}
</section>
```

摘要标题规则：

- 当前流式且有内存耗时：显示 `已工作 X 分 Y 秒`。
- 没有可靠耗时：显示 `工作摘要`，不能显示伪造数字。
- 活动项本身存在 `running`、`permission`、`error` 时，摘要收起后仍显示关键状态行；最终回答始终保留。

`ActivityItem` 必须使用真实 `<button>` 作为可展开标题：

```tsx
<button
  type="button"
  className="assistant-activity-row"
  aria-expanded={activity.expandable ? open : undefined}
  aria-controls={activity.expandable ? detailId : undefined}
  disabled={!activity.expandable}
  onClick={activity.expandable ? () => setOpen((value) => !value) : undefined}
>
  <ActivityIcon kind={activity.kind} status={activity.status} />
  <span className="assistant-activity-label">{activity.label}</span>
  <ActivityStatus status={activity.status} />
  {activity.expandable && (open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />)}
</button>
```

实现时不要给静态行设置 `aria-expanded`，也不要通过 CSS 旋转一个 ChevronDown 来伪造关闭状态。

- [ ] **Step 3: 实现活动详情渲染。**

`ActivityDetails` 按 `activity.kind` 渲染：

- `reasoning`：使用无边框的 `<div className="assistant-activity-text">`，显示 `parts` 中 reasoning 文本。
- `tool`：将连续工具 part 转换为 `ToolCallView[]`，调用 `ToolGroupCard` 的 `details-only` 模式；详情内部保留输入摘要、输出摘要、错误、权限提示、结果链接和截图缩略图。
- `workflow`：复用 `WorkflowSteps`，外层放入 `.assistant-activity-details`。
- `plan`：复用 `PlanCard`，历史 `data-plan` 只读显示。
- `skill`：复用 `SkillRunPart`，保留刷新和状态轮询。
- `approval`：复用 `ApprovalCard`；未处理状态始终展开，不允许通过摘要总开关隐藏批准/拒绝按钮。
- `error`：渲染 `timeline-error-block`，设置 `role="alert"`，错误内容可见。
- `research`：保持 `ResearchRunPart` 的独立打开入口，不复制研究报告正文；可以显示为静态活动行或直接显示现有入口按钮，但不能嵌入 Deep Research 工作台。

详情容器使用 `id={`${messageId}-${activity.id}-details`}`，折叠时使用条件渲染或 `hidden`，避免读屏器读取隐藏内容。

- [ ] **Step 4: 实现助手最终回答和流式状态。**

`AssistantTurn` 的渲染顺序固定为：

```tsx
<div className="msg-group assistant-turn">
  <div className="msg-col assistant-turn-col">
    {activities.length > 0 && <TurnActivitySummary ... />}
    <div className="assistant-content">
      {answerParts.map(renderAnswerPart)}
      {waitingAfterParts && <PendingAssistantTurn />}
    </div>
    <MessageActions ... />
  </div>
</div>
```

要求：

- 不渲染 `msg-avatar`。
- 不渲染助手外层 `msg-bubble`。
- `text` 使用 `AssistantMarkdown`，继续传递 `streaming`。
- 只有活动没有正文时，流式等待状态显示为紧凑行，不显示空大气泡。
- 错误 part 不再被 `MessageView` 提前 return 掉；它必须进入工作摘要，使关键失败信息和最终 fallback 同时可见。
- 复制文本使用 `assistantPlainText(parts)`，点赞和右键选择菜单保持已有行为。

- [ ] **Step 5: 实现用户问题、待回答和计划提案组件。**

`UserQuestion`：

- 从 `data-attachments` 渲染现有 `AttachmentChips`。
- 文本渲染为右侧 `.msg-bubble.user`。
- 文字为空但有附件时只显示附件，不创建空气泡。

`PendingAssistantTurn`：

```tsx
<div className="assistant-pending" role="status" aria-live="polite">
  <Loader2 size={15} className="msg-waiting-spinner" aria-hidden="true" />
  <span>正在思考…</span>
</div>
```

`PlanProposalTurn` 由 `ChatPanelMastra.tsx` 调用，使用 `UserQuestion` 显示查询，再使用一个活动标题 `执行计划`。状态为 `ready` 时，确认/重新计划按钮必须直接可见；状态为 `proposing` 或 `executing` 时显示中文进度。

- [ ] **Step 6: 运行类型检查，提交 React 组件。**

Run:

```powershell
npm run typecheck
```

Expected: PASS；此时如果尚未接入 `ChatPanelMastra.tsx`，组件可以通过临时导出/未使用检查，但不能留下 `any` 之外的新未定义类型。

Commit:

```powershell
git add src/renderer/pages/Chat/parts/ChatTimeline.tsx

git commit -m "feat(chat): add collapsible assistant timeline components"
```

## Task 3: 接入 ChatPanelMastra 并保留现有业务行为

**Files:**
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\ChatPanelMastra.tsx:1-25, 84-180, 730-785, 1001-1150`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\ChatPanelMastra.test.ts`

- [ ] **Step 1: 替换消息列表的渲染入口。**

在 `ChatPanelMastra.tsx` 引入：

```ts
import {
  AssistantTurn,
  PendingAssistantTurn,
  PlanProposalTurn,
  UserQuestion,
} from './parts/ChatTimeline'
```

消息列表传入稳定的消息 id：

```tsx
{messages.map((message, index) => (
  message.role === 'user' ? (
    <UserQuestion key={message.id} parts={(message as any).parts || []} />
  ) : (
    <AssistantTurn
      key={message.id}
      messageId={message.id}
      parts={(message as any).parts || []}
      streaming={isStreaming && index === messages.length - 1}
      decidedApprovals={decidedApprovals}
      onDecide={handleDecide}
      onOpenResearchRun={openResearchRun}
    />
  )
))}
```

不要改变消息加载、`restoreParts()`、`onFinish`、`onError`、`saveAssistantMessage()` 或审批回调。

- [ ] **Step 2: 删除旧的头像/助手气泡分支。**

删除或迁移以下旧实现，避免新旧 DOM 同时出现：

- `MessageView` 内部的 `msg-avatar` 和助手 `msg-bubble`。
- `UserMessageView` 的 `msg-avatar user`。
- `renderAssistantParts()` 中把所有 part 直接塞进单个助手气泡的逻辑。
- `waitingForAssistant` 中的 AI 头像和等待气泡。
- 只显示 `timeline-error-block` 的早期 return；错误要由 `AssistantTurn` 作为活动项渲染。

保留这些纯逻辑，若已移动到 `chat-timeline.ts` 则更新 import，不重复定义：

- `hasRenderableContent()`。
- `hasAnswerContent()`。
- `errorDataFromParts()`。
- `restoreParts()`。
- `buildErrorAssistantMessage()`。
- `appendErrorAssistantMessage()`。

- [ ] **Step 3: 替换等待状态和内存中的计划提案。**

将现有：

```tsx
{waitingForAssistant && (
  <div className="msg-group">
    <div className="msg-avatar">AI</div>
    <div className="msg-col">
      <div className="msg-bubble streaming waiting">
        <WaitingIndicator />
      </div>
    </div>
  </div>
)}
```

替换为：

```tsx
{waitingForAssistant && <PendingAssistantTurn />}
```

将 `plans.map()` 中的用户头像、AI 头像和助手气泡替换为 `PlanProposalTurn`，并原样传递：

```tsx
<PlanProposalTurn
  key={p.id}
  query={p.query}
  tasks={p.tasks}
  status={p.status}
  onConfirm={p.status === 'ready' ? () => handleConfirm(p) : undefined}
  onReplan={p.status === 'ready' ? () => handleReplan(p) : undefined}
/>
```

不要改变 `handleConfirm()`、`handleReplan()`、`runProposal()` 的状态机。

- [ ] **Step 4: 更新现有 ChatPanel 单元测试的 imports 和兼容断言。**

如果 `hasRenderableContent()` 或 `hasAnswerContent()` 被移动，从 `ChatPanelMastra.test.ts` 改为从新纯模块导入；保留已有的会话标题、Deep Research 路由、错误消息和 `restoreParts()` 测试。

增加以下非 DOM 断言：

```ts
it('keeps persisted assistant parts backward compatible', () => {
  expect(restoreParts({ content: '旧回答', parts: null })).toEqual([
    { type: 'text', text: '旧回答' },
  ])
})
```

- [ ] **Step 5: 运行定向测试和类型检查。**

Run:

```powershell
npx vitest run src/renderer/pages/Chat/parts/chat-timeline.test.ts src/renderer/pages/Chat/ChatPanelMastra.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
npm run typecheck
```

Expected: 两组测试 PASS，类型检查 PASS。

Commit:

```powershell
git add src/renderer/pages/Chat/ChatPanelMastra.tsx src/renderer/pages/Chat/ChatPanelMastra.test.ts
git commit -m "feat(chat): integrate collapsible timeline into chat panel"
```

## Task 4: 统一详情组件的中文文案和嵌入模式

**Files:**
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\ToolGroupCard.tsx`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\WorkflowSteps.tsx`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\SkillRunPart.tsx`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\ReasoningPart.tsx`（仅清理不再使用的旧箭头样式/文案时修改；不改变导出兼容性）

- [ ] **Step 1: 为工具详情增加 `details-only` 模式。**

将 `ToolGroupCard` props 扩展为：

```ts
export type ToolGroupCardProps = {
  name: string
  calls: ToolCallView[]
  variant?: 'card' | 'details-only'
  open?: boolean
  onOpenChange?: (open: boolean) => void
}
```

`variant="details-only"` 时：

- 不渲染自己的标题按钮和第二个箭头。
- 只渲染 `ToolCallRow` 列表。
- 父级 `ActivityItem` 负责唯一的展开/收起状态。
- 保留调用详情、错误、权限提示、链接、截图和 `data-call-id`。

默认 `variant="card"` 维持现有独立组件的兼容行为，避免影响其他潜在调用。

- [ ] **Step 2: 把工具可见状态全部改成中文。**

将 `STATUS_META` 改成：

```ts
const STATUS_META = {
  running: { label: '运行中', icon: <Loader2 size={11} className="spin" /> },
  success: { label: '已完成', icon: <Check size={11} /> },
  error: { label: '失败', icon: <X size={11} /> },
  permission: { label: '等待确认', icon: <ShieldAlert size={11} /> },
}
```

同时把调用详情中的 `running…`、`rendered`、`Permission required`、`call/calls` 替换为 `运行中…`、`已显示`、`需要确认`、`次调用`；原始工具返回的错误文本不翻译，只按后端原文显示。

- [ ] **Step 3: 统一工作流详情的中文回退。**

在 `WorkflowSteps.tsx`：

- 已知 `deep-research`、`plan-questions`、`search-web`、`fetch-content`、`gather-sources`、`research-writer` 保持中文映射。
- 未知名称通过关键词映射到 `撰写报告`、`抓取正文`、`检索资料`、`拆解子问题`，仍未知时显示 `工作流步骤` 或 `步骤 N`，不能调用当前英文 `humanize()` 回退。
- 增加 `embedded?: boolean` prop；嵌入时间线详情时移除外层大卡片边框和重复标题分隔，独立使用时保留旧布局。

- [ ] **Step 4: 统一技能运行卡片文案。**

在 `SkillRunPart.tsx`：

- `Package Skill Run` 改为 `技能运行`。
- `Run` 改为 `运行`，`Version` 改为 `版本`。
- `刷新`、`打开详情`、`需要审批后继续`、`需要补充输入后继续`保持中文。
- 状态沿用现有 `skillRunStatusLabel()`，未知状态显示 `运行中` 或 `状态未知`，不能把原始英文状态直接显示给用户。
- 增加 `embedded?: boolean` prop，在时间线详情中去掉大卡片外边距和多余边框，但保留刷新、打开详情和 `role="alert"`。

- [ ] **Step 5: 保持 reasoning 的旧导出，同时避免新 UI 使用重复折叠头。**

新 `ChatTimeline.tsx` 不再嵌入 `ReasoningPart` 的标题按钮，而是由统一 `ActivityItem` 负责 `思考过程` 行；reasoning 详情只输出正文。`ReasoningPart.tsx` 如无其他调用则只保留现有中文文案和导出，不删除文件，避免以后旧消息/局部页面引用时发生破坏性变化。

- [ ] **Step 6: 运行定向测试和类型检查。**

Run:

```powershell
npx vitest run src/renderer/pages/Chat/parts/chat-timeline.test.ts src/renderer/pages/Chat/ChatPanelMastra.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
npm run typecheck
```

Expected: PASS，且 `rg -n "Running|Done|Failed|Needs permission|Package Skill Run|\brendered\b" src/renderer/pages/Chat` 不应再命中新增时间线可见文案；后端原始字段名和代码注释不作为 UI 文案处理。

Commit:

```powershell
git add src/renderer/pages/Chat/parts/ToolGroupCard.tsx src/renderer/pages/Chat/parts/WorkflowSteps.tsx src/renderer/pages/Chat/parts/SkillRunPart.tsx src/renderer/pages/Chat/parts/ReasoningPart.tsx
git commit -m "feat(chat): localize timeline activity details"
```

## Task 5: 重做消息和活动时间线 CSS

**Files:**
- Modify: `D:\codeproject\JS\bloomai\src\renderer\styles\global.css:356-450`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\styles\global.css:969-1020,1204-1286`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\styles\global.css`（在现有 Chat 相关区域追加窄屏规则，不改其他页面媒体查询）

- [ ] **Step 1: 调整消息基础布局。**

将消息相关 CSS 从头像气泡模型改为：

```css
.msg-group {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 24px;
}
.msg-group.user { justify-content: flex-end; }
.msg-avatar { display: none; }
.msg-col { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.msg-group.user .msg-col { align-items: flex-end; max-width: min(72%, 760px); }
.assistant-turn-col { width: 100%; }
.msg-bubble.user {
  max-width: 100%;
  padding: 10px 14px;
  border: 0;
  border-radius: 18px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}
```

不要把助手正文重新包进 `msg-bubble`；老的 `.msg-bubble` 通用规则只能服务用户气泡或兼容组件。

- [ ] **Step 2: 添加工作摘要和活动行样式。**

新增以下类并保持背景轻量：

```css
.assistant-activity-summary {
  width: 100%;
  margin: 0 0 14px;
  color: var(--text-secondary);
}
.assistant-activity-summary-head,
.assistant-activity-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 40px;
  gap: 8px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}
.assistant-activity-summary-head {
  justify-content: space-between;
  padding: 0 0 10px;
  border-bottom: 0.5px solid var(--border-tertiary);
  font-size: 13px;
}
.assistant-activity-row {
  padding: 0 2px;
  font-size: 13px;
}
.assistant-activity-row:hover,
.assistant-activity-summary-head:hover { color: var(--text-primary); }
.assistant-activity-row:disabled { cursor: default; }
.assistant-activity-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-activity-details { padding: 0 0 8px 24px; color: var(--text-secondary); }
.assistant-activity-text { white-space: pre-wrap; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.assistant-activity-status { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; font-size: 11px; color: var(--text-tertiary); }
```

状态类使用现有变量：`.running` 使用 info，`.success` 使用 success，`.error` 使用 danger，`.permission` 使用 warning。状态颜色之外保留图标和文字。

- [ ] **Step 3: 添加助手正文、操作和等待状态样式。**

新增或调整：

```css
.assistant-content {
  width: 100%;
  color: var(--text-primary);
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.assistant-content > * { max-width: 100%; }
.assistant-pending {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  color: var(--text-tertiary);
  font-size: 13px;
}
.msg-actions { opacity: 0; transition: opacity .15s; }
.msg-group:hover .msg-actions,
.msg-group:focus-within .msg-actions,
.msg-actions.has-liked { opacity: 1; }
```

保留代码块、表格、链接和附件详情的 overflow 规则；不要用 `overflow: hidden` 截断 Markdown 正文。

- [ ] **Step 4: 去除详情组件的重复卡片感。**

在 `.tool-call-group-card.details-only`、`.workflow-card.embedded`、`.skill-run-card.embedded`、`.plan-card.embedded` 等类上：

- 去掉外层大圆角和重复边框。
- 保留错误、待确认和代码/路径详情的局部背景。
- 保留 `.approval-card` 的按钮和警示对比度。
- 工具详情使用 `padding-left: 24px` 对齐活动行内容。
- 不通过 `:has()` 依赖浏览器选择器来改变父级展开状态，直接在 React 上添加 variant class。

- [ ] **Step 5: 添加窄屏和键盘焦点规则。**

在 Chat 相关 CSS 末尾追加：

```css
.assistant-activity-summary-head:focus-visible,
.assistant-activity-row:focus-visible {
  outline: 2px solid var(--border-info);
  outline-offset: 2px;
  border-radius: var(--radius-sm, 6px);
}
@media (max-width: 620px) {
  .msg-group.user .msg-col { max-width: 90%; }
  .assistant-activity-row { align-items: flex-start; min-height: 44px; padding-top: 10px; padding-bottom: 10px; }
  .assistant-activity-label { white-space: normal; overflow-wrap: anywhere; }
  .assistant-activity-details { padding-left: 22px; }
}
```

验证 `prefers-reduced-motion` 下 spinner 和滚动行为不会造成不可用体验；现有全局动画可以继续工作，但新增 transition 不得是阅读内容的必要条件。

- [ ] **Step 6: 运行类型检查和 CSS 变更后的定向测试。**

Run:

```powershell
npm run typecheck
npx vitest run src/renderer/pages/Chat/parts/chat-timeline.test.ts src/renderer/pages/Chat/ChatPanelMastra.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: PASS。

Commit:

```powershell
git add src/renderer/styles/global.css
git commit -m "feat(chat): style collapsible assistant timeline"
```

## Task 6: 完成边界验证和交付检查

**Files:**
- Test: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\chat-timeline.test.ts`
- Test: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\ChatPanelMastra.test.ts`
- Modify: `D:\codeproject\JS\bloomai\src\renderer\pages\Chat\parts\chat-timeline.ts` 或 `ChatTimeline.tsx`，只修复测试发现的问题
- Modify: `D:\codeproject\JS\bloomai\src\renderer\styles\global.css`，只修复视觉/响应式问题

- [ ] **Step 1: 补充关键状态和旧消息测试。**

在 `chat-timeline.test.ts` 增加：

```ts
it('keeps approval, running and error activities critical', () => {
  const result = buildAssistantTurnModel([
    { type: 'data-tool-call-approval', data: { runId: 'r', toolCallId: 't', toolName: 'shell_run', args: { command: 'npm test' } } },
    { type: 'data-error', data: { title: '请求失败', message: '模型配置错误' } },
    tool('shell_run', 'input-available'),
  ])

  expect(result.activities.map((item) => item.critical)).toEqual([true, true, true])
  expect(result.activities.map((item) => item.status)).toEqual(['permission', 'error', 'running'])
})

it('does not show an empty summary for a legacy text-only assistant message', () => {
  expect(buildAssistantTurnModel([{ type: 'text', text: '旧回答' }])).toEqual({
    activities: [],
    answerParts: [{ type: 'text', text: '旧回答' }],
  })
})
```

- [ ] **Step 2: 运行 Chat 定向测试。**

Run:

```powershell
npx vitest run src/renderer/pages/Chat/parts/chat-timeline.test.ts src/renderer/pages/Chat/ChatPanelMastra.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: PASS。

- [ ] **Step 3: 运行类型检查和生产构建。**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: 两条命令均成功；不应出现新增的 TypeScript 错误或 Vite 构建错误。

- [ ] **Step 4: 手动验证桌面端和窄屏交互。**

使用项目现有开发启动方式打开 Chat 页面，逐项验证：

1. 用户问题在右侧浅灰圆角气泡，头像不存在。
2. 助手工作摘要显示在最终回答前，助手正文无大气泡。
3. 摘要标题展开时是向下箭头，收起时是 `>`。
4. 工具活动收起时显示 `>`，打开时显示向下箭头；无详情活动不显示箭头。
5. 收起工作摘要后最终回答仍然可见。
6. 流式工具显示 `运行中` 和 spinner；完成后显示 `已完成`。
7. 失败和待确认活动保持可见；批准/拒绝按钮不被隐藏。
8. 旧的纯文本消息直接显示中文 Markdown，无空摘要。
9. 计划提案的 `是` 和 `重新计划` 可用；确认后不改变原有发送行为。
10. 点击 `深度研究` 活动仍能打开 Deep Research 工作台。
11. 复制、点赞、右键选择菜单、附件 chips 和工具链接仍可用。
12. 620px 左右窄窗口不出现横向溢出，Tab、Enter、Space 可以操作折叠按钮。

- [ ] **Step 5: 只在发现问题时修复并重跑受影响检查。**

每次修复后至少运行：

```powershell
npm run typecheck
npx vitest run src/renderer/pages/Chat/parts/chat-timeline.test.ts src/renderer/pages/Chat/ChatPanelMastra.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

- [ ] **Step 6: 提交最终变更并检查无关文件。**

Run:

```powershell
git status --short
git diff --check
```

Expected：只有本计划列出的 Chat 文件有变更；预先存在的 `D .claude/worktrees/deep-singing-creek` 保持原样，不恢复、不删除、不提交。

完成后提交：

```powershell
git add src/renderer/pages/Chat src/renderer/styles/global.css
git commit -m "feat(chat): finish collapsible timeline UI"
```

## 计划自检

- **规格覆盖：** 用户气泡、助手无气泡、工作摘要、箭头语义、默认展开、关键状态、中文文案、旧消息兼容、耗时不伪造、上下文压缩不伪造、Deep Research 边界、响应式、无障碍、定向测试和构建均有对应任务。
- **范围控制：** 不修改服务端协议、数据库、聊天发送逻辑、输入区和 Deep Research 工作台。
- **类型一致性：** `ChatActivity`、`AssistantTurnModel`、`AssistantTurnProps` 和 `ChatTimelineApprovalProps` 在任务 1/2 中定义后，任务 3/4 按相同名称使用。
- **箭头一致性：** 所有可展开项由父级 `ActivityItem` 唯一负责 `ChevronRight`/`ChevronDown`；详情组件的旧折叠头不会重复出现。
- **状态一致性：** `running`、`error`、`permission` 的临界状态保持可见；历史成功活动默认收起。
- **旧数据一致性：** `restoreParts()` 和 `slimParts()` 不改变；未知 parts 安全忽略，纯文本 fallback 仍可渲染。
- **占位符检查：** 计划中没有 TODO、TBD、FIXME 或未定义的“稍后补充”步骤。
