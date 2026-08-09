# SKL12-P3-010 视觉、响应式和可访问性验收证据

> 计划编号说明：`docs/skills/006-skills-admin-v1.2-implementation-plan.md` 的 6.4 节将本任务编号定义为 `SKL12-P3-010`。用户请求中的 “P2-010” 按 6.4 任务清单归并为本任务。

## 1. 实现范围

- `D:\codeproject\JS\bloomai\src\renderer\styles\global.css`
  - 增加 v1.2 Skills 共享视觉 token：`#F5F5F4`、`#FFFFFF`、`#EEEDE9`、`#1A1A18`、`#DDDBD6`、`#7C6FF7`、`#4B9BF5`。
  - 统一品牌渐变、语义状态色、状态边框、notice、tooltip、focus ring 和 `29px` touch target。
  - 为 search input、filter select、text action 及 button/icon button 统一最小交互尺寸。
  - 增加 `.skills-runtime-page` 页面作用域、横向滚动表格容器和 1120/860/620px 响应式规则。
  - 在 `860px` 以下让 topbar tools 换行，避免 768px header 操作互相覆盖；在 `620px` 以下让搜索区域独占一行。
  - 允许 Runtime Diagnostics 后的长页面在 `.page-full` 中垂直滚动，避免内容被 `.skills-center` 的原始 `overflow: hidden` 截断。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.tsx`
  - 根节点接入 `skills-runtime-page`，确保共享 v1.2 样式作用域覆盖 Skills Runtime 管理后台。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsVisualResponsiveA11yWorkflow.test.tsx`
  - 增加视觉 token、semantic status、focus、tooltip、notice、touch target、responsive breakpoint、topbar reflow、table scroll、ARIA/keyboard contract。

## 2. TDD / RED 证据

此前的基线 RED 暴露了两个实际问题：

1. Renderer 根节点缺少 `skills-runtime-page`，样式契约无法覆盖实际页面：
   - 失败断言：expected rendered Skills root to contain `skills-runtime-page`。
2. `.skills-runtime-page` 没有 `min-height: 100%` / `overflow: visible`，真实浏览器下 Runtime Diagnostics 后的主体会被父级布局裁剪：
   - 失败断言：expected overflow contract to be true。
3. 本轮针对 768px header reflow 追加契约后的 RED：

```text
npx vitest run src/renderer/pages/Skills/SkillsVisualResponsiveA11yWorkflow.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1

1 failed, 4 passed
expected CSS to contain '.skills-runtime-page .skills-center-topbar-tools'
```

上述 RED 分别由页面根节点 scope、可滚动页面容器和 `860px` 以下 topbar 换行规则修复。

## 3. 自动化测试证据

### 3.1 P3-010 专项测试

```text
npx vitest run src/renderer/pages/Skills/SkillsVisualResponsiveA11yWorkflow.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1

✓ 1 test file passed
✓ 5 tests passed
```

### 3.2 Skills Renderer 全量回归

```text
npx vitest run src/renderer/pages/Skills --pool=forks --maxWorkers=1 --minWorkers=1

✓ 14 test files passed
✓ 82 tests passed
```

### 3.3 TypeScript、构建和 diff

```text
npx tsc --noEmit
# passed

git diff --check
# passed; only reports the existing LF/CRLF normalization warning for SkillsCenterWorkbench.tsx

npm run build
# passed: tsc + Vite renderer/main/preload/server bundles
# existing Vite chunk-size warning only; no build error
```

## 4. 真实浏览器验收

测试环境：

- Renderer preview：`http://127.0.0.1:53174/#skills/tab=installed`
- API server：`http://127.0.0.1:3718`
- Playwright Chromium/Chrome headless，所有 API 请求通过测试路由注入 `x-bloom-role: admin` 和 `x-bloom-actor: p3-010-browser`，用于访问管理员诊断和 Feature Flag 端点。
- 原始机器可复核 JSON：`C:\Users\xing\AppData\Local\Temp\bloomai-p3-010\acceptance.json`

### 4.1 四个视口指标

| Viewport | Runtime root | `.page-full` | Sidebar | Runtime context | Header overlap | Horizontal overflow | Small/unnamed controls |
|---|---:|---:|---:|---|---:|---:|---|
| 320×900 | 272×2962 | scrollHeight 2962 / clientHeight 900；可滚动并成功到达底部 | 62px | hidden | 0 | false | 0 / 0 |
| 768×900 | 720×1809 | scrollHeight 1809 / clientHeight 900；可滚动 | 62px | hidden | 0 | false | 0 / 0 |
| 1024×900 | 976×1668 | scrollHeight 1668 / clientHeight 900；可滚动 | 220px | hidden | 0 | false | 0 / 0 |
| 1440×900 | 1392×1668 | scrollHeight 1668 / clientHeight 900；可滚动 | 220px | visible | 0 | false | 0 / 0 |

所有视口的 Runtime root class 均为：

```text
skills-center skills-admin-shell skills-runtime-page
```

### 4.2 键盘、focus 和状态可识别性

- 搜索 input accessible name：`搜索 Skills`。
- 搜索 input 实际尺寸：`179×29px`；外层 search control：`220×30px`。
- keyboard focus 结果：`:focus-visible = true`，focus ring 为 `3px solid` 品牌紫色混合色，`outline-offset = 2px`。
- 18 个可见 button/select/input 控件均有 accessible name；未命名控件：0。
- 可见操作控件低于 `29×29px`：0。
- 状态示例均同时包含图标、文字和语义颜色：`已启用`、`已禁用`、`待处理`、`已隔离`。
- 1120px 以下隐藏次要 `Runtime Healthy · Worker` context；860px 以下 Sidebar 收缩为 62px；620px 以下搜索区域独占一行。
- `.skills-table-scroll` / `.skills-center-table-wrap` 的 CSS contract 为 `max-width: 100%; overflow-x: auto; overflow-y: hidden`。

### 4.3 Console 和网络

本次页面 reload、Skills 导航和四视口验收期间：

```text
console errors: 0
console warnings: 0
failed requests: 0
```

### 4.4 截图

截图保存于 `C:\Users\xing\AppData\Local\Temp\bloomai-p3-010\screenshots\`：

- `skills-320-final.png`
- `skills-320-bottom-final.png`
- `skills-768-final.png`
- `skills-1024-final.png`
- `skills-1440-final.png`

其中 `skills-320-bottom-final.png` 证明移动端可滚动到 Skills Catalog、最近运行和待处理事项；`skills-768-final.png` 证明 768px header 操作已换行且无覆盖。

## 5. 验收结论

- [x] 共享视觉 token 与语义状态语言已接入 Skills Runtime 页面。
- [x] 1120/860/620px 响应式规则已实现并通过真实浏览器测量。
- [x] Runtime Diagnostics 长内容不会再被根节点 `overflow: hidden` 截断，移动端可滚动到主体内容。
- [x] 表格滚动容器、focus ring、tooltip、notice 和 touch target contract 已覆盖。
- [x] 状态不依赖颜色单独表达，包含图标和文字。
- [x] 关键导航、搜索和 action 控件具有 accessible name，可键盘 focus。
- [x] 专项测试、Skills Renderer 回归、TypeScript、构建和浏览器验收均通过。

结论：`SKL12-P3-010` **DONE / READY TO COMMIT**。
