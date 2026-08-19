# BloomAI 固定工作区侧栏重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 BloomAI 左侧改造成约 328px 的统一工作区侧栏，包含文字导航、聊天列表、项目树、“更多...”浮层和底部设置，同时保持现有页面与会话业务能力。

**Architecture:** 新增 `WorkspaceSidebar` 作为唯一左侧壳层，固定渲染在所有页面旁边；将现有 `ProjectSessionSidebar` 改成统一滚动区域中的聊天/项目内容，继续复用现有 stores、API、会话操作和项目弹窗。导航入口负责页面切换或触发动作，聊天/项目条目在任意页面点击后切回聊天页。

**Tech Stack:** React 18、TypeScript、Zustand、lucide-react、CSS design tokens、Vitest、Vite/Electron。

---

## 文件结构与职责

### 新建

- `src/renderer/components/layout/WorkspaceSidebar.tsx`
  - 统一左侧栏、顶部快捷入口、“更多...”浮层、底部设置、创建项目弹窗状态。
  - 导出 `workspaceNavigationItems` 与 `moreNavigationItems`，供测试验证入口顺序和页面映射。
- `src/renderer/pages/Chat/session-time.ts`
  - 提供纯函数 `formatSessionRelativeTime(timestamp, now)`，将会话更新时间格式化为中文相对时间。
- `src/renderer/pages/Chat/session-time.test.ts`
  - 覆盖分钟、小时、天和未来时间的格式化规则。
- `src/renderer/components/layout/WorkspaceSidebar.test.ts`
  - 覆盖顶部导航顺序、更多菜单内容和页面映射。

### 修改

- `src/renderer/App.tsx`
  - 所有页面统一渲染 `WorkspaceSidebar`；聊天页只渲染 `ChatPanel`，避免重复侧栏。
- `src/renderer/components/layout/NavSidebar.tsx`
  - 改为兼容导出层，避免旧测试或外部引用失效；实际 UI 由 `WorkspaceSidebar` 承担。
- `src/renderer/components/layout/NavSidebar.test.ts`
  - 改为验证新的导航项定义，不再验证旧的图标导航顺序。
- `src/renderer/pages/Chat/ProjectSessionSidebar.tsx`
  - 移除拖拽分隔器、比例状态和 pointer 事件；变成聊天/项目统一内容区。
  - 接收 `createProjectOpen` 与 `onCreateProjectOpenChange`，供顶部“项目”按钮打开原有创建项目弹窗。
- `src/renderer/pages/Chat/ProjectSessionSidebar.test.tsx`
  - 保留项目展开状态测试，移除已删除的区域比例测试。
- `src/renderer/pages/Chat/RecentSessions.tsx`
  - 标题改为 `聊天 (N)`，移除重复的新建按钮，点击列表项时切换到聊天页。
- `src/renderer/pages/Chat/RecentSessions.test.tsx`
  - 保留分页 helper 测试，并增加聊天标题/计数 helper 测试。
- `src/renderer/pages/Chat/ProjectSessions.tsx`
  - 点击项目内会话前切换到聊天页；会话行继续复用 `SessionRow`。
- `src/renderer/pages/Chat/SessionRow.tsx`
  - 增加相对时间和项目会话的“本地”标识，保留重命名、删除和键盘选择。
- `src/renderer/pages/Chat/SessionRow.test.tsx`
  - 增加相对时间/项目标识的静态渲染断言。
- `src/renderer/styles/global.css`
  - 新增统一侧栏、文字导航、内容滚动区、底部设置、浮层和会话元信息样式。
  - 删除或停用旧窄图标栏和区域 resize 样式。

### 不修改

- `src/renderer/store/index.ts`：继续复用现有 session/project/UI stores。
- `src/renderer/pages/Chat/CreateProjectDialog.tsx`：保持创建项目表单、目录选择和错误处理不变。
- 后端 API、数据库 schema 和功能页面内部布局。

