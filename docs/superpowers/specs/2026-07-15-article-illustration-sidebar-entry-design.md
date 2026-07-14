# 文章配图侧栏入口设计

**日期：** 2026-07-15
**状态：** 已确认，待用户审阅

## 目标

将文章配图从 Image Studio 页面内的模式切换，调整为紧邻“AI 画图”的独立侧栏入口，使单图生成和文章配图拥有明确、可直达的导航路径。

## 范围

- 侧栏在“AI 画图”下方新增“文章配图”入口。
- 入口使用 Lucide `BookImage` 图标；按钮保留 `title`、`aria-label` 和当前页 `aria-current`。
- “AI 画图”入口固定展示现有单图生成工作区。
- “文章配图”入口固定展示既有 `ArticleIllustrationWorkbench`。
- 移除 Image Studio 内容区顶部的“Single image / Article illustration”模式切换按钮。

## 交互

1. 用户点击侧栏“AI 画图”图标时，页面进入 `image`，展示现有的会话列表、单图聊天面板和模板库。
2. 用户点击其下方的 `BookImage` 图标时，页面进入 `article-illustration`，直接展示文章配图工作台。
3. 两个入口均是原生 `<button>`，可通过键盘聚焦和激活；图标无可见文字时通过 `title` 与 `aria-label` 说明用途。
4. 当前页面仅对应的侧栏按钮展示 active 状态；两个页面的状态互不重置。

## 技术改动

- 扩展 `useUIStore` 的 `activePage` 联合类型，新增 `article-illustration`。
- `NavSidebar` 新增位于 `image` 后面的文章配图导航项，并导入 `BookImage` 图标。
- `App` 根据 `activePage` 分别渲染单图 `ImageStudioPage` 和文章配图工作台。
- 将 `ImageStudioPage` 还原为仅渲染单图工作区，删除内部模式状态和顶部 tab 按钮。
- 如有必要，调整 Image Studio 导出边界，使 `App` 能复用文章配图工作台组件，而不复制其业务逻辑。

## 非目标

- 不改变文章来源、Skill 选择、权限、生成、重试、恢复或导出逻辑。
- 不修改既有图片会话或单图生成流程。
- 不新增后端 API、数据库迁移或 Package Runtime 能力。
- 不调整侧栏的视觉尺寸、顺序（除新增入口）或其他导航项目。

## 验收标准

- 页面内不再出现 “Single image” 与 “Article illustration” 切换按钮。
- “AI 画图”下方存在可访问的文章配图图标入口，悬停提示为“文章配图”。
- 点击“AI 画图”仅显示单图工作区；点击文章配图入口仅显示文章配图工作台。
- 当前入口具有正确 active 样式和 `aria-current="page"`。
- 现有文章配图 Store 测试、Image Studio 相关测试、类型检查和生产构建均通过。