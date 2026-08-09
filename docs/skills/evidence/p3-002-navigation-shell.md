# SKL12-P3-002 验收证据：App 入口、导航和页面壳

## 范围

- `src/renderer/App.tsx` 的 Skills 页面入口统一挂载 `SkillsAdminShell`。
- `src/renderer/pages/Skills/index.tsx` 导出 `SkillsAdminShell`，旧 `SkillsMarket` 名称仅保留为兼容别名，不再保留 `LegacySkillsMarket` 实现或分支。
- `src/renderer/pages/Skills/SkillsSidebar.tsx` 定义并渲染九个 Package Runtime 视图：
  `center`、`import`、`creator`、`detail`、`permissions`、`runs`、`run-detail`、`artifacts`、`settings`。
- 导航提供 canonical route、旧 URL alias（`installed`/`available`/`drafts`）归一化、面包屑、`Runtime Healthy · Worker` 上下文、键盘可聚焦按钮和 `aria-current`。
- `SkillsCenterWorkbench` 统一加载 Runtime feature flags，提供全局搜索、刷新动作，并在路由 hash 中保留视图、Package、Run、Draft 上下文。

## 验收证据

### 类型检查

命令：

```text
npm run typecheck
```

结果：通过（`tsc --noEmit`，退出码 0）。

### P3-002 定向测试

命令：

```text
npm test -- --run src/renderer/pages/Skills/skills-navigation-shell.test.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx
```

结果：

- Test Files：2 passed
- Tests：8 passed

覆盖：九个视图 ID/标签、breadcrumb、旧 alias 归一化、键盘焦点导航、Runtime Healthy/Worker、SkillsAdminShell 入口和 LegacySkillsMarket 缺失。

### Renderer 回归

命令：

```text
npm test -- --run src/renderer/pages/Skills/skills-navigation-shell.test.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx src/renderer/pages/Skills/SkillCreatorWorkbench.test.tsx src/renderer/pages/Skills/SkillRuntimeDiagnostics.test.tsx src/renderer/pages/Skills/run-detail.test.tsx src/renderer/pages/Skills/skill-runtime.api.test.ts src/renderer/pages/Skills/skill-runtime.store.test.ts
```

结果：

- Test Files：7 passed
- Tests：39 passed

### Legacy 分支扫描

命令：

```text
rg -n 'LegacySkillsMarket|Legacy Skills Market' src/renderer/App.tsx src/renderer/pages/Skills/index.tsx src/renderer/pages/Skills/SkillsSidebar.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.tsx
```

结果：无匹配。

## 结论

SKL12-P3-002 已完成并通过类型检查、专项测试、Renderer 回归及 LegacySkillsMarket 分支扫描，可提交并推送。