---

### Task 1: 建立导航数据契约和相对时间纯函数

**Files:**
- Create: `src/renderer/pages/Chat/session-time.ts`
- Create: `src/renderer/pages/Chat/session-time.test.ts`
- Create: `src/renderer/components/layout/WorkspaceSidebar.test.ts`
- Modify: `src/renderer/components/layout/NavSidebar.test.ts`

- [ ] **Step 1: 写相对时间失败测试**

在 `src/renderer/pages/Chat/session-time.test.ts` 写入：

```ts
import { describe, expect, it } from 'vitest'
import { formatSessionRelativeTime } from './session-time'

describe('formatSessionRelativeTime', () => {
  const now = 1_700_000_000_000

  it('formats minutes and hours in Chinese', () => {
    expect(formatSessionRelativeTime(now - 4 * 60_000, now)).toBe('4分钟前')
    expect(formatSessionRelativeTime(now - 3 * 60 * 60_000, now)).toBe('3小时前')
  })

  it('formats days and weeks without a leading zero', () => {
    expect(formatSessionRelativeTime(now - 17 * 24 * 60 * 60_000, now)).toBe('17天前')
    expect(formatSessionRelativeTime(now - 14 * 24 * 60 * 60_000, now)).toBe('14天前')
  })

  it('uses 刚刚 for current and future timestamps', () => {
    expect(formatSessionRelativeTime(now, now)).toBe('刚刚')
    expect(formatSessionRelativeTime(now + 60_000, now)).toBe('刚刚')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

运行：

```powershell
npx vitest run src/renderer/pages/Chat/session-time.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

预期：FAIL，错误指向 `./session-time` 尚不存在。

- [ ] **Step 3: 实现最小相对时间函数**

在 `src/renderer/pages/Chat/session-time.ts` 写入：

```ts
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatSessionRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE) return '刚刚'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}分钟前`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}小时前`
  return `${Math.floor(elapsed / DAY)}天前`
}
```

- [ ] **Step 4: 运行测试确认通过**

运行同一个 Vitest 命令，预期输出 3 个测试通过。

- [ ] **Step 5: 写导航契约测试**

在 `src/renderer/components/layout/WorkspaceSidebar.test.ts` 先针对导出数组写测试：

```ts
import { describe, expect, it } from 'vitest'
import { moreNavigationItems, workspaceNavigationItems } from './WorkspaceSidebar'

describe('workspace sidebar navigation', () => {
  it('keeps the six top-level entries in the requested order', () => {
    expect(workspaceNavigationItems.map((item) => item.label)).toEqual([
      '新建聊天', '项目', '技能', 'AI 画图', '定时任务', '更多...',
    ])
  })

  it('keeps the requested entries inside 更多...', () => {
    expect(moreNavigationItems.map((item) => item.label)).toEqual([
      'MCP Servers', '文章配图', 'Personas', 'Tools',
    ])
  })
})
```

同时把 `src/renderer/components/layout/NavSidebar.test.ts` 改为从 `WorkspaceSidebar` 导入 `workspaceNavigationItems`，删除旧的英文 `Chat` / `Skills` 顺序断言。

- [ ] **Step 6: 运行导航测试确认当前实现失败**

运行：

```powershell
npx vitest run src/renderer/components/layout/WorkspaceSidebar.test.ts src/renderer/components/layout/NavSidebar.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

预期：FAIL，错误指向 `WorkspaceSidebar` 尚不存在。

- [ ] **Step 7: 提交测试契约**

```powershell
git add src/renderer/pages/Chat/session-time.test.ts src/renderer/components/layout/WorkspaceSidebar.test.ts src/renderer/components/layout/NavSidebar.test.ts
 git commit -m "test: define workspace sidebar navigation contract"
```

---

### Task 2: 实现统一侧栏壳层和页面映射

**Files:**
- Create: `src/renderer/components/layout/WorkspaceSidebar.tsx`
- Modify: `src/renderer/components/layout/NavSidebar.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: 实现导航数组和侧栏状态**

