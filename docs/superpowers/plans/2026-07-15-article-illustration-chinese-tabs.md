# 文章配图中文化与标签页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文章配图页面改为与 AI 画图一致的中文主题界面，提供“文章文本 / 上传文件”与“Skill 优先 / 现有模型兜底”两组无障碍标签页。

**Architecture:** 文章来源的可视选择状态由现有 Zustand Store 保存为 `sourceMode`，使切换标签不会丢失草稿，且创建方案时只提交当前标签的数据。工作台组件导出标签元数据供 Vitest 验证，并以本地 JSX 选择内容面板；后端接口、URL 数据字段和任务流程保持不变，但 URL UI 暂时不显示。

**Tech Stack:** React 18、TypeScript、Zustand、Vitest、CSS 自定义属性。

---

## 文件结构

- 修改：`src/renderer/pages/ImageStudio/article-illustration.store.ts` — 保存当前可视来源模式，并让创建方案按该模式选择 text/file 来源。
- 修改：`src/renderer/pages/ImageStudio/article-illustration.store.test.ts` — 验证切换来源模式不会清空草稿。
- 修改：`src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.tsx` — 导出标签配置，移除 URL UI、中文化全部文案、使用两组标签页。
- 新建：`src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.test.ts` — 验证来源与生成路由标签配置及中文文案。
- 修改：`src/renderer/styles/global.css` — 添加与 AI 画图主题一致的标签、卡片、表单控件和小屏样式。

### Task 1：为当前来源标签增加 Store 合约

**Files:**
- Modify: `src/renderer/pages/ImageStudio/article-illustration.store.ts`
- Modify: `src/renderer/pages/ImageStudio/article-illustration.store.test.ts`

- [ ] **Step 1: 写出会失败的来源模式保留测试**

在 `article-illustration.store.test.ts` 增加：

```ts
it('keeps drafts when switching the active article source mode', () => {
  const store = useArticleIllustrationStore.getState()
  store.setSource({ text: '保留的正文草稿' })
  store.setSourceMode('file')

  expect(useArticleIllustrationStore.getState()).toMatchObject({
    sourceMode: 'file',
    source: { text: '保留的正文草稿' },
  })
})
```

- [ ] **Step 2: 运行该测试并确认 RED**

运行：

```powershell
npx vitest run src/renderer/pages/ImageStudio/article-illustration.store.test.ts --pool=forks
```

预期：失败，提示 `setSourceMode` 不存在或 `sourceMode` 未定义。

- [ ] **Step 3: 在 Store 中实现来源模式与当前来源提交**

在 `State`、`Actions` 和 `initial()` 中添加：

```ts
sourceMode: 'text' | 'file'
setSourceMode: (mode: State['sourceMode']) => void

sourceMode: 'text',
setSourceMode: (sourceMode) => set({ sourceMode }),
```

将 `createPlan` 的来源选择替换为：

```ts
const source = state.sourceMode === 'file'
  ? { type: 'file' as const, filePath: state.source.filePath ?? '', fileName: state.source.fileName ?? '' }
  : { type: 'text' as const, text: state.source.text }
```

这使当前标签为空时仍由既有服务端校验报错，而不会意外执行隐藏的其它来源或 URL。

- [ ] **Step 4: 运行 Store 测试确认 GREEN**

运行：

```powershell
npx vitest run src/renderer/pages/ImageStudio/article-illustration.store.test.ts --pool=forks
```

预期：3 个测试通过。

### Task 2：添加标签元数据测试并改造文章配图工作台

**Files:**
- Create: `src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.test.ts`
- Modify: `src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.tsx`

- [ ] **Step 1: 写出会失败的工作台标签契约测试**

新建测试：

```ts
import { describe, expect, it } from 'vitest'
import { articleExecutionTabs, articleSourceTabs } from './ArticleIllustrationWorkbench'

describe('article illustration tab configuration', () => {
  it('exposes only text and file article source tabs in Chinese', () => {
    expect(articleSourceTabs).toEqual([
      { id: 'text', label: '文章文本' },
      { id: 'file', label: '上传文件' },
    ])
  })

  it('exposes Chinese Skill-first and fallback generation tabs', () => {
    expect(articleExecutionTabs).toEqual([
      { id: 'skill', label: 'Skill 优先' },
      { id: 'fallback', label: '现有模型兜底' },
    ])
  })
})
```

- [ ] **Step 2: 运行工作台测试并确认 RED**

运行：

```powershell
npx vitest run src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.test.ts --pool=forks
```

预期：失败，提示两个标签配置未导出。

- [ ] **Step 3: 定义标签元数据与中文工作台界面**

在组件顶部导出：

