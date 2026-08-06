
# Skills Runtime v1.1 回滚和恢复清单

> **Task ID：** SKL-P8-004
> **原则：** 应用可以回滚，数据库 migration 不回滚；Package execution 回滚不删除已有 Run/Event/Artifact；Legacy API 和只读查询优先保留。

## 1. 事故元数据

| 字段 | 值 |
|---|---|
| Incident / change ID | <...> |
| Trigger stage | schema-only / inspect-only / install disabled / shadow / allowlist / GA |
| Trigger UTC | <YYYY-MM-DDTHH:mm:ssZ> |
| Release commit | <40-char SHA> |
| Current app version | <...> |
| Database schema current | <migration id> |
| Incident Commander | <name/role> |
| Runtime Owner | <name/role> |
| Database Owner | <name/role> |
| Security Owner | <name/role> |
| Rollback decision | pending / approved / completed / restore_required |

## 2. 回滚触发器

勾选实际触发项并绑定日志/指标/审计证据：

- [ ] migration 失败、pending 非空、schema assertion 失败。
- [ ] Legacy table/row count 减少或旧 API/页面破坏性回归。
- [ ] critical/high security finding、capability 绕过、source/host allowlist 绕过。
- [ ] secret/token/password/完整 prompt/文件原文进入 DB、event、Artifact 或日志。
- [ ] Package/Version/Run/Event/Artifact ownership 失败。
- [ ] Worker crash loop（10 分钟内 ≥ 3 次）或 queue active lease 双 owner。
- [ ] queue lag 连续 15 分钟超过阶段 SLO，或非用户 Run failure 超出 error budget。
- [ ] Artifact hash/size/mime/path 不一致、导出越界、不可恢复的 afterSeq/event seq。
- [ ] backup checksum 不一致、restore rehearsal 失败或 DB integrity 异常。

**Evidence references：** <health/diagnostics/metrics/audit/CI path>

## 3. 立即 containment（先做，不等调查完成）

### 3.1 关闭新能力

记录旧值、新值、操作者、UTC 和审批：

- [ ] SKILL_PACKAGE_EXECUTION_ENABLED=false
- [ ] SKILL_PACKAGE_IMPORT_ENABLED=false
- [ ] SKILL_GITHUB_IMPORT_ENABLED=false
- [ ] SKILL_NPX_IMPORT_ENABLED=false
- [ ] SKILL_CREATOR_PUBLISH_ENABLED=false
- [ ] 如需完全冻结 Creator：SKILL_CREATOR_ENABLED=false
- [ ] 保留 SKILL_RUNTIME_ENABLED=true（除非 runtime 本身不安全，且已确认 health 查询影响）

### 3.2 停止 Worker，保留数据

- [ ] 停止新 Package Run；不删除 queue row。
- [ ] 使用受控 shutdown：runtime.stop({ drain: false, timeoutMs: 5_000 }) 或等价 SIGTERM/SIGINT。
- [ ] 记录 worker status、workerId、activeRuns、lease、queue depth/lag。
- [ ] 确认 skill_runs_v2、skill_run_events、skill_artifacts、audit rows 没有被删除。
- [ ] 保留 GET /api/v1/skill-runtime/health、GET /api/v1/skill-runtime/diagnostics、Run/Event/Artifact 查询。
- [ ] Legacy /api/v1/skills API 和页面保持可用；Package 继续禁止通过 Legacy /:id/run 直跑。

### 3.3 保存证据

- [ ] 保存 health/capabilities/diagnostics/security status 脱敏响应。
- [ ] 保存 metrics 时间窗、日志 requestId/runId/skillVersionId/workerId/grantId/artifactId 关联。
- [ ] 保存 source commit SHA、archive hash、manifest hash、affected version/run/grant/artifact IDs。
- [ ] 保存 DB/file 快照和 SHA-256；不保存或复制 secret 内容。
- [ ] 冻结 retention/orphan cleanup 和任何 destructive operation。

## 4. 数据库策略：不回滚 migration

### 4.1 应用回滚