在 `WorkspaceSidebar.tsx` 中定义固定的导航数据：

```tsx
export const workspaceNavigationItems = [
  { id: 'new-chat', label: '新建聊天', icon: Plus, kind: 'action' as const },
  { id: 'project', label: '项目', icon: FolderPlus, kind: 'action' as const },
  { id: 'skills', label: '技能', icon: Puzzle, page: 'skills' as const, kind: 'page' as const },
  { id: 'image', label: 'AI 画图', icon: Image, page: 'image' as const, kind: 'page' as const },
  { id: 'schedules', label: '定时任务', icon: CalendarClock, page: 'schedules' as const, kind: 'page' as const },
  { id: 'more', label: '更多...', icon: MoreHorizontal, kind: 'menu' as const },
]

export const moreNavigationItems = [
  { id: 'mcp-servers', label: 'MCP Servers', icon: ServerCog, page: 'mcp-servers' as const },
  { id: 'article-illustration', label: '文章配图', icon: BookImage, page: 'article-illustration' as const },
  { id: 'personas', label: 'Personas', icon: User, page: 'personas' as const },
  { id: 'tools', label: 'Tools', icon: Wrench, page: 'tools' as const },
]
```

`WorkspaceSidebar` 必须持有以下状态：

```tsx
const [moreOpen, setMoreOpen] = useState(false)
const [createProjectOpen, setCreateProjectOpen] = useState(false)
```

新建聊天动作复用当前 store：

```tsx
const createRegularSession = async () => {
  setPage('chat')
  const session = await createSession({ persona_id: activePersonaId || undefined })
  await loadMessages(session.id)
}
```

项目动作只执行：

```tsx
onClick={() => setCreateProjectOpen(true)}
```

页面动作统一调用 `setPage(item.page)` 并关闭 `moreOpen`。

- [ ] **Step 2: 实现“更多...”悬浮交互**

用一个包住触发按钮和菜单的 `ref` 区域实现 hover 保持：

```tsx
const moreRegionRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  if (!moreOpen) return
  const handlePointerDown = (event: PointerEvent) => {
    if (!moreRegionRef.current?.contains(event.target as Node)) setMoreOpen(false)
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setMoreOpen(false)
  }
  document.addEventListener('pointerdown', handlePointerDown)
  document.addEventListener('keydown', handleKeyDown)
  return () => {
    document.removeEventListener('pointerdown', handlePointerDown)
    document.removeEventListener('keydown', handleKeyDown)
  }
}, [moreOpen])
```

触发区域需要同时支持：

- `onMouseEnter={() => setMoreOpen(true)}`
- `onFocus={() => setMoreOpen(true)}`
- `onMouseLeave={() => setMoreOpen(false)}`
- `onClick={() => setMoreOpen((value) => !value)}`
- `aria-expanded={moreOpen}`

菜单项点击后执行 `setPage(item.page)` 和 `setMoreOpen(false)`。

- [ ] **Step 3: 将旧 NavSidebar 变为兼容导出**

把 `src/renderer/components/layout/NavSidebar.tsx` 改成：

```tsx
export {
  WorkspaceSidebar as NavSidebar,
  workspaceNavigationItems as mainNavigationItems,
} from './WorkspaceSidebar'
```

这样旧引用仍可编译，但不会再保留旧的 48px 侧栏实现。

- [ ] **Step 4: 修改 App 布局为统一侧栏**

`src/renderer/App.tsx` 使用：

```tsx
import { WorkspaceSidebar } from '@renderer/components/layout/WorkspaceSidebar'
```

JSX 布局调整为：

```tsx
<div className="app-shell">
  <WorkspaceSidebar />
  {activePage === 'chat' && <ChatPanel />}
  {activePage === 'image' && <ImageStudioPage />}
  {/* 其余页面分支保持现有实现 */}
</div>
```

