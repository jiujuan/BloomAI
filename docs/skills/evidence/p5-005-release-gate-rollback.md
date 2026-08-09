# P5-005 发布门禁和回滚演练证据

- **Task ID**：`SKL12-P5-005`
- **分支**：`feat/skills-admin-system`
- **责任人**：Codex
- **Reviewer**：本地 release-gate 自审；待合并请求复核
- **生成时间**：2026-08-08T20:16:51Z（UTC）
- **验收基线提交**：`01b938ffcccfd7781118625829f2e265c677de15`
- **任务提交**：本文件随 P5-005 独立提交；最终 SHA 可通过 `git log --follow --format=%H -- docs/skills/evidence/p5-005-release-gate-rollback.md` 复核。

## 门禁范围

依据实施计划第 6.6 节，将 `test:skills:release-gate` 收紧为完整发布前门禁，按顺序执行：

```text
npm run lint
npm run typecheck:skills
npm run test:skills:unit
npm run test:skills:integration
npm run test:skills:security
npm run test:skills:migration
npm run test:skills:e2e
npm run build
npm test
npm run verify:legacy-skills-migration
npm run test:skills:migration:smoke
```

本任务同时修复了门禁暴露的生产边界和 Windows 测试稳定性问题：

- 增加 `src/server/domain/`、`src/server/security/` 中立契约，并通过 `src/server/services/` facade 让 HTTP route、repository 和 Legacy facade 不再直接依赖不应暴露的应用内部实现；
- Article Illustration E2E 默认请求补齐确定性的 `x-bloom-actor`，没有放宽生产 Artifact ownership 或 actor 权限；
- Windows process runner 对 `taskkill` 增加 1 秒上限，超时后回退到直接终止 child，避免资源压力下无限等待和临时目录 `EPERM`。

## 失败、根因、修复和重试

### 第一次完整门禁

- **失败现象**：dependency-boundary 测试失败；Article Illustration E2E 的导出请求返回 `403`。
- **根因**：route 仍通过不稳定的内部依赖路径组装运行时；E2E fixture 没有提供生产 Artifact ownership 所需的 actor header。
- **修复**：引入中立 domain/security 契约和 service facade；仅在 E2E 默认请求中增加 `x-bloom-actor: article-e2e-operator`。
- **聚焦验收**：相关 2 个测试文件共 8 个测试通过，未降低生产授权检查。

### 后续完整门禁

- **失败现象**：`src/server/tools/utils/process-runner.test.ts` 在 Windows 下超时，并伴随临时目录清理 `EPERM`。
- **根因**：Windows `taskkill /T /F` 没有超时边界，进程树终止命令在资源压力下可能无限等待。
- **修复**：增加 `WINDOWS_TASKKILL_TIMEOUT_MS = 1_000`，超时或失败后调用 child 的直接终止作为 fallback。
- **重试验收**：process-runner 聚焦测试连续 10 次通过；随后完整 `npm test` 和 release gate 均通过。

## 最终验收命令与结果

最终执行：

```text
npm run test:skills:release-gate
```

结果：**退出码 0**。

| 阶段 | 结果 |
|---|---|
| `lint` | `lint ok` |
| `typecheck:skills` | 通过 |
| `test:skills:unit` | 61 files / 338 tests passed |
| `test:skills:integration` | 12 files / 53 tests passed |
| `test:skills:security` | 18 files / 121 tests passed |
| `test:skills:migration` | 16 files / 78 tests passed |
| `test:skills:e2e` | 16 files / 86 tests passed |
| `build` | Vite production build 通过 |
| `npm test` | 294 files passed、2 skipped；1408 tests passed、2 skipped |
| `verify:legacy-skills-migration` | 通过 |
| `test:skills:migration:smoke` | 通过 |

- **开始时间**：2026-08-08T19:59:28.3509113Z（UTC）
- **结束时间**：2026-08-08T20:16:51.5187412Z（UTC）
- **脱敏日志**：`.tmp/p5-005-release-gate-final.log`（原始日志被 `.gitignore` 忽略，不提交）
- **日志 SHA-256**：`3164B7224F8258B4234C19BF2FE226E2ED0505DA56BA260413DC8F5B815C0EAC`
- **附加检查**：`git diff --check` 通过。

## Legacy migration verifier 脱敏摘要

最终门禁中的 migration verifier 为离线、一次性、只读验证，输出摘要如下：

```yaml
migrationVersion: 047-legacy-migration-archive-and-gates
legacyWritesDisabled: true
rollback:
  rehearsalPassed: true
  rollbackPerformed: false
  rollbackError: null
externalNetworkCalls: 0
secretLeak: false
gate:
  allowed: false
  manualReviewCount: 3
  dropOldTables: false
```

`gate.allowed: false` 是 fixture 中仍有 3 条 Legacy 记录需要人工复核的**预期结果**，不是发布门禁失败；旧表不会被删除。该验证同时确认 rollback rehearsal 成功、没有外部网络请求、没有敏感信息泄露。

## 验收结论

- [x] 发布门禁覆盖 lint、类型检查、P5 单元/集成/安全/迁移/E2E、production build、全量 `npm test` 和 Legacy migration verifier/smoke。
- [x] 首次失败和后续失败均保留了现象、根因、修复和重试结果。
- [x] dependency boundary 修复没有把内部实现重新暴露给 route；Article Illustration E2E 没有绕过生产 actor/ownership 授权。
- [x] Windows process termination 具备 bounded wait 和直接 child fallback。
- [x] 最终 release gate 退出码为 0，migration rollback rehearsal 通过。

## 限制、风险与回滚

- release gate 使用离线 deterministic fixtures；真实远程服务网络链路不属于本任务验收范围，且最终日志确认 `externalNetworkCalls: 0`。
- 失败重试中的临时 trace、video、数据库和 backup manifest 均未提交；证据只保留脱敏摘要和相对路径。
- 回滚方式：回退本任务独立 commit，恢复到 P5-004 的发布门禁集合；migration verifier 的 `dropOldTables: false` 保持旧表删除门禁关闭，需在人工复核完成后另行决策。