- [ ] 可以将应用 binary/container/commit 回到上一版本，但保留当前 DB schema 和 schema_migrations rows。
- [ ] 旧应用启动前已在临时 DATA_DIR 验证能向后读取当前 schema。
- [ ] 如果旧应用无法安全读取：保持 Package execution/import/Creator 关闭，只提供健康、只读查询和 Legacy；发布兼容读取修复。
- [ ] 不执行 DROP TABLE、DROP COLUMN、删除 schema_migrations row、手工改 schema 或从备份覆盖生产 DB 来“撤销”已执行 migration。

### 4.2 Forward-fix

当前没有同名 runForwardFix 生产函数。修复流程必须是：

1. DBO/开发者提交新的编号 migration 或已审查脚本。
2. 在空库、旧库副本、代表性 Package/Run/Artifact 临时库 rehearsal。
3. 记录 SQL/migration ID、影响范围、锁风险、默认值、兼容读取和审批。
4. 使用显式目标目录执行：

~~~powershell
$env:DATA_DIR = '<TEMP_ROOT>\forward-fix-rehearsal'
npm run db:migrate
~~~

5. 通过 migration tests、schema snapshot、health/readiness 后才能安排生产窗口。
6. 生产执行后记录 current/applied/pending、row count、hash 和 reviewer sign-off。

## 5. Backup 和 restore

### 5.1 备份核对

- [ ] 已停止写入或使用受控 SQLite online backup。
- [ ] bloomai.db、bloomai.db-wal、bloomai.db-shm 状态已记录。
- [ ] DB SHA-256：<hash>。
- [ ] WAL SHA-256（如有）：<hash>。
- [ ] SHM SHA-256（如有）：<hash>。
- [ ] Backup 目录不在源码树、仓库或公开下载目录。

### 5.2 恢复演练

必须先用临时 DATA_DIR，禁止直接覆盖生产：

~~~powershell
$env:DATA_DIR = '<TEMP_ROOT>\restore-rehearsal'
# 将经过 checksum 校验的 backup 文件复制到该目录
npm run db:migrate
npm run test:skills:migration
~~~

- [ ] backup checksum 一致。
- [ ] migration status pending=[] 或有明确 approved forward-fix。
- [ ] 应用 health liveness/readiness 结果符合当前 flags。
- [ ] Legacy skills/skill_runs 可查询。
- [ ] Package version/install/run/event/artifact metadata 可查询。
- [ ] Event afterSeq、Artifact hash/size/mime/ownership 通过。
- [ ] restore rehearsal 产生的文件和临时 DB 已清理，不影响生产。

## 6. 可选的 DB 恢复决策

只有以下情况才考虑从 backup 恢复生产 DB：物理损坏、不可修复的完整性破坏，且 RO/DBO/IC 已批准。正常 schema/字段错误必须 forward-fix。

- [ ] 恢复原因不是普通应用 bug 或 feature flag 误配。
- [ ] 已保存当前生产 DB/WAL/SHM 快照，避免丢失事故证据。
- [ ] 目标 backup 在临时 DATA_DIR restore rehearsal 成功。
- [ ] 已评估 backup 时间点之后 Run/Event/Artifact/Legacy 数据的丢失范围。
- [ ] 已准备 replay/reconciliation 或明确用户影响。
- [ ] 恢复窗口、停机、审批和公告已确认。
- [ ] 恢复后重新执行 health、migration、Legacy、Package query、ownership 和 security smoke。

## 7. 重新启动路径

### 7.1 只读/Legacy 恢复

1. 保持 Package execution/import/Creator flags 关闭。
2. 启动应用，让 src/server/index.ts 按顺序 load config、初始化目录、运行 migrations、完成 recovery，再决定是否 runtime.start()。
3. 检查 GET /api/v1/skill-runtime/health：liveness 可以为 true；execution 关闭时 readiness 不应被误报为可执行。
4. 检查 Legacy route、既有 Run/Event/Artifact 查询和审计。
5. 在 incident 未关闭前禁止 retention cleanup、orphan delete 和扩大流量。

