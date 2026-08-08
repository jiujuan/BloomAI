# SKL12-P3-008 验收证据：权限与安装页面

- 验收日期：2026-08-08
- 分支：`feat/skills-admin-system`
- 任务：`SKL12-P3-008`（用户请求中的 P2 编号对应计划 6.4 的 P3-008）

## 1. RED 证据

先运行新增的 `SkillPermissionsWorkflow.test.tsx`，测试无法收集，暴露 `SkillCapabilityPanel.tsx` 的 JSX 模板表达式语法错误：

```text
Transform failed ... SkillCapabilityPanel.tsx:70 ... Expected ")" but found "}"
```

随后修正 Capability Grant 分组标题的 `id` 模板表达式，并继续执行 GREEN 验收。

## 2. GREEN 测试结果

### P3-008 专项测试

```text
npx vitest run src/renderer/pages/Skills/SkillPermissionsWorkflow.test.tsx
✓ 1 test file passed
✓ 5 tests passed
```

覆盖：

- Pending Approval、Active Grants、Revoked / Closed 分组
- capability scope、budget、expiry、Grant ID、grant mode 展示
- approve / reject / revoke 操作入口
- read-only 操作者隐藏管理操作
- Installation active / disabled / uninstalled 生命周期状态
- enable / disable、rollback、uninstall 危险操作和当前/previous Version
- `waiting_approval` Run 来源和 Package Runtime 上下文

### Store 与 Renderer Skills 全量测试

```text
npx vitest run src/renderer/pages/Skills/skill-runtime.store.test.ts src/renderer/pages/Skills/SkillPermissionsWorkflow.test.tsx
✓ 2 test files passed
✓ 18 tests passed

npx vitest run src/renderer/pages/Skills --pool=forks --maxWorkers=1 --minWorkers=1
✓ 12 test files passed
✓ 68 tests passed
```

Store 额外验证：

- approve/reject/revoke 成功后 Package Grant 与 Run capability 状态收敛
- 重复审批复用同一个 mutation key，避免重复 API 调用
- pending mutation 会清理
- API 错误不覆盖已有 server truth，并正确保留 error/toast 状态

## 3. 静态验收

```text
npx tsc --noEmit
Process exited with code 0

git diff --check
Process exited with code 0
```

## 4. 实现范围

- `src/renderer/pages/Skills/skill-capability.utils.ts`
- `src/renderer/pages/Skills/CapabilityApprovalCard.tsx`
- `src/renderer/pages/Skills/SkillCapabilityPanel.tsx`
- `src/renderer/pages/Skills/SkillInstallationPanel.tsx`
- `src/renderer/pages/Skills/SkillPermissionsPanel.tsx`
- `src/renderer/pages/Skills/skill-runtime.store.ts`
- `src/renderer/pages/Skills/skill-runtime.store.test.ts`
- `src/renderer/pages/Skills/SkillPermissionsWorkflow.test.tsx`

未纳入本任务提交的用户已有改动：MCP 实施计划、Skills 设计/实施计划及其他文档、`installer-ranges.txt`、`release-icon-verify/`。

## 5. 验收结论

通过。权限审批、只读边界、状态最终收敛、Installation 生命周期和危险操作 UI 均有自动化证据，TypeScript 与 diff 检查通过。
