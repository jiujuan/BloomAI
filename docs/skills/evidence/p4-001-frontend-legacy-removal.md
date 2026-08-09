# SKL12-P4-001 验收证据：删除前端 Legacy 入口

## 范围

- 删除 `src/renderer/pages/Skills/skills.store.ts` 旧前端兼容 store。
- `src/renderer/pages/Skills/index.tsx` 仅保留 `SkillsAdminShell`，删除旧 `SkillsMarket` 兼容导出。
- `SkillsSidebar`、`SkillsCenterWorkbench`、`SkillOverviewPanel` 和 Runtime 类型契约只暴露 Package Runtime 视图与数据。
- 删除旧 `installed` / `available` / `drafts` 页面入口和 `Legacy` market selector；路由 hash 不再接受这些旧 alias。
- 统一测试 fixture 与 `buildSkillRows` 调用到 Package、Installation、Run 三类 Runtime 数据。

## TDD 证据

### RED：旧入口仍可见

初始专项测试命令：

```text
npx vitest run src/renderer/pages/Skills/SkillsLegacyBoundaryP4.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

初始结果：失败（2 个测试失败）。失败原因包括：

- `skills.store.ts` 仍存在。
- `buildSkillRows` 仍使用旧 Legacy 参数形态，传入 Package Runtime 数据时触发 `runs.filter` 错误。

补充旧 `SkillsMarket` 导出契约后再次运行同一专项测试，结果：失败（1 个测试失败），明确定位到 `index.tsx` 的旧兼容导出。

### GREEN：前端边界收紧

命令：

```text
npx vitest run src/renderer/pages/Skills/SkillsLegacyBoundaryP4.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

结果：

- Test Files：1 passed
- Tests：3 passed
- 覆盖旧入口/兼容 store 删除、Legacy selector 扫描、旧 route alias 拒绝、Package Runtime 行和页面渲染。

## Renderer 回归

命令：

```text
npx vitest run src/renderer/pages/Skills --pool=forks --maxWorkers=1 --minWorkers=1
```

结果：

- Test Files：15 passed
- Tests：84 passed

## 类型检查和构建

命令：

```text
npx tsc --noEmit
npm run build
```

结果：均通过，退出码 0。生产构建生成 Renderer、Electron main/preload 和 server bundle；Vite 仅报告既有的大 chunk warning。

## 源码边界扫描

命令：

```text
rg -n -i "LegacySkillsMarket|SkillsMarket|Create Legacy Skill|legacySkills|legacyLabel|LEGACY_VIEW_ALIASES|Legacy Runtime|Legacy Skills Market|skills-market|skills-center-kind-icon\\.legacy|skills-center-legacy-note" src/renderer --glob '!**/*.test.*' --glob '!**/skills.store.ts'
```

结果：无匹配。

旧 store 检查：

```text
Test-Path src/renderer/pages/Skills/skills.store.ts
```

结果：`False`（文件已删除）。

## 生产 bundle 检查

命令：

```text
rg -l -i "LegacySkillsMarket|Create Legacy Skill|Legacy Skills Market|skills-market" dist dist-electron
```

结果：无匹配，生产 bundle 不再包含旧页面入口标记。

## 结论

SKL12-P4-001 已完成：Renderer 只保留 Package Runtime 管理入口，旧 Legacy 页面、旧市场兼容导出、旧 store、旧 view alias 和旧 CSS 入口均已清理，并通过专项测试、Renderer 回归、类型检查、生产构建和 bundle 扫描验收。