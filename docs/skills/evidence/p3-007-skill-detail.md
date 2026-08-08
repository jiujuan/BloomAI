# SKL12-P3-007 Skill 详情、版本、文件和 Capability 验收证据

- 任务：`SKL12-P3-007 Skill 详情、版本、文件和 Capability`
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-08

## 实现范围

- `SkillVersionPanel` 明确区分 Installation 当前版本和选中的历史版本；空版本集合安全返回空选择，避免通过 `versions[0]` 产生类型和边界错误。
- 版本面板从 manifest/source snapshot 展示文件树、文件大小和 SHA 摘要，并计算新增、删除、变更文件 Diff。
- `SkillCapabilityPanel` 展示 requested/approved/rejected/revoked/expired/consumed 生命周期、scope、允许目录/域名/模型、调用预算和授权模式；详情上下文按选中 Version 过滤 grants。
- `PackageDetailDrawer` 接线 Hero、Package/Version/Installation 追踪、Installations、Runs、History、Manifest、更新/回滚影响预览和危险操作确认；历史版本不会被误标为当前版本。
- `SkillEditor` 改为 Package Runtime 版本更新/回滚预览；从当前 Version 创建新 Draft 时保留 `baseVersionId` 关系。
- `SkillsCenterWorkbench` 将 selected version、详情抽屉和版本创建流程接线到 Runtime store。

## TDD / Red-Green 记录

- 新增 `SkillDetailWorkflow.test.tsx`，覆盖当前/历史版本边界、空版本选择、文件树与 Diff、Capability scope/lifecycle、更新/回滚风险预览。
- 首轮专项契约测试已验证新增行为；随后修正 `getVersionSelection` 的空数组类型边界，并重新运行 TypeScript 与测试。

## 测试与验收结果

```text
npx vitest run src/renderer/pages/Skills/SkillDetailWorkflow.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
1 file passed, 6 tests passed

npx vitest run src/renderer/pages/Skills/SkillVersionPanel.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
未找到该历史文件；以 SkillDetailWorkflow 专项测试和 Skills 目录全量测试作为等价验收证据。

npx vitest run src/renderer/pages/Skills --pool=forks --maxWorkers=1 --minWorkers=1
11 files passed, 61 tests passed

npx tsc --noEmit
passed (exit code 0)

git diff --check
passed
```

## 关键验收结论

- 详情中的 Package → Version → Installation → Run/Grant 关系可追溯。
- 历史版本显示为 `历史版本`，不会错误显示为 `当前版本`。
- Capability scope 和 grant 状态可读，危险 grant 操作保留确认及 revision 边界。
- 更新与回滚会在执行前展示影响、风险和确认要求。

## 变更文件

- `src/renderer/pages/Skills/PackageDetailDrawer.tsx`
- `src/renderer/pages/Skills/SkillCapabilityPanel.tsx`
- `src/renderer/pages/Skills/SkillEditor.tsx`
- `src/renderer/pages/Skills/SkillVersionPanel.tsx`
- `src/renderer/pages/Skills/SkillsCenterWorkbench.tsx`
- `src/renderer/pages/Skills/skill-runtime.store.ts`
- `src/renderer/pages/Skills/SkillDetailWorkflow.test.tsx`
