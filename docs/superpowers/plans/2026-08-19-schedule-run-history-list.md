# 定时任务运行记录列表与详情切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在定时任务详情区域保留现有 4 个摘要卡片，并将“运行历史”改为 20 条/页的运行记录列表，支持进入单条执行详情和返回列表。

**Architecture:** 继续使用当前 `SchedulesPage -> ScheduleTaskDetail -> ScheduleRunHistory` 组件链路。运行记录分页状态由 Zustand 定时任务 store 管理，服务端仍使用 cursor API；`ScheduleTaskDetail` 只管理当前任务下的列表/执行详情视图切换，执行详情抽取为单一职责组件。

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, CSS variables in `schedules.css`, existing `lucide-react` and `react-markdown` rendering.

---

### Task 1: 将运行记录 store 改为 20 条/页的可返回分页

**Files:**
- Modify: `src/renderer/pages/Schedules/schedule-task.store.ts`
- Test: `src/renderer/pages/Schedules/schedule-task.store.test.ts`

- [ ] **Step 1: Extend the store state and action contract**

Add page-local maps without changing `ScheduleTaskRunDto`:

```ts
runPageByTaskId: Record<string, number>
runCursorHistoryByTaskId: Record<string, Array<string | undefined>>
runsLoading: boolean
```

Keep `runsByTaskId` as the records for the currently visible page and keep `nextCursorByTaskId` as the next cursor returned by the API. Keep the existing `loadTaskRuns(id, cursor?)` action signature so the page can reset with no cursor and navigate with a cursor.

- [ ] **Step 2: Write failing store assertions for fixed page size and cursor navigation**

Update the existing run-now assertion from `{ limit: 25 }` to `{ limit: 20 }`. Add a test that mocks three pages and verifies:

```ts
await store.loadTaskRuns(task.id)
await store.loadTaskRuns(task.id, 'cursor-page-2')
await store.loadTaskRuns(task.id)

expect(api.listTaskRuns).toHaveBeenNthCalledWith(1, task.id, { limit: 20 })
expect(api.listTaskRuns).toHaveBeenNthCalledWith(2, task.id, { limit: 20, cursor: 'cursor-page-2' })
expect(store.runsByTaskId[task.id]).toEqual(firstPage.items)
expect(store.runPageByTaskId[task.id]).toBe(1)
```

Also assert that a cursor page replaces, rather than appends to, the visible `runsByTaskId` array and that `runsLoading` returns to `false` after success.

- [ ] **Step 3: Run the focused store test and confirm the new assertions fail**

Run:

```powershell
npm test -- src/renderer/pages/Schedules/schedule-task.store.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: the test fails because the store still requests 25 records and appends cursor pages.

- [ ] **Step 4: Implement cursor history and replacement semantics**

Use these rules in `loadTaskRuns`:

```ts
const page = await schedulesApi.listTaskRuns(id, {
  limit: 20,
  ...(cursor ? { cursor } : {}),
})
```

When `cursor` is absent, reset that task’s cursor history to `[undefined]` and page number to `1`. When a cursor is supplied, find it in the task’s cursor history; append it if it is new, set the page number to its one-based index, replace `runsByTaskId[id]` with `page.items`, and set `nextCursorByTaskId[id]` to `page.nextCursor`. Set `runsLoading` to `true` before the request and back to `false` in both success and error paths.

When deleting a task, remove its entries from `runPageByTaskId` and `runCursorHistoryByTaskId` as well as the existing run maps. Initialize the new maps and `runsLoading` in `initialScheduleTaskState`.

- [ ] **Step 5: Run the focused store test and confirm it passes**

Run the command from Step 3. Expected: all tests in `schedule-task.store.test.ts` pass, including the 20-record request and replacement/page-state assertions.

---

### Task 2: Extract the current single-run execution detail view

**Files:**
- Create: `src/renderer/pages/Schedules/ScheduleRunDetail.tsx`
- Test: `src/renderer/pages/Schedules/ScheduleRunDetail.test.tsx`
- Modify: `src/renderer/pages/Schedules/ScheduleRunHistory.tsx`

- [ ] **Step 1: Add a focused failing component test**

Create a fixture run with Markdown output and a failed run with an error. Assert that `ScheduleRunDetail` renders:

- a `返回` button,
- the result status label and trigger label (`手动执行` or `定时触发`),
- the formatted execution time,
- Markdown output for successful runs,
- error text for failed/aborted runs,
- a `复制输出` button when output exists.

- [ ] **Step 2: Run the focused detail test and confirm it fails**

Run:

```powershell
npm test -- src/renderer/pages/Schedules/ScheduleRunDetail.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because the detail component does not exist.