删除 `NavSidebar` 和 `ProjectSessionSidebar` 在 `App.tsx` 中的直接渲染，避免出现重复侧栏。

`WorkspaceSidebar` 内部必须渲染统一内容区并把创建项目弹窗状态传给它：

```tsx
<ProjectSessionSidebar
  createProjectOpen={createProjectOpen}
  onCreateProjectOpenChange={setCreateProjectOpen}
/>
```

- [ ] **Step 5: 运行类型检查和导航测试**

运行：

```powershell
npm run typecheck
npx vitest run src/renderer/components/layout/WorkspaceSidebar.test.ts src/renderer/components/layout/NavSidebar.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

预期：类型检查退出码为 0，两个导航测试文件全部通过。

- [ ] **Step 6: 提交统一侧栏壳层**

```powershell
git add src/renderer/components/layout/WorkspaceSidebar.tsx src/renderer/components/layout/NavSidebar.tsx src/renderer/App.tsx
git commit -m "feat: add unified workspace sidebar shell"
```

---

### Task 3: 将聊天/项目内容改成统一滚动区域

**Files:**
- Modify: `src/renderer/pages/Chat/ProjectSessionSidebar.tsx`
- Modify: `src/renderer/pages/Chat/ProjectSessionSidebar.test.tsx`
- Modify: `src/renderer/pages/Chat/RecentSessions.tsx`
- Modify: `src/renderer/pages/Chat/RecentSessions.test.tsx`
- Modify: `src/renderer/pages/Chat/ProjectSessions.tsx`

- [ ] **Step 1: 删除项目/聊天区域 resize 状态和事件**

从 `ProjectSessionSidebar.tsx` 删除以下状态和引用：

```tsx
const [projectSectionRatio, setProjectSectionRatio] = useState(0.5)
const [isResizing, setIsResizing] = useState(false)
const sidebarRef = useRef<HTMLElement>(null)
const projectSectionRef = useRef<HTMLElement>(null)
const recentSectionRef = useRef<HTMLElement>(null)
const resizerRef = useRef<HTMLDivElement>(null)
```

同时删除 `clampProjectSectionRatio`、`projectSectionRatioFromPointer`、`handleResizeStart`、`handleResizeMove`、`handleResizeEnd`、`handleResizeKeyDown` 及 resize separator JSX。

保留 `toggleExpandedProjectId` 和 `expandProjectId`，因为项目树仍需要独立展开状态。

- [ ] **Step 2: 改造组件 props 和统一内容结构**

将组件签名改为：

```tsx
export function ProjectSessionSidebar({
  createProjectOpen,
  onCreateProjectOpenChange,
}: {
  createProjectOpen: boolean
  onCreateProjectOpenChange: (open: boolean) => void
})
```

返回结构改为一个连续滚动区域中的两个 section：

```tsx
return <div className="workspace-sidebar-content" aria-label="聊天和项目">
  <section className="workspace-section" aria-labelledby="projects-title">
    <SidebarSectionHeader
      title={`项目 (${projects.length})`}
      titleId="projects-title"
      expanded={projectsSectionExpanded}
      onToggle={() => setProjectsSectionExpanded((value) => !value)}
    />
    {projectsSectionExpanded && <div className="workspace-section-content">{/* 项目树 */}</div>}
  </section>
  <section className="workspace-section" aria-labelledby="recent-sessions-title">
    <RecentSessions
      expanded={recentSectionExpanded}
      onToggle={() => setRecentSectionExpanded((value) => !value)}
    />
  </section>
  <CreateProjectDialog
    open={createProjectOpen}
    onClose={() => onCreateProjectOpenChange(false)}
    onCreated={(projectId) => {
      setExpandedProjectIds((current) => expandProjectId(current, projectId))
      setProjectListExpanded(true)
      setProjectsSectionExpanded(true)
      onCreateProjectOpenChange(false)
    }}
  />
