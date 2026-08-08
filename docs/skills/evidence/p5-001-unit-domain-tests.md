# P5-001 单元和领域测试证据

- **Task ID**：`SKL12-P5-001`
- **分支**：`feat/skills-admin-system`
- **生成时间**：2026-08-08T17:50:36Z（UTC）
- **提交**：本文件随 P5-001 独立提交；最终 SHA 可通过 `git log --follow --format=%H -- docs/skills/evidence/p5-001-unit-domain-tests.md` 复核。
- **范围**：Manifest schema、source normalize、safe reader、path policy、Capability policy/Broker、状态机、Queue/Worker、Event seq、Artifact policy、Draft schema/service、Repository invariants。

## 失败证据与修复

首次执行既有 `npm run test:skills:unit` 时，测试结果为 **58 files passed、318 tests passed、1 failed**。失败用例为 `CapabilityBroker injected ports > records capability latency, outcome, and bounded correlation fields`。

根因是 capability correlation 的断言只覆盖了旧字段，遗漏领域契约中的 canonical `versionId`。修复 `src/server/skills/policy/capability-broker.ports.test.ts`，使断言同时验证：

```ts
{
  runId,
  skillVersionId,
  versionId,
  grantId,
}
```

该修复只校正测试对领域契约的断言，不改变运行时代码或持久化行为。

## 验收命令与结果

| 命令 | 结果 |
|---|---|
| `npx vitest run src/server/skills/policy/capability-broker.ports.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose` | 通过：1 file、3 tests |
| `npm run test:skills:unit` | 通过：61 files、338 tests |
| `npm run typecheck:skills` | 通过，退出码 0 |
| `npm run lint` | 通过，输出 `lint ok` |
| `git diff --check` | 通过，无 whitespace error |

同时将 `test:skills:unit` 的门禁范围扩展为 `src/server/skills`、`src/server/db/repositories/skill-package.repo.test.ts` 和 `src/server/db/skill-runtime-invariants.test.ts`，避免 Repository/domain invariants 漏出 Skills 单元门禁。

## 验收结论

- [x] P5-001 的领域/单元测试全部通过。
- [x] 原始失败已保留最小根因和修复说明，并在修复后重跑通过。
- [x] 类型检查、lint、diff hygiene 均通过。
- [x] 测试没有写入本证据中的绝对路径、凭据或真实用户数据。

## 风险与回滚

风险为单元门禁运行时间约 201 秒，主要来自每个临时数据库实例的 migration 初始化；当前通过单 worker/fork 配置保持确定性。回滚方式为回退本任务独立 commit；这会恢复原单元测试脚本和旧断言，不触及 P4 迁移/Legacy 提交。
