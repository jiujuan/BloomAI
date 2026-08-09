# P5-002 HTTP 和数据库集成测试证据

- **Task ID**：`SKL12-P5-002`
- **分支**：`feat/skills-admin-system`
- **生成时间**：2026-08-08T17:56:04Z（UTC）
- **提交**：本文件随 P5-002 独立提交；最终 SHA 可通过 `git log --follow --format=%H -- docs/skills/evidence/p5-002-http-db-integration-tests.md` 复核。

## 门禁范围

将 `test:skills:integration` 从仅覆盖基础 runtime route 和 `tests/integration/skill-runtime`，扩展为显式覆盖以下 HTTP/DB 契约：

- Package/runtime 基础 API、导入审批、安装/更新/切换/回滚/卸载和幂等：
  - `src/server/http/routes/skill-package-runtime.test.ts`
  - `src/server/http/routes/skill-package-runtime.p2.test.ts`
- Grant、Run、Event/SSE、Artifact ownership/export：
  - `src/server/http/routes/skill-package-runtime.p2-002.test.ts`
  - `src/server/http/routes/skill-runtime.routes.test.ts`
- Creator draft/validate/preview/publish、runtime settings、health/diagnostics/audit：
  - `src/server/http/routes/skill-creator.p2-003.test.ts`
  - `src/server/http/routes/skill-runtime-observability.test.ts`
- 数据库状态机、外键、唯一性、ownership、event/command idempotency、artifact/grant invariant 和 migration schema contract：
  - `src/server/db/skill-runtime-invariants.test.ts`
  - `src/server/db/schema-contract.test.ts`
- Queue/Worker、故障注入、fixture、SSE/恢复和一次性只读迁移集成：
  - `tests/integration/skill-runtime`

这使 P5-002 的导入审批、安装、Run、SSE、Artifact、Creator、health/diagnostics、权限拒绝、幂等、分页以及迁移前后不变量均由同一个可重复的集成门禁执行。

## 验收命令与结果

```text
npm run test:skills:integration
```

结果：**12 test files passed，53 tests passed，退出码 0**；Vitest duration 76.72s。所有测试均使用 `--pool=forks --maxWorkers=1 --minWorkers=1`，避免共享 SQLite/临时 data root 并发污染。

另执行：

```text
git diff --check
```

结果：通过，无 whitespace error。

测试中出现的 `Setting key is not writable: skill_runtime.workerConcurrency` 是 Creator/runtime-settings negative case 预期覆盖的 HTTP `VALIDATION_ERROR`，未导致测试失败；没有将该预期拒绝误判为门禁失败。

## 验收结论

- [x] HTTP package/import/install、Grant/Run/Artifact、Creator/settings、observability、SSE/pagination contracts 纳入 gate。
- [x] DB repository/runtime invariants 和 migration schema contract 纳入 gate。
- [x] integration fixtures、queue/worker/recovery/迁移只读场景继续纳入 gate。
- [x] 12 files / 53 tests 全部通过。
- [x] 证据未写入绝对路径、凭据或真实用户数据。

## 风险与回滚

本任务只改变 npm gate 的显式测试集合，不改变生产运行时代码和数据库 schema。风险是门禁运行时增加；出现误报时应修复对应测试或隔离 fixture，不应删减覆盖范围。回滚方式为回退本任务独立 commit，恢复原集成命令集合。