</div>
```

不要给项目行增加 `⌘` 或其它快捷键文本。

- [ ] **Step 3: 更新最近聊天标题和页面切换**

在 `RecentSessions.tsx`：

```tsx
const { setPage } = useUIStore()

const createRegularSession = async () => {
  setPage('chat')
  const session = await createSession({ persona_id: activePersonaId || undefined })
  await loadMessages(session.id)
}
```

每个会话的 `onSelect` 先调用 `setPage('chat')`，再设置 active session 和加载消息。

`SidebarSectionHeader` 的标题改为：

```tsx
title={`聊天 (${recentTotal})`}
```

删除 header 上重复的新建按钮，顶部“新建聊天”作为唯一入口。

在 `RecentSessions.test.tsx` 增加纯函数：

```tsx
export function recentSectionTitle(total: number): string {
  return `聊天 (${total})`
}
```

断言 `recentSectionTitle(4) === '聊天 (4)'`。

- [ ] **Step 4: 更新项目内聊天的页面切换**

在 `ProjectSessions.tsx` 增加：

```tsx
const { setPage } = useUIStore()
```

项目内 `SessionRow` 的 `onSelect` 改为先 `setPage('chat')`，再调用 `setActiveSession` 和 `loadMessages`。

- [ ] **Step 5: 更新项目侧栏测试**

`ProjectSessionSidebar.test.tsx` 删除对以下函数的导入和断言：

```tsx
clampProjectSectionRatio
projectSectionRatioFromPointer
```

保留并继续验证：

- `toggleExpandedProjectId` 只切换选中的项目。
- `expandProjectId` 不会收起其它项目。

- [ ] **Step 6: 运行聊天/项目测试**

运行：

```powershell
npx vitest run src/renderer/pages/Chat/ProjectSessionSidebar.test.tsx src/renderer/pages/Chat/RecentSessions.test.tsx src/renderer/pages/Chat/ProjectTree.test.tsx src/renderer/pages/Chat/ProjectSessions.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

预期：相关测试全部通过。

- [ ] **Step 7: 提交统一内容区**

```powershell
git add src/renderer/pages/Chat/ProjectSessionSidebar.tsx src/renderer/pages/Chat/ProjectSessionSidebar.test.tsx src/renderer/pages/Chat/RecentSessions.tsx src/renderer/pages/Chat/RecentSessions.test.tsx src/renderer/pages/Chat/ProjectSessions.tsx
git commit -m "feat: simplify workspace chat and project sections"
```

---

### Task 4: 增加会话时间与项目元信息

**Files:**
- Modify: `src/renderer/pages/Chat/SessionRow.tsx`
- Modify: `src/renderer/pages/Chat/SessionRow.test.tsx`
- Create: `src/renderer/pages/Chat/session-time.ts`（Task 1 已创建）

- [ ] **Step 1: 写会话行静态渲染断言**

在 `SessionRow.test.tsx` 增加测试用 session：

```tsx
const session = {
  id: 'session-1',
  title: '项目分析聊天',
  persona_id: null,
  model: 'test-model',
  status: 'idle',
  project_id: 'project-1',
  created_at: 1_700_000_000_000,
  updated_at: 1_699_998_560_000,
}
```

使用现有 `renderToStaticMarkup` 渲染 `SessionRow`，断言结果包含 `本地`、`4小时前` 和聊天标题。

- [ ] **Step 2: 实现会话元信息布局**

在 `SessionRow.tsx` 引入：

```tsx
import { formatSessionRelativeTime } from './session-time'
```

将标题 body 改为：

```tsx
<div className="session-item-body">
  <div className="session-item-title">{session.title}</div>
  <div className="session-item-meta">
    {session.project_id && <span className="session-local-badge">本地</span>}
    <span>{formatSessionRelativeTime(session.updated_at)}</span>
  </div>
</div>
```

保留右侧重命名和删除按钮，以及当前 `tabIndex`、Enter、Space 行为。