- [ ] **Step 3: Move the existing card detail markup into `ScheduleRunDetail`**

Implement a component with props:

```ts
interface ScheduleRunDetailProps {
  run: ScheduleTaskRunDto
  onBack: () => void
}
```

Use the existing `runOutputText`, `statusLabel`, `formatScheduleTimestamp`, `ReactMarkdown`, `remarkGfm`, copy action, error styling, and status icon behavior. Correct the type name to `ScheduleTaskRunDto` in the actual implementation. Render a top header with a real button labeled `返回`, then render the same output/error content currently shown by each run card.

Export `runOutputText` from the detail module and re-export it from `ScheduleRunHistory` if existing tests or callers still import it there.

- [ ] **Step 4: Run the focused detail test and confirm it passes**

Run the command from Step 2. Expected: all detail assertions pass.

---

### Task 3: Replace the history cards with the required table and pagination controls

**Files:**
- Modify: `src/renderer/pages/Schedules/ScheduleRunHistory.tsx`
- Modify: `src/renderer/pages/Schedules/ScheduleRunHistory.test.tsx`
- Modify: `src/renderer/pages/Schedules/schedules.css`

- [ ] **Step 1: Write failing table/empty-state/pagination assertions**

Update the history tests to render the new props and assert:

```ts
expect(markup).toContain('结果状态')
expect(markup).toContain('运行状态')
expect(markup).toContain('执行时间')
expect(markup).toContain('操作')
expect(markup).toContain('详情')
expect(emptyMarkup).toContain('还没开始执行定时任务')
expect(paginationMarkup).toContain('第 2 页')
expect(paginationMarkup).toContain('上一页')
expect(paginationMarkup).toContain('下一页')
```

Also assert a run with `finishedAt: null` renders `运行中`, a completed run renders `已完成`, and the “详情” control is a button.

- [ ] **Step 2: Run the focused history test and confirm it fails**

Run:

