# SKL12-P3-004 列表行内操作图标和 Tooltip 验收证据

- 任务：`SKL12-P3-004 列表行内操作图标和 Tooltip`
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-08

## 实现范围

- Package Catalog Actions 列固定渲染四个 icon-only button，顺序固定为：查看详情、启用/禁用 Installation、创建新版本、卸载 Installation。
- 删除旧的详情/权限文本操作作为 Actions 列内容，不引入三点菜单或“Skill 操作”菜单弹窗。
- 每个操作按钮提供 `aria-label`、`title`、`data-tooltip`，并使用 30×30px 操作区域、`:focus-visible` focus ring 和 hover/focus 可读 Tooltip。
- 启用/禁用 label 和图标随 `row.enabled` 动态切换；卸载按钮使用 danger tone。
- 行数据携带 `installationId` 与 `installationRevision`，未安装 Package 仍保留固定四项但禁用无效的 toggle/uninstall。
- Workbench 接线 Runtime Store 的 optimistic mutation：启用/禁用、卸载成功后刷新 Installation 与 Package 列表；失败由 Store rollback 并显示错误 toast；卸载前只进行一次明确确认。
- Runtime Store 增加 Installation 分页加载状态，避免 Catalog 行无法取得 Installation id/revision。

## 代码与测试

- `src/renderer/pages/Skills/SkillOverviewPanel.tsx`
- `src/renderer/pages/Skills/SkillsCenterWorkbench.tsx`
- `src/renderer/pages/Skills/skill-runtime.store.ts`
- `src/renderer/styles/global.css`
- `src/renderer/pages/Skills/SkillsCenterCatalogActions.test.tsx`

专项测试覆盖：

- 四个 action descriptor 的固定顺序和动态启用/禁用文案；
- 卸载 action 的 danger 标记；
- 静态渲染检查四个按钮的 `aria-label`、`title`、`data-tooltip`，并排除三点和“Skill 操作”；
- 卸载确认函数只调用一次且消息包含 Skill 名称；
- `buildSkillRows` 保留 Installation id/revision 供 mutation handler 使用。

## 验收命令与结果

```powershell
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 src/renderer/pages/Skills/SkillsCenterCatalogActions.test.tsx src/renderer/pages/Skills/SkillsCenterCatalog.test.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx src/renderer/pages/Skills/skill-runtime.store.test.ts
```

结果：4 个测试文件通过，24 个测试通过。

```powershell
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 src/renderer/pages/Skills
```

结果：9 个 Renderer Skills 测试文件通过，47 个测试通过。

```powershell
npx tsc --noEmit
```

结果：通过（exit code 0）。

```powershell
git diff --check
```

结果：通过，无 whitespace error。