- [ ] **Step 3: 运行会话行测试**

运行：

```powershell
npx vitest run src/renderer/pages/Chat/SessionRow.test.tsx src/renderer/pages/Chat/session-time.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

预期：会话行和时间格式化测试全部通过。

- [ ] **Step 4: 提交会话元信息**

```powershell
git add src/renderer/pages/Chat/SessionRow.tsx src/renderer/pages/Chat/SessionRow.test.tsx src/renderer/pages/Chat/session-time.ts src/renderer/pages/Chat/session-time.test.ts
git commit -m "feat: show session recency metadata in sidebar"
```

---

### Task 5: 完成固定侧栏视觉样式

**Files:**
- Modify: `src/renderer/styles/global.css`

- [ ] **Step 1: 增加统一侧栏样式**

在 `global.css` 的布局区域增加：

```css
.workspace-sidebar {
  width: 328px;
  flex: 0 0 328px;
  min-width: 328px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary);
  border-right: 0.5px solid var(--border-tertiary);
}
.workspace-sidebar-navigation {
  display: grid;
  gap: 2px;
  flex: 0 0 auto;
  padding: 8px;
}
.workspace-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 38px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
}
.workspace-nav-item:hover,
.workspace-nav-item:focus-visible,
.workspace-nav-item.active {
  background: var(--bg-tertiary);
  outline: none;
}
.workspace-nav-item-icon {
  display: inline-flex;
  flex: 0 0 18px;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}
