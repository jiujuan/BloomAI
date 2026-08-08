# SKL12-P1-005 验收证据：Capability Grant、审批和 Broker

- **Task ID:** `SKL12-P1-005`
- **分支:** `feat/skills-admin-system`
- **验收日期:** 2026-08-08
- **结论:** **PASS**

## Red 阶段证据

补充行为测试先于生产修复执行，暴露了以下缺口：

1. Capability approval audit 没有记录审批 `reason`。
2. Broker 在 Grant 查询和消费路径直接使用 `Date.now()`，无法遵守注入的 runtime clock，因此 `expiresAt` 边界行为不稳定。
3. `InstructionAgentAdapter` 在 Broker 返回 pending grant 时没有被测试覆盖为 `waiting_approval` 状态。
4. approve/reject/revoke 重试的状态稳定性缺少覆盖。

## Green 阶段验证

执行命令：

```powershell
npm test -- --run `
  src/server/skills/application/capability-grant.service.test.ts `
  src/server/skills/policy/capability-policy.test.ts `
  src/server/skills/policy/capability-broker.test.ts `
  src/server/skills/policy/capability-broker.integration.test.ts `
  src/server/skills/policy/capability-broker.ports.test.ts `
  src/server/skills/adapters/instruction-agent-adapter.test.ts

npm run typecheck:skills
git diff --check
```

结果：

- **测试:** 6 files passed，47 tests passed，exit code `0`
- **类型检查:** `npm run typecheck:skills` exit code `0`
- **差异检查:** `git diff --check` exit code `0`

## 验收覆盖

- Broker 层拒绝未授权 package-runtime capability 调用。
- pending Grant 不绕过审批；`InstructionAgentAdapter` 将 Run 持久化为 `waiting_approval` 并发出 `approval.required` 事件。
- Grant 的 capability scope、预算/调用次数和 run/session ownership 约束生效。
- `expiresAt` 使用注入 runtime clock 进行查询和消费判断。
- 审批 actor 和 trimmed audit reason 写入 `capability.approved` 审计事件。
- approve/reject/revoke 重复调用返回稳定状态，不重复改变终态。

## 修改文件

- `src/server/skills/application/capability-grant.service.ts`
- `src/server/skills/application/capability-grant.service.test.ts`
- `src/server/skills/policy/capability-broker.ts`
- `src/server/skills/policy/capability-broker.integration.test.ts`
- `src/server/skills/adapters/instruction-agent-adapter.test.ts`
