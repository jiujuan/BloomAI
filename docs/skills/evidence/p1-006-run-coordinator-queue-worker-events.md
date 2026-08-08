# SKL12-P1-006 验收证据：Run Coordinator、Queue、Worker 和 Event

- **Task ID:** `SKL12-P1-006`
- **分支:** `feat/skills-admin-system`
- **验收日期:** 2026-08-08
- **验收状态:** **PASS**
- **提交:** 本任务文件与本证据文件一并提交；最终 SHA 以 `git log -1 --oneline` 为准。

## Red 阶段证据

先新增行为测试，再运行生产代码，得到预期失败：

```powershell
npm test -- --run `
  src/server/skills/runtime/skill-run-coordinator.test.ts `
  src/server/skills/runtime/skill-run-worker.test.ts `
  src/server/skills/runtime/skill-run-recovery.test.ts
```

结果：`3 files passed with 3 failed tests / 21 tests total`，失败分别暴露：

- `subscribeEvents(runId, afterSeq)` 未将 cursor 传给 Event Repository；
- Worker 使用系统 `Date.now()` 计算 Run duration，无法使用 runtime 注入时钟；
- stale Run 标记为 `interrupted` 后，旧 Queue item 已结束时没有重新入队。

## Green 阶段验证

聚焦 P1-006 的状态机、Coordinator、Queue、Worker、Recovery、Event 和 Waiting 测试：

```powershell
npm test -- --run `
  src/server/skills/runtime/skill-run-coordinator.test.ts `
  src/server/skills/runtime/skill-run-queue.test.ts `
  src/server/skills/runtime/skill-run-worker.test.ts `
  src/server/skills/runtime/skill-run-recovery.test.ts `
  src/server/skills/runtime/skill-run-events.test.ts `
  src/server/skills/runtime/skill-run-state-machine.test.ts `
  src/server/skills/runtime/skill-run-waiting.test.ts
```

结果：`7 files passed / 40 tests passed / exit code 0`。

类型和差异检查：

```powershell
npm run typecheck:skills
git diff --check
```

结果：`TYPECHECK_EXIT=0`，`DIFF_CHECK_EXIT=0`。

## 验收覆盖

| 计划验收条目 | 证据 |
|---|---|
| Run 创建先持久化再入队 | Coordinator 既有 atomic `createRunAndEnqueue` 路径及 `skill-run-coordinator.test.ts` 的 persisted run 验证；Queue/Repository 测试覆盖 durable queue item。 |
| Worker lease 可恢复 | `skill-run-queue.test.ts` 覆盖过期 lease 被第二 Worker reclaim；`skill-run-recovery.test.ts` 覆盖 worker shutdown 后 Run 进入 `interrupted`、Queue 进入 `retry_wait`。 |
| Event seq 单调递增 | `skill-run-coordinator.test.ts`、`skill-run-events.test.ts`、`skill-run-recovery.test.ts` 验证历史事件 seq 顺序和恢复后的连续事件。 |
| cancel/retry 不污染历史 Run | Coordinator command idempotency、revision conflict、cancel/recovery 测试验证历史事件保留且命令重复不会产生第二次执行。 |
| 重启后 queued/running/waiting 按策略恢复 | Queue lease reclaim、stale active Run interruption、waiting action/approval re-enqueue 测试覆盖。 |
| SSE 与历史事件 cursor 一致 | `subscribeEvents(runId, afterSeq)` 现在向 Repository 传递 `{ afterSeq }` 并保留兼容性二次过滤；新增 cursor/timestamp 测试覆盖。 |
| 事件时间和运行指标可复现 | Coordinator 所有生成事件使用注入 Clock；Worker 新增 `clock?: Clock`，heartbeat、startedAt 和 duration metric 使用同一 Clock；新增 FakeClock 测试覆盖。 |

## 修改文件

- `src/server/skills/runtime/skill-run-coordinator.ts`
- `src/server/skills/runtime/skill-run-coordinator.test.ts`
- `src/server/skills/runtime/skill-run-recovery.test.ts`
- `src/server/skills/runtime/skill-run-worker.ts`
- `src/server/skills/runtime/skill-run-worker.test.ts`
- `docs/skills/evidence/p1-006-run-coordinator-queue-worker-events.md`

## 已知限制

- Queue/Run 的持久化事务由 Repository adapter 提供；Coordinator 对不支持 atomic adapter 的测试 double 仍保留兼容 fallback。
- 证据不包含真实数据库路径、token 或用户数据。