.workspace-sidebar-content {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 6px 8px 12px;
}
.workspace-section + .workspace-section {
  margin-top: 10px;
}
.workspace-sidebar-settings {
  flex: 0 0 auto;
  padding: 8px;
  border-top: 0.5px solid var(--border-tertiary);
}
```

- [ ] **Step 2: 增加项目/聊天行样式**

增加：

```css
.workspace-section-title {
  min-height: 28px;
  padding: 0 8px 4px;
}
.project-row {
  min-height: 34px;
  padding: 0 8px;
}
.project-row-name,
.session-item-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-item {
  min-height: 40px;
  padding: 5px 8px;
}
.session-item-body {
  min-width: 0;
}
.session-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 10px;
  white-space: nowrap;
}
.session-local-badge {
  padding: 1px 5px;
  border: 0.5px solid var(--border-secondary);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
```

确保项目行没有 `⌘` 字符样式或文本；新建项目内聊天按钮只在 hover/focus 显示。

- [ ] **Step 3: 增加“更多...”浮层样式**

增加：

```css
.workspace-more-region {
  position: relative;
}
.workspace-more-menu {
  position: absolute;
  top: 0;
  right: 8px;
  z-index: 50;
  width: 168px;
  padding: 7px;
  border: 0.5px solid var(--border-tertiary);
  border-radius: 12px;
  background: var(--bg-primary);
  box-shadow: var(--shadow-md);
}
.workspace-more-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 34px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
}
.workspace-more-menu-item:hover,
.workspace-more-menu-item:focus-visible {
  background: var(--bg-secondary);
  outline: none;
}
```

浮层右边缘与侧栏右边缘对齐，浮层宽度和圆角接近上传图二。

- [ ] **Step 4: 删除旧 resize 与窄栏样式依赖**

删除或覆盖以下规则，避免旧结构继续影响布局：

```css
.nav-sidebar
.sidebar-section-resizer
.project-session-sidebar.is-resizing
.project-sidebar-section
.recent-sessions-section
```

保留通用 `.sidebar-section-title`、`.sidebar-section-toggle`、`.sidebar-more-button` 等被新结构继续使用的样式，但不能再依赖 `flex` 比例或 pointer resize。

- [ ] **Step 5: 运行类型检查**

运行：

```powershell
npm run typecheck
```

预期：退出码 0。

- [ ] **Step 6: 提交固定视觉样式**

```powershell
git add src/renderer/styles/global.css
git commit -m "feat: style fixed workspace sidebar"
```

---

### Task 6: 绘制原型图并进行浏览器交互验证

**Files:**
- Create: `docs/superpowers/prototypes/workspace-sidebar-prototype.html`
- Create: `docs/superpowers/prototypes/workspace-sidebar-prototype.png`

- [ ] **Step 1: 创建静态原型页面**

在 `workspace-sidebar-prototype.html` 中使用与生产侧栏一致的 328px 宽度、浅色 tokens 和示例数据，至少包含：

- 新建聊天、项目、技能、AI 画图、定时任务、更多...
- `聊天 (4)` 和 4 条示例聊天
- `项目 (4)`、展开项目和项目内聊天
- 一条灰色选中会话
- 更多菜单的展开态
- 底部设置
- 右侧主内容占位

使用原生 HTML/CSS/JS，不引入新的运行时依赖；原型只用于可视化，不替代生产 React 组件。

- [ ] **Step 2: 运行原型并截图**

使用仓库已有 Node 运行时和 Playwright 能力打开本地 HTML，截图输出：

```powershell
node -e "const { chromium } = require('playwright-core'); (async()=>{ const b=await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}); const p=await b.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1}); await p.goto('file:///D:/codeproject/JS/bloomai/docs/superpowers/prototypes/workspace-sidebar-prototype.html'); await p.screenshot({path:'D:/codeproject/JS/bloomai/docs/superpowers/prototypes/workspace-sidebar-prototype.png', fullPage:true}); await b.close() })()"
```

预期：生成可预览的 PNG，左侧工作区侧栏与参考图结构一致。

- [ ] **Step 3: 浏览器验证交互**

验证以下行为：

1. 鼠标划过“更多...”显示右侧浮层。
2. 鼠标移动到浮层内，浮层不消失。
3. 鼠标离开触发区和浮层，浮层关闭。
4. 点击“更多...”菜单项后浮层关闭。
5. 点击聊天/项目 section 标题可展开/收起。
6. 设置位于底部。
7. 页面高度变化时只有中间内容区域滚动。

- [ ] **Step 4: 提交原型图**

```powershell
git add docs/superpowers/prototypes/workspace-sidebar-prototype.html docs/superpowers/prototypes/workspace-sidebar-prototype.png
git commit -m "docs: add workspace sidebar prototype"
```

---

### Task 7: 完整回归验证

**Files:**
- No new files.

- [ ] **Step 1: 运行受影响 Renderer 测试**

```powershell
npx vitest run src/renderer/components/layout src/renderer/pages/Chat --pool=forks --maxWorkers=1 --minWorkers=1
```

预期：所有受影响测试通过，失败数为 0。

- [ ] **Step 2: 运行类型检查和构建**

```powershell
npm run typecheck
npm run build
```

预期：两个命令退出码均为 0，生成 `dist` 和 `dist-electron` 构建产物。

- [ ] **Step 3: 运行全量测试**

```powershell
npm test
```

预期：Vitest 全量测试通过，失败数为 0；如果外部服务 fixture 失败，记录首个失败测试及其是否与本次侧栏改动相关，不修改无关模块。

- [ ] **Step 4: 检查最终变更和约束**

```powershell
git diff --check
git status --short
git log -8 --oneline
```

人工确认：

- 侧栏为固定 328px。
- 没有拖拽分隔器。
- 没有折叠侧栏按钮。
- 项目行没有 `⌘`。
- 设置固定在底部。
- “更多...”浮层包含四个指定入口。
- 生产侧栏和原型图中的导航顺序一致。

- [ ] **Step 5: 最终提交或汇总**

若前述验证均通过，将剩余修改提交为：

```powershell
git add src docs/superpowers/prototypes
git commit -m "feat: redesign BloomAI workspace sidebar"
```

若已有分任务提交，则只需确认工作区无未提交的本次改动，并在最终说明中列出每个验证命令及结果。