### 7.2 Package execution 小范围恢复

- [ ] Root/path/limit/security policy 已修复并测试。
- [ ] 受影响 Package/version 已重新 inspect；immutable hash、manifest hash、source fingerprint 对照通过。
- [ ] grant status/scope/usage/owner 对照通过。
- [ ] 使用 deterministic fixture 完成 Run → Event → Artifact → export smoke。
- [ ] 设置 SKILL_PACKAGE_EXECUTION_ENABLED=true，只开放单个 approved allowlist。
- [ ] 启动/恢复 Worker：runtime.start()；记录 heartbeat、queue lag、retry/dead-letter。
- [ ] 观察至少一个小窗口，无新增 trigger 后才能扩大 allowlist。

## 8. dryRunCleanup 和 retention 保护

当前没有统一 dryRunCleanup endpoint。回滚期间：

- [ ] 只生成 orphan/retention 只读报告，不执行删除。
- [ ] 对 DB row 与文件 hash/size/mime/path 做对照。
- [ ] 保留所有 Run/Event/Artifact，即使 Package/Installation soft-delete。
- [ ] exported_at、exported_by、retention、审计/业务引用未确认前不删除 Artifact。
- [ ] 生产删除必须由已测试脚本/forward-fix 执行，并绑定审批、backup 和 restore plan。
- [ ] 报告只输出计数、ID、hash、脱敏相对路径，不输出文件内容/secret。

## 9. 安全事件专项

- [ ] SO 已判定是否需要撤销 grant、禁用 source host、冻结 Package/version/installation。
- [ ] 已轮换/撤销外部凭证（如存在），且凭证值不写入 incident 文档。
- [ ] 已检索并脱敏日志、audit、Run/Event/Artifact；保存 affected IDs 和 hash。
- [ ] 已确认是否有外泄文件、越权 capability、SSRF、Zip Slip、XSS、CSRF/CORS 影响。
- [ ] 修复策略只收紧，不通过关闭全部安全校验放行合法样本。
- [ ] 修复经过 security tests、migration/restore rehearsal 和 Reviewer sign-off。
- [ ] 重新打开能力时先 inspect-only，再 shadow，再单 package allowlist。

## 10. 回滚后的验证矩阵

| 验证项 | 预期 | 结果/证据 |
|---|---|---|
| GET /api/v1/skill-runtime/health | liveness true；关闭 execution 时 readiness 语义正确 | <...> |
| GET /api/v1/skill-runtime/capabilities | flags 与 containment 一致，无 secret/path | <...> |
| GET /api/v1/skill-runtime/diagnostics | admin 可查；pending/worker/queue/metrics 可解释 | <...> |
| GET /api/v1/skill-security/status | admin 可查；finding 状态已记录 | <...> |
| migration status | 无意外 pending；不回滚 schema | <...> |
| Legacy API | list/get/run（Legacy）保持兼容 | <...> |
| Package query | package/version/install/run/event/artifact 可读 | <...> |
| Event recovery | afterSeq/stream 不丢失或重复；seq 唯一 | <...> |
| Artifact | ownership/hash/size/mime/path 一致；不删除 | <...> |
| Worker | stopped 或 running 状态与 flags/incident 一致 | <...> |
| logs/metrics/audit | 可串联 request/run/version/grant/artifact，已脱敏 | <...> |

## 11. 关闭事故和签字

- [ ] Trigger root cause 已记录，临时 containment 不再需要。
- [ ] 应用/DB/flags/Worker 的最终状态已记录。
- [ ] 新 migration/forward-fix、测试和证据已链接。
- [ ] backup/restore、数据影响、用户影响和通知已记录。
- [ ] orphan/retention cleanup 仍有独立审批，不因关闭 incident 自动执行。
- [ ] Post-incident review 已安排，包含预防措施和 owner。

**IC sign-off：** <name/UTC>
**RO sign-off：** <name/UTC>
**DBO sign-off：** <name/UTC>
**SO sign-off：** <name/UTC>
**Final decision：** <recovered / remains_disabled / restore_required>
