# SKL12-P3-003 Skills Center Catalog 验收证据

- 任务：`SKL12-P3-003 Skills Center Catalog`
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-08

## 实现范围

- Catalog 列表只消费 `kind === package` 的 Skill rows，不展示 Legacy-only 来源。
- 增加四个 KPI：全部 Skills、已启用、本周 Runs、待处理事项。
- 增加 Status language 图例；状态同时使用图标、文字和 semantic tone，不依赖颜色单独表达。
- 支持 Package 搜索/筛选后的分页展示，分页变化回到 workbench 的 catalog page state。
- 增加最近运行、Pending Approval 两个辅助面板，并沿用 Run 状态语言。
- 支持 loading、error、empty 状态。
- Package 行提供详情和 Capability/Grant 入口；最近运行提供 Run 详情入口。
- 保留 `SkillOverviewPanel` 兼容包装器，Runs 视图继续使用原有 Run 面板。

## 代码与测试

- `src/renderer/pages/Skills/SkillOverviewPanel.tsx`
- `src/renderer/pages/Skills/SkillsCenterWorkbench.tsx`
- `src/renderer/pages/Skills/SkillsCenterCatalog.test.tsx`

专项测试覆盖：

- 状态视觉映射；
- KPI 计算；
- 分页不修改源列表；
- Package-only Catalog 静态渲染、KPI 文案、状态语言、最近运行、Pending Approval、Package Runtime 和 Legacy-only 排除。

## 验收命令与结果

```powershell
npm run typecheck
```

结果：通过（`tsc --noEmit`，exit code 0）。

```powershell
npm test -- --run src/renderer/pages/Skills/SkillsCenterCatalog.test.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx src/renderer/pages/Skills/skills-navigation-shell.test.tsx
```

结果：3 个测试文件通过，12 个测试通过。

```powershell
npm test -- --run src/renderer/pages/Skills/SkillsCenterCatalog.test.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx src/renderer/pages/Skills/skills-navigation-shell.test.tsx src/renderer/pages/Skills/SkillCreatorWorkbench.test.tsx src/renderer/pages/Skills/SkillRuntimeDiagnostics.test.tsx src/renderer/pages/Skills/run-detail.test.tsx src/renderer/pages/Skills/skill-runtime.api.test.ts src/renderer/pages/Skills/skill-runtime.store.test.ts
```

结果：8 个 Renderer Skills 测试文件通过，43 个测试通过。

```powershell
git diff --check
```

结果：通过，无 whitespace error。