```ts
export const articleSourceTabs = [
  { id: 'text' as const, label: '文章文本' },
  { id: 'file' as const, label: '上传文件' },
]
export const articleExecutionTabs = [
  { id: 'skill' as const, label: 'Skill 优先' },
  { id: 'fallback' as const, label: '现有模型兜底' },
]
```

来源区域使用：

```tsx
<div className="article-tabs" role="tablist" aria-label="文章来源">
  {articleSourceTabs.map((tab) => (
    <button
      key={tab.id}
      id={`article-source-tab-${tab.id}`}
      className="article-tab"
      role="tab"
      aria-selected={state.sourceMode === tab.id}
      aria-controls={`article-source-panel-${tab.id}`}
      onClick={() => state.setSourceMode(tab.id)}
    >
      {tab.label}
    </button>
  ))}
</div>
```

来源内容分别使用 `role="tabpanel"` 和对应 `aria-labelledby`：正文输入时执行 `state.setSourceMode('text')` 并清空 file/url；上传成功后执行 `state.setSourceMode('file')` 并清空 text/url。不要渲染 URL 输入或 URL 授权控件。

生成方式以同样的 `article-tabs` 模式渲染，选中状态来自 `state.executionMode`；选择 Skill 时调用：

```ts
state.setExecution('skill', state.selectedSkillVersionId ?? state.eligibleSkills[0]?.skillVersionId)
```

选择兜底时调用 `state.setExecution('fallback')`。仅在 Skill 标签下显示已有 Skill 下拉框。

将整个组件中的可见英文文案替换为中文，包括标题、说明、文件提示、图片配置、权限与预算、创建方案、错误恢复、场景编辑、任务恢复、进度、导出与重试。保留 `Skill`、`Markdown`、`MD/TXT/DOCX/PDF` 等技术名词。

- [ ] **Step 4: 运行 UI 契约与 Store 测试确认 GREEN**

运行：

```powershell
npx vitest run src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.test.ts src/renderer/pages/ImageStudio/article-illustration.store.test.ts --pool=forks
```

预期：5 个测试通过。

### Task 3：将文章配图样式对齐 AI 画图主题

**Files:**
- Modify: `src/renderer/styles/global.css`

- [ ] **Step 1: 增加主题化标签与表单样式**

用以下选择器替换当前简陋的文章卡片表单规则，并保留现有场景和结果网格规则：

```css
.article-card { border: 0.5px solid var(--border-tertiary); background: var(--bg-primary); border-radius: var(--radius-lg); padding: 16px; color: var(--text-primary); }
.article-card h2, .article-card h3 { margin: 0; color: var(--text-primary); }
.article-card > p { margin: -2px 0 2px; color: var(--text-tertiary); font-size: 13px; line-height: 1.5; }
.article-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 10px; border-bottom: 0.5px solid var(--border-tertiary); }
.article-tab { min-height: 30px; padding: 0 10px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; }
.article-tab:hover { background: var(--bg-secondary); color: var(--text-primary); }
.article-tab[aria-selected="true"] { background: var(--bg-info); color: var(--text-info); font-weight: 600; }
.article-card label { display: grid; gap: 6px; color: var(--text-secondary); font-size: 12px; }
.article-card input:not([type="checkbox"]), .article-card select, .article-card textarea { width: 100%; box-sizing: border-box; border: 0.5px solid var(--border-secondary); border-radius: var(--radius-md); padding: 9px 10px; background: var(--bg-primary); color: var(--text-primary); font: inherit; outline: none; }
.article-card input:not([type="checkbox"]):focus, .article-card select:focus, .article-card textarea:focus { border-color: var(--border-info); }
```

为文件输入保留 `cursor: pointer`、主题化 `file-selector-button`；为 `article-panel` 保留网格间距；在 `max-width: 760px` 下让标签自然换行且维持 12px 容器内距。

- [ ] **Step 2: 执行完整验证**

运行：

```powershell
npx vitest run src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.test.ts src/renderer/pages/ImageStudio/article-illustration.store.test.ts src/renderer/components/layout/NavSidebar.test.ts --pool=forks
npm run typecheck
npm run build
git diff --check
```

预期：所有定向测试、类型检查、构建和空白检查通过。

- [ ] **Step 3: 提交功能改造**

仅暂存：

```powershell
git add src/renderer/pages/ImageStudio/article-illustration.store.ts src/renderer/pages/ImageStudio/article-illustration.store.test.ts src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.tsx src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.test.ts src/renderer/styles/global.css
git commit -m "feat(image): localize article illustration tabs"
```

不得暂存根目录已有的 `package.json`、备份计划文档或开发脚本。