```powershell
npm test -- src/renderer/pages/Schedules/ScheduleRunHistory.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because the component still renders cards and the old “加载更多记录” control.

- [ ] **Step 3: Implement the table view**

Change `ScheduleRunHistory` props to receive:

```ts
interface ScheduleRunHistoryProps {
  runs: ScheduleTaskRunDto[]
  nextCursor: string | null
  previousCursor?: string
  page: number
  loading: boolean
  onRefresh: () => void
  onLoadPage: (cursor?: string) => void
  onViewDetail: (run: ScheduleTaskRunDto) => void
}
```

Render a semantic `<table>` with exactly the four requested headers. For each run:

- result status uses `schedule-status run-${run.status}` and `statusLabel(run.status)`;
- running status uses `schedule-status active` plus `运行中` when `finishedAt === null`, otherwise `schedule-status paused` plus `已完成`;
- execution time uses `formatScheduleTimestamp(run.finishedAt ?? run.startedAt)`;
- operation is a text button labeled `详情` calling `onViewDetail(run)`.

Render a `colSpan={4}` empty row with centered text `还没开始执行定时任务`. Render bottom controls with `上一页`, `第 ${page} 页`, and `下一页`; disable previous on page 1, disable next when `nextCursor` is null, and disable refresh/pagination buttons while `loading`.

- [ ] **Step 4: Add table, empty-state, and pagination styles**

Add focused classes to `schedules.css` for a bordered table wrapper, table header/body cells, centered empty row, operation link-style button, and bottom pager. Reuse existing CSS variables and `.schedule-status` classes. Keep the existing mobile layout by allowing the table wrapper to scroll horizontally below the existing 640px breakpoint.

- [ ] **Step 5: Run the focused history test and confirm it passes**

Run the command from Step 2. Expected: all table, empty-state, status, detail-button, and pager assertions pass.

---

### Task 4: Wire list/detail view switching into the task detail page

**Files:**
- Modify: `src/renderer/pages/Schedules/ScheduleTaskDetail.tsx`
- Modify: `src/renderer/pages/Schedules/SchedulesPage.tsx`
- Modify: `src/renderer/pages/Schedules/SchedulesPage.test.tsx`

- [ ] **Step 1: Add failing integration markup assertions**

Update the page/detail test to assert that the selected-task markup contains the unchanged four summary labels (`状态`, `下次执行`, `上次触发`, `最近结果`), the new table headers, the `详情` action, and no execution output in the default list view. Add a direct detail render test or component fixture assertion for `返回` and the existing output text.

- [ ] **Step 2: Run the focused schedules tests and confirm they fail**

Run:

```powershell
npm test -- src/renderer/pages/Schedules/SchedulesPage.test.tsx src/renderer/pages/Schedules/ScheduleRunHistory.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: FAIL until the new props and list/detail view are wired.

- [ ] **Step 3: Add view state and detail callbacks**

In `ScheduleTaskDetail`, keep `selectedRunId` local. Reset it when `task.id` changes and derive `selectedRun` from the current `runs`; if the selected run is no longer present, render the list instead. Keep the existing header, action buttons, delete confirmation, and four-card summary unchanged.

Render either:

```tsx
<ScheduleRunHistory onViewDetail={(run) => setSelectedRunId(run.id)} ... />
```

or:

```tsx
<ScheduleRunDetail run={selectedRun} onBack={() => setSelectedRunId(null)} />
```

Extend its props with `runPage`, `previousCursor`, `runsLoading`, and `onLoadPage`. In `SchedulesPage`, read `runPageByTaskId`, `runCursorHistoryByTaskId`, and `runsLoading` from the store. Compute the previous cursor from the current page’s cursor history and pass handlers that call `loadTaskRuns(selectedTask.id, cursor)`; refresh calls `loadTaskRuns(selectedTask.id)` so it returns to page 1.

- [ ] **Step 4: Update existing page tests for the default list view**

Keep the current assertions for task name, task status, four summary cards, and no Chat components. Replace the old expectation that the run output appears in the default task detail with assertions for table headers and `详情`; cover empty history with the exact required empty-state text.

- [ ] **Step 5: Run the focused schedules tests and confirm they pass**

Run the command from Step 2. Expected: all updated schedules page/detail/list tests pass.

---

### Task 5: Run the full verification suite

**Files:**
- No source changes expected; inspect `git diff` and test output.

- [ ] **Step 1: Run all schedule page tests**

```powershell
npm test -- src/renderer/pages/Schedules --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: exit code 0 with all schedule tests passing.

- [ ] **Step 2: Run type checking**

```powershell
npm run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: exit code 0 and an updated successful Vite/Electron build.

- [ ] **Step 4: Review the final diff and repository status**

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm only the design/plan documents and intended schedule UI/store/test files are changed; do not modify the pre-existing `.claude/worktrees/deep-singing-creek` deletion.

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- src/renderer/pages/Schedules docs/superpowers/plans/2026-08-19-schedule-run-history-list.md
git commit -m "feat: add scheduled task run history list"
```

Expected: a new commit containing the schedule run history list/detail pagination feature and its implementation plan.

