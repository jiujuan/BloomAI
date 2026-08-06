
# Skills Runtime v1.1 发布、迁移、兼容和回滚 Runbook

> **Task ID：** SKL-P8-004
> **适用分支：** feat/skills-system-v1.1-impl
> **文档版本：** v1.1
> **生成日期：** 2026-08-06
> **状态：** 发布操作契约；每次真实发布必须复制到证据记录并填写实际 commit、UTC 时间、owner 和命令输出。

## 1. 目的、范围和不可违反的原则

本 Runbook 将 Skills Runtime 从开发功能推进到可审计的分阶段发布。它覆盖：

- schema-only、inspect-only、install disabled、worker shadow/dry-run、Package run allowlist、GA 六个发布阶段；
- feature flags、health/readiness、migration status、日志/指标和审计证据；
- SQLite 备份/恢复、forward-fix、旧库兼容、Artifact retention、orphan cleanup 和安全事件响应；
- Package Runtime 与 Legacy Skill API 的共存、切流和回滚。

### 1.1 发布原则

1. **数据库只向前迁移。** 已执行 migration 不通过应用回滚撤销；任何 schema 修复必须新增编号 migration，并经过临时 DATA_DIR 演练。
2. **先可查询，后可执行。** 回滚 Package execution 时停止新 Run/Worker，但保留 Run、Event、Artifact 查询和 Legacy API。
3. **默认拒绝能力。** Package execution、import、GitHub/npx import、Creator 和 Creator publish 必须显式开启；关闭能力返回可识别的 FEATURE_DISABLED，不静默 404。
4. **不把不存在的函数当作生产实现。** 本文把 getFeatureGateStatus、runForwardFix、dryRunCleanup 定义为运维适配器契约；当前生产代码使用的替代入口见第 4 节。
5. **不执行未经测试的手工 SQL。** 生产数据修复必须提交 migration/脚本、记录审批、在临时库恢复演练后执行。
6. **不删除历史数据作为回滚手段。** Legacy 表、Legacy row、Package Run/Event/Artifact、审计记录和已导出的文件默认保留。

### 1.2 角色和责任

| 角色 | 责任 | 发布/回滚签字 |
|---|---|---|
| Release Owner（RO） | 阶段推进、门禁判定、变更窗口和最终发布决定 | 每阶段 entry/exit |
| Runtime Owner（RTO） | feature flags、Worker、health/readiness、Run/Event 运行态 | Worker 和 execution |
| Database Owner（DBO） | backup、migration、restore rehearsal、schema 证据 | DB 变更 |
| Security Owner（SO） | import source、capability deny、incident containment、审计 | 安全门禁 |
| Support/Incident Commander（IC） | 告警、用户沟通、回滚协调、事后复盘 | 事故期间 |
| Reviewer | 复核命令输出、脱敏、证据链和未触碰范围 | 每个 Task |

如果项目没有单独角色，由 RO 明确指定代理人；不能以“无人负责”跳过签字。

## 2. 事实来源和版本兼容矩阵

### 2.1 实际实现的事实来源

| 领域 | 当前实现 | 运行手册使用方式 |
|---|---|---|
| 配置 | src/server/skills/config/skill-runtime.config.ts | 以 getSkillRuntimeConfig() 和 getSkillRuntimeCapabilities() 为准 |
| 启动顺序 | src/server/index.ts | load config → ensure directories → tracing/metrics → migrations → create runtime → recovery → Worker → HTTP |
| Migration 执行 | src/server/db/migrations.ts、src/server/db/client.ts、scripts/db-migrate.js | 使用 runMigrations() / runSqlMigrations()；CLI 必须显式设置 DATA_DIR |
| Health/diagnostics | src/server/skills/observability/skill-runtime.diagnostics.ts | 使用 getRuntimeHealth()、getRuntimeDiagnostics() |
| Migration status | getMigrationStatus()、getSkillRuntimeMigrationStatus() | 以 current/applied/pending 为准 |
| HTTP app | src/server/http/app.ts | Skills Runtime routes 挂在 /api/v1 |
| 运行日志 | DATA_DIR/logs/YYYY-MM-DD.jsonl | 只查询脱敏字段；不得把 token、secret、password、完整 prompt 写入证据 |

### 2.2 版本和兼容策略

| 契约 | 当前值 | 兼容要求 |
|---|---:|---|
| Package Runtime HTTP API | /api/v1 | 新 route 使用统一错误、Zod、幂等和资源归属校验 |
| Skill Runtime protocol | 1.1 | Client 只依赖服务端 capabilities，不硬编码安全开关 |
| Runtime config version | 2026-08-05 | 配置摘要可用于诊断；不输出密钥和内部绝对路径 |
| Manifest schema | 1，src/server/skills/packages/manifest-schema.ts | 不兼容 manifest 必须在 inspect/import 阶段拒绝 |
| Run event schema | 1，src/server/skills/runtime/skill-run-event-registry.ts | (run_id, seq) 单调唯一；事件 payload 脱敏 |
| Legacy API | /api/v1/skills | 保持可读、可安装、可运行 Legacy Skill；不删除旧表和旧数据 |
| Legacy 与 Package 共存 | Legacy Skill 继续同步运行；Package Skill 走队列/Worker | 不自动把 Legacy row 转换为 Package row |
| Package 启动入口 | POST /api/v1/skill-runs | Legacy POST /api/v1/skills/:id/run 直接运行 Package Skill 返回 PACKAGE_SKILL_ASYNC_ONLY |
| Legacy → Package | 只提供显式 GET /api/v1/skills/:id/migration-preview | preview 不写入 Package Runtime，不自动 publish/install |
| SSE | /api/v1/skill-runs/:id/stream | 这是当前实现路径；计划文档中的 /events/stream 是兼容差异，不可作为生产 smoke URL |

### 2.3 不兼容变更处理

- 增大 schema version 时，先兼容读取，再发布写入；不能先发布只支持新字段的客户端。
- schemaVersion、manifest schema 或 protocol 不兼容时，停止切流，保留上一阶段可运行路径。
- 应用版本回滚后数据库保留新 schema；旧应用只能在已验证的向后读取范围内启动，否则维持 Package execution 关闭并保留查询/Legacy。

## 3. 发布前准备和变更窗口

### 3.1 发布前硬性 entry criteria

- [ ] RO、RTO、DBO、SO、Reviewer 已登记。
- [ ] 分支、commit、Node/npm、操作系统和变更窗口已记录。
- [ ] npm ci --ignore-scripts 已在离线/无公网依赖环境成功。
- [ ] npm run test:skills:release-gate、git diff --check 成功；无未解释的失败。
- [ ] 空库和一份脱敏的旧库已经在临时 DATA_DIR 完成 migration rehearsal。
- [ ] backup 已生成，SQLite DB、WAL/SHM 状态和 SHA-256 已记录。
- [ ] SKILL_PACKAGE_EXECUTION_ENABLED=false、所有外部 import 默认关闭；如有例外，allowlist 和审批单已绑定。
- [ ] 健康检查、诊断权限、日志和指标查询已由值班人验证。
- [ ] Legacy API/页面回归和查询既有 Run/Event/Artifact 的 smoke case 已通过。

### 3.2 变更窗口纪律

- 在 schema-only 之前冻结 destructive 数据操作。
- Migration 期间禁止并发运行多个 npm run db:migrate。
- 只允许一个发布 owner 修改阶段 flags；每次修改记录 UTC、旧值、新值、原因和审批。
- 任何安全门禁失败立即停止进入下一阶段，不通过“重试直到成功”隐藏失败。

## 4. 运维函数/API 契约和当前适配器

计划要求的运维契约为 getRuntimeHealth、getMigrationStatus、getFeatureGateStatus、runForwardFix、dryRunCleanup。当前实际情况如下：

| 契约名 | 当前生产实现/替代 | 输入/输出和使用边界 |
|---|---|---|
| getRuntimeHealth | getRuntimeHealth()；HTTP GET /api/v1/skill-runtime/health | 返回 liveness、readiness、status、checks；migrations pending 时 readiness=false |
| getMigrationStatus | getMigrationStatus()、getSkillRuntimeMigrationStatus() | 返回 current、applied[]、pending[]；必须在切流前确认 pending=[] |
| getFeatureGateStatus | 当前没有同名生产函数；用 getSkillRuntimeCapabilities() 和 GET /api/v1/skill-runtime/capabilities 替代 | 只返回脱敏开关、限制、protocol/config version；不得返回绝对内部路径、secret、DB 连接信息 |
| runForwardFix | 当前没有同名生产函数；用编号 SQL migration、runSqlMigrations() 和 DATA_DIR=<target> npm run db:migrate 实现 | 只允许已有/已审查 migration；不执行临时 SQL；输出 applied/current/pending 证据 |
| dryRunCleanup | 当前没有统一 endpoint；用只读 orphan/retention 报告适配 | 只读扫描 skill_artifacts、文件根目录、retention 字段和 ownership；生产删除前需审批、测试过的脚本和 forward-fix |

### 4.1 Health/readiness 解释

getRuntimeHealth() 的当前判定：

- liveness=true 表示 HTTP 进程存活，不代表 Package execution 可用。
- readiness=true 的必要条件：runtime enabled、package execution enabled、migrations.pending.length === 0。
- Worker crashed 时状态为 degraded；Worker 未配置/未运行但 execution readiness 已满足时会有 warning。
- install/import/creator 等独立能力仍以 capabilities 和对应 feature flag 为准。

切流前至少保存以下脱敏响应：

~~~json
{
  "data": {
    "liveness": true,
    "readiness": true,
    "status": "ready",
    "checks": [
      { "name": "runtime", "status": "ok" },
      { "name": "package_execution", "status": "ok" },
      { "name": "migrations", "status": "ok" }
    ]
  }
}
~~~

若 package_execution 为 warning，只能进入 inspect-only/install-disabled 或 shadow，不得进入 allowlist/GA。

## 5. Feature flags 和限制

所有 flags 由 skill-runtime.config.ts 统一解析、校验和缓存。布尔值接受 1/true/yes/on 或 0/false/no/off；数字必须是正整数且不超过服务端 hard limit；路径必须通过目录校验。

| 环境变量 | 默认 | 发布用途/安全要求 |
|---|---:|---|
| SKILL_RUNTIME_ENABLED | true | 总 runtime 开关；关闭后新 Runtime 功能返回 FEATURE_DISABLED |
| SKILL_PACKAGE_RUNTIME_ENABLED | 旧 alias | 兼容旧部署；仅在新对应键缺失时作为 runtime/package/import 等旧默认来源，逐步淘汰 |
| SKILL_PACKAGE_EXECUTION_ENABLED | false | Package Run/Worker；allowlist/GA 前必须显式开启 |
| SKILL_PACKAGE_IMPORT_ENABLED | false | Package inspect/install/import 总开关 |
| SKILL_GITHUB_IMPORT_ENABLED | false | GitHub archive/source import；必须同时满足 import enabled 和 host allowlist |
| SKILL_NPX_IMPORT_ENABLED | false | npx 生成目录导入；服务端不默认执行任意 npx |
| SKILL_CREATOR_ENABLED | false | Draft/validate/preview UI/API |
| SKILL_CREATOR_PUBLISH_ENABLED | false | publish；必须同时开启 Creator |
| SKILL_WORKER_CONCURRENCY | 1 | Worker 并发；不能超过 hard limit 64 |
| SKILL_LEASE_TIMEOUT_MS | 60000 | Queue lease 超时；必须在 hard limit 内 |
| SKILL_MAX_ATTEMPTS | 3 | 最大重试次数；死信前的上限 |
| SKILL_EVENT_RETENTION_DAYS | 30 | Run event 保留天数；删除前先做 dry-run 和审计 |
| SKILL_ARTIFACT_RETENTION_DAYS | 90 | Artifact 默认保留天数；有 export/审计引用时不得直接删除 |
| SKILL_PACKAGE_DATA_ROOT | <DATA_DIR>/skills/packages | Package 文件根；必须是允许的绝对目录 |
| SKILL_ARTIFACT_ROOT | <DATA_DIR>/skills/runs | Artifact 根；不能与 DB/source tree 重叠 |
| SKILL_EXPORT_ROOT | <DATA_DIR>/skills/exports | 导出根；必须做 allowlist/path policy 检查 |
| SKILL_MAX_PACKAGE_BYTES | 104857600 | Package 总大小 |
| SKILL_MAX_PACKAGE_FILES | 10000 | Package 文件数 |
| SKILL_MAX_FILE_BYTES | 10485760 | 单文件大小 |
| SKILL_MAX_RUN_DURATION_MS | 1800000 | 单次 Run 最大时长 |
| SKILL_GITHUB_REQUEST_TIMEOUT_MS | 15000 | GitHub 请求超时 |
| SKILL_GITHUB_MAX_ARCHIVE_BYTES | 104857600 | GitHub archive 最大大小 |
| SKILL_GITHUB_ALLOWED_HOSTS | github.com,api.github.com,codeload.github.com | 只允许官方 host；不得填任意 URL/内网地址 |

### 5.1 各阶段建议值

| 阶段 | execution | import/GitHub/npx | creator/publish | Worker |
|---|---|---|---|---|
| schema-only | off | off | off | 不启动或 not_configured |
| inspect-only | off | import 可按需开启；GitHub/npx 默认 off | off | 不启动 |
| install disabled | off | inspect 可用；install 写入关闭 | off | 不启动 |
| worker shadow/dry-run | off（或只对 deterministic fixture 开启） | off | off | shadow/fixture only |
| Package run allowlist | on | 仅批准 source allowlist | off 或小范围审批 | 低并发，固定 worker |
| GA | on | 按安全审批开启；npx 默认仍可关闭 | 按审批独立开启 | 按容量设置并发 |

## 6. 分阶段发布流程

每个阶段必须按 entry criteria → action → SLO → error budget → rollback trigger → owner → exit evidence 完成。任意一项没有证据则阶段保持 pending。

### 6.1 Stage 1：schema-only

**目的：** 只部署兼容代码和编号 migration，不接收 Package execution/import 流量。

- **Entry criteria：** P0-002/P0-004/P8-003 已验证；旧库 backup 已完成；空库和旧库 rehearsal 无 pending/失败；SKILL_PACKAGE_EXECUTION_ENABLED=false、import/creator 全关闭。
- **Action：** 停止写入窗口；设置明确 DATA_DIR；执行 npm run db:migrate；记录 schema_migrations、current/applied/pending、Legacy 表/row count；启动应用并检查 liveness/readiness。
- **SLO：** migration 成功率 100%；pending=[]；Legacy 表和 row count 不减少；启动后 health liveness 100%。
- **Error budget：** migration error 0；任何 Legacy 数据丢失、drop/rename 或 destructive 未授权操作的预算为 0。
- **Rollback trigger：** migration 失败、pending 非空、schema assertion 失败、Legacy row/table 减少、WAL/DB checksum 不可解释变化。
- **Owner：** DBO（执行）+ RO（判定）；RTO 负责启动检查。
- **Exit evidence：** migration snapshot、backup SHA-256、health response、旧库/新库 row count 对照、Reviewer 签字。

### 6.2 Stage 2：inspect-only

**目的：** 允许包解析、manifest/limits/security 预检，不安装、不执行。

- **Entry criteria：** Stage 1 exit evidence accepted；security negative cases 和 source allowlist 通过；SKILL_PACKAGE_EXECUTION_ENABLED=false。
- **Action：** 只开启 SKILL_PACKAGE_IMPORT_ENABLED（如需要 GitHub/npx，必须逐项审批）；执行合法、超限、Zip Slip、SSRF、manifest 错误 fixture；验证拒绝事件和 source fingerprint。
- **SLO：** inspect p95 ≤ 2s（小型 fixture）；安全拒绝 100% 可追溯；未批准 source 执行数为 0；inspect 5xx < 0.5%。
- **Error budget：** 每个发布窗口最多 0.5% 非安全 inspect 失败；安全 bypass、secret 入库、任意路径读取预算为 0。
- **Rollback trigger：** 任意未授权 host/文件通过、manifest limit 绕过、secret/prompt/file content 进入日志或 event、inspect 产生安装/执行副作用。
- **Owner：** SO（安全门禁）+ RTO（API/指标）。
- **Exit evidence：** inspect HTTP 响应、rejected files、audit snapshot、security test 输出、无副作用文件系统快照。

### 6.3 Stage 3：install disabled

**目的：** 验证安装 API 的权限和关闭语义；生产不落地 Package 安装。

- **Entry criteria：** inspect-only 无安全异常；SKILL_PACKAGE_IMPORT_ENABLED=false 或 install-specific gate 已关闭；Legacy API smoke 通过。
- **Action：** 对安装请求验证统一 FEATURE_DISABLED；确认没有 skill_packages/skill_versions/文件根目录写入；保留 migration preview 为只读。
- **SLO：** 100% 安装写请求被明确拒绝；无静默 404；Package tables/files 变更数为 0；Legacy API 成功率 ≥ 99.5%。
- **Error budget：** 关闭语义误报 ≤ 0.5%；任何未授权安装、路径越界写、Package 数据残留预算为 0。
- **Rollback trigger：** install disabled 仍产生 Package row/file、Legacy API 回归、拒绝响应泄漏路径/secret。
- **Owner：** RTO（关闭 gate）+ SO（副作用审计）。
- **Exit evidence：** HTTP error sample、DB/file diff、Legacy regression、审计查询。

### 6.4 Stage 4：worker shadow/dry-run

**目的：** 让队列、lease、恢复和指标在 deterministic fixture 上演练，不产生真实外部副作用。

- **Entry criteria：** Stage 3 无副作用；queue/worker/recovery/migration 测试全通过；测试 fixture 明确禁止 Shell/Python/MCP/容器/任意 workspace write。
- **Action：** 使用临时 DATA_DIR、临时 Package data/artifact/export root；模拟 enqueue/lease/heartbeat/lease expiry/retry/dead-letter/restart；Worker 可通过 runtime.stop({ drain: false, timeoutMs }) 停止并由启动序列 runtime.start() 恢复。
- **SLO：** fixture Run 状态和 event seq 一致率 100%；重复 command 不重复副作用；crash 后可恢复/明确失败率 100%；外部网络调用数为 0。
- **Error budget：** 状态/事件错序、重复 Artifact、逃出临时 root 或外部 side effect 的预算为 0；非关键指标丢失 ≤ 1%。
- **Rollback trigger：** Worker 处理真实 production Run、lease 双 owner、afterSeq 不可恢复、artifact path 越界、crash 后数据不可查询。
- **Owner：** RTO（Worker）+ DBO（临时库）+ SO（capability deny）。
- **Exit evidence：** queue/lease snapshot、event seq snapshot、artifact hash/size、crash recovery、网络调用计数。

### 6.5 Stage 5：Package run allowlist

**目的：** 对批准的 Package/version/owner/tenant 小范围开启执行。

- **Entry criteria：** shadow/dry-run exit evidence accepted；Package version immutable hash、manifest hash、source commit SHA/archive hash 已记录；grant/ownership/Artifact smoke 通过；allowlist 审批完成。
- **Action：** 显式开启 SKILL_PACKAGE_EXECUTION_ENABLED=true；只允许 allowlisted Package/version；维持 SKILL_GITHUB_IMPORT_ENABLED、SKILL_NPX_IMPORT_ENABLED 最小权限；监控 queue、lease、retry、dead-letter、run duration、capability errors、Artifact bytes。
- **SLO：** 非用户输入导致的 Run failure < 2%；health/readiness 99.9%；p95 queue lag ≤ 5s；critical/high security finding = 0；Artifact ownership violation = 0。
- **Error budget：** 发布窗口最多 2% 非用户错误、0.1% readiness 预算；安全/数据完整性错误不消耗可接受预算，直接 rollback。
- **Rollback trigger：** 任意 critical/high security finding、未经 grant 的 capability call、Run/Event/Artifact ownership violation、DB transaction corruption、Worker crash loop（10 分钟内 ≥ 3 次）、queue lag 连续 15 分钟超阈值。
- **Owner：** RO（切流）+ RTO（运行）+ SO（安全）。
- **Exit evidence：** allowlist、health/diagnostics、指标窗口、Run/Event/Artifact 链路、回滚演练结果、审计记录。

### 6.6 Stage 6：GA

**目的：** Package Runtime 成为受支持的生产能力，同时保留 Legacy compatibility 和独立关闭开关。

- **Entry criteria：** allowlist 窗口达到约定观察期（建议 ≥ 1 个完整业务高峰）；所有 P0/P1 test gate 通过；无未决 critical/high；backup/restore 和 rollback rehearsal accepted；on-call 已培训。
- **Action：** 扩大 allowlist；按容量提高 Worker concurrency；Creator/import/publish 仍逐项开关，不因 GA 自动全部开启；发布公告和 route/version matrix。
- **SLO：** Runtime liveness 99.95%；Package execution readiness 99.9%；非用户 Run failure < 1%；p95 queue lag ≤ 5s；security bypass、secret persistence、ownership violation = 0。
- **Error budget：** 月度可用性 0.1%；非用户错误 1%；安全、数据丢失、越权和不可审计事件预算为 0。
- **Rollback trigger：** 任一零预算事件、SLO error budget burn rate 超过发布政策、Legacy API 破坏性回归、backup/restore 不可用或 migration pending。
- **Owner：** RO（GA）+ IC（事故）+ RTO/DBO/SO（专项）。
- **Exit evidence：** GA sign-off、完整 release checklist、dashboard 截图/查询、CI logs、backup SHA-256、rollback checklist。

## 7. 备份、恢复和数据库迁移

### 7.1 发布前 SQLite backup

> 生产 backup 必须在停止写入后执行；不要在应用仍有写事务时直接复制正在变化的 DB。若使用 SQLite online backup 工具，也必须把工具输出和 checksum 记录到证据。

PowerShell 示例（将 <DATA_DIR>、<BACKUP_DIR> 替换为已批准的绝对目录）：

~~~powershell
$DataDir = (Resolve-Path '<DATA_DIR>').Path
$BackupDir = (New-Item -ItemType Directory -Force '<BACKUP_DIR>').FullName
$Stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$Db = Join-Path $DataDir 'bloomai.db'
$Wal = "$Db-wal"
$Shm = "$Db-shm"

# 1. 先停止应用/写入并确认服务已不再接受写请求。
# 2. 记录 DB/WAL/SHM 是否存在、大小、LastWriteTimeUtc。
Get-Item $Db, $Wal, $Shm -ErrorAction SilentlyContinue |
  Select-Object FullName, Length, LastWriteTimeUtc

# 3. 复制 DB；WAL/SHM 若存在，必须一起保留并记录，不得悄悄丢弃。
Copy-Item -LiteralPath $Db -Destination (Join-Path $BackupDir "bloomai-$Stamp.db") -Force
if (Test-Path -LiteralPath $Wal) { Copy-Item -LiteralPath $Wal -Destination (Join-Path $BackupDir "bloomai-$Stamp.db-wal") -Force }
if (Test-Path -LiteralPath $Shm) { Copy-Item -LiteralPath $Shm -Destination (Join-Path $BackupDir "bloomai-$Stamp.db-shm") -Force }

Get-ChildItem -LiteralPath $BackupDir -Filter "bloomai-$Stamp.db*" |
  Get-FileHash -Algorithm SHA256
~~~

Backup evidence 至少包含：

- DB、WAL、SHM 的存在状态和大小；
- 每个 backup 文件的 SHA-256；
- DB owner、UTC 时间、来源 DATA_DIR 的脱敏标识；
- restore rehearsal 目标临时 DATA_DIR 和结果；
- 不把生产用户数据复制进仓库或聊天输出。

### 7.2 旧库和空库 migration rehearsal

npm run db:migrate 的 wrapper 会拒绝没有显式 DATA_DIR 的执行。每次 rehearsal 使用独立临时目录：

~~~powershell
$env:DATA_DIR = '<TEMP_ROOT>\empty-db'
npm run db:migrate

$env:DATA_DIR = '<TEMP_ROOT>\legacy-copy'
npm run db:migrate
~~~

验收：

- schema_migrations 已记录所有当前 migration；
- getSkillRuntimeMigrationStatus() 返回 pending=[]；
- 重复执行是 no-op；
- Legacy skills、skill_runs、相关旧表和 row count 保留；
- Package 的 (run_id, seq)、(run_id, idempotency_key)、queue active lease、grant usage、Artifact ownership 不变量通过；
- 任何错误通过新增 forward-fix 解决，不回写旧 migration。

### 7.3 Forward-fix 执行契约

当前没有名为 runForwardFix 的生产函数。正式操作等价于：

1. DBO 提交编号 SQL migration，说明影响表、默认值、锁/耗时、兼容读取和回滚/forward-fix 方案。
2. 在空库、旧库副本和带 representative Package rows 的临时库执行。
3. 用 DATA_DIR=<target> npm run db:migrate 执行；禁止省略 DATA_DIR。
4. 记录 current/applied/pending、schema snapshot、row count、hash 和测试输出。
5. 通过 RO/DBO/Reviewer 审批后再在生产窗口执行。

应用版本回滚不能撤销 destructive migration。若旧应用无法读取新 schema：

- 先关闭 Package execution/import/Creator；
- 保留 DB 新 schema、Run/Event/Artifact 和 Legacy API；
- 发布兼容读取修复或新的 forward-fix；
- 不能直接 DROP COLUMN、删除 schema_migrations row 或手工改表模拟回滚。

### 7.4 Restore rehearsal

恢复必须先在临时目录完成：

~~~powershell
$env:DATA_DIR = '<TEMP_ROOT>\restore-rehearsal'
# 将已校验的 backup DB/WAL/SHM 复制到该目录
npm run db:migrate
npm run typecheck:skills
npm run test:skills:migration
~~~

确认：

- backup SHA-256 与记录一致；
- 应用能启动并通过 health；
- Legacy 查询、Package 查询、Event afterSeq、Artifact metadata 可读；
- 不把 restore rehearsal 指向生产 DATA_DIR；
- 不在恢复演练中执行未审批的 delete/cleanup。

## 8. Worker、队列和运行态操作

### 8.1 停止 Worker/应用

当前启动和优雅停止逻辑位于 src/server/index.ts：

- 启动在 migrations/recovery 后调用 runtime.start()；
- graceful shutdown 调用 runtime.stop({ drain: false, timeoutMs: 5_000 })；
- 停止时保留 DB、Run/Event/Artifact；不要直接删除 queue row 或临时文件。

生产操作优先使用服务管理器发送 SIGTERM/SIGINT，或调用等价的受控进程停止；不要在数据库上伪造 Worker 状态。若使用内部操作 harness，必须执行：

~~~ts
await runtime.stop({ drain: false, timeoutMs })
// 记录 worker status、active runs、lease 和 shutdown result
~~~

### 8.2 重启和恢复

1. 确认 DB backup/checksum 和 flags 已记录。
2. 确认没有 pending migration；如有，先走第 7.3，不直接启动 Worker。
3. 启动应用；启动序列会 load config、run migrations、标记可恢复 interrupted Run，然后 runtime.start()。
4. 通过 health/diagnostics 检查 worker status、queue depth/lag、lease expiry、retry、dead-letter、runsByStatus。
5. 用一个 approved deterministic Run 验证 event seq、afterSeq、Artifact hash/ownership，再扩大流量。

## 9. Orphan cleanup、retention 和 Artifact 恢复

### 9.1 dryRunCleanup 当前运维实现

当前没有统一的 dryRunCleanup endpoint。生产只能执行只读报告，至少关联：

- skill_artifacts row 与 run_id/owner；
- Artifact 文件是否位于 SKILL_ARTIFACT_ROOT；
- sha256、size、mime 和 relative_path 是否一致；
- retention_until、exported_at、审计/业务引用；
- 文件存在但 DB 无 row、DB row 但文件缺失、已 soft-delete 但仍被引用的 orphan 分类。

只读报告要求：

- 输出计数、ID/hash 和脱敏相对路径，不输出内容/secret；
- 生成后由 RTO/DBO/SO 审核；
- 生产删除只能通过已测试脚本或 forward-fix，附审批和恢复方案；
- rollback 不触发 cleanup，不删除已有 Run/Event/Artifact。

### 9.2 Retention policy

- Run/Event/Artifact 的默认保留值来自 SKILL_EVENT_RETENTION_DAYS 和 SKILL_ARTIFACT_RETENTION_DAYS。
- retention 到期不等于可删除：仍有 export、审计、法律/业务保留或 owner 引用时必须保留或转移。
- 先标记/报告，再执行删除；删除前保存 row count、文件 count、hash manifest 和审批。
- soft delete/tombstone 必须保持查询和审计可追溯；不能因为应用回滚清空数据。
- 导出目录必须经过 SKILL_EXPORT_ROOT 和 path policy；导出 HTTP 响应不得泄漏内部绝对路径。

## 10. 安全事件响应

### 10.1 触发条件

任一以下事件立即进入 incident response：

- Package 通过 manifest/reader/path policy 读取越界文件；
- 未授予 capability 被执行，或 calls_used > max_calls；
- GitHub/npx source 未经 allowlist 访问；
- secret、token、password、完整 prompt、文件原文进入 DB/event/artifact/log；
- Artifact/Run/Package ownership 失败；
- 恶意 archive、Zip Slip、SSRF、XSS、下载 header 或 CORS/CSRF 绕过；
- Worker crash loop、队列 lease 双 owner、事件 seq 破坏或数据完整性异常。

### 10.2 立即 containment

1. IC 宣布 incident，冻结阶段推进和 destructive cleanup。
2. RTO 将以下 flags 关闭并记录旧值/新值：
   - SKILL_PACKAGE_EXECUTION_ENABLED=false
   - SKILL_PACKAGE_IMPORT_ENABLED=false
   - SKILL_GITHUB_IMPORT_ENABLED=false
   - SKILL_NPX_IMPORT_ENABLED=false
   - SKILL_CREATOR_PUBLISH_ENABLED=false
   - 如需完全冻结 Creator，再设 SKILL_CREATOR_ENABLED=false。
3. 停止/暂停 Worker，使用受控 runtime.stop({ drain: false, timeoutMs })；不要删除队列或历史数据。
4. 保留 health、diagnostics、audit、Run/Event/Artifact 查询和 Legacy API；对外公告明确“新 Package Run 暂停”。
5. 保存脱敏日志、metrics、审计、source fingerprint、manifest/archive hash、affected run/version/grant IDs；不复制 secret 内容。

### 10.3 修复和恢复

- SO 给出 finding、影响范围和临时 deny policy；修复只允许收紧策略。
- DBO 保存受影响 DB/文件快照，先在临时 DATA_DIR 重现/恢复。
- Schema/data 修复提交 migration/脚本，不手工改生产 SQL；完成测试和审批后 forward-fix。
- 只对批准版本/owner 重新打开 inspect/install/execution；先 deterministic smoke，再小范围 allowlist。
- 记录 incident timeline、flags、metrics、审计查询、rollback/restore 结果和 reviewer sign-off。

## 11. HTTP Route 清单

所有以下 route 当前由 src/server/http/app.ts 挂在 /api/v1；/stream 是实际 SSE 路径。

### 11.1 Runtime capability/health/security

- GET /api/v1/skill-runtime/capabilities
- GET /api/v1/skill-runtime/health
- GET /api/v1/skill-runtime/diagnostics（要求 x-bloom-role: admin）
- GET /api/v1/skill-security/status（管理员角色）

### 11.2 Package/import/version

- POST /api/v1/skill-packages/inspect
- POST /api/v1/skill-packages/install
- GET /api/v1/skill-import-reviews/:id
- POST /api/v1/skill-import-reviews/:id/approve
- POST /api/v1/skill-import-reviews/:id/reject
- GET /api/v1/skill-packages
- GET /api/v1/skill-installations
- GET /api/v1/skill-packages/:id
- DELETE /api/v1/skill-packages/:id
- GET /api/v1/skill-packages/:id/versions
- GET /api/v1/skill-versions/:id
- GET /api/v1/skill-versions/:id/diff
- POST /api/v1/skill-packages/:id/update/preview
- POST /api/v1/skill-packages/:id/update
- PATCH /api/v1/skill-installations/:id
- POST /api/v1/skill-installations/:id/switch-version
- POST /api/v1/skill-installations/:id/rollback
- DELETE /api/v1/skill-installations/:id

### 11.3 Capability grant、Run、Event、Artifact

- DELETE /api/v1/skill-capability-grants/:id
- POST /api/v1/skill-capability-grants/:id/approve
- POST /api/v1/skill-capability-grants/:id/reject
- POST /api/v1/skill-capability-grants/:id/revoke
- POST /api/v1/skill-runs
- GET /api/v1/skill-runs
- GET /api/v1/skill-runs/:id
- GET /api/v1/skill-runs/:id/next-action
- GET /api/v1/skill-runs/:id/capabilities
- GET /api/v1/skill-runs/:id/events
- GET /api/v1/skill-runs/:id/stream
- POST /api/v1/skill-runs/:id/commands
- POST /api/v1/skill-runs/:id/cancel
- GET /api/v1/skill-runs/:id/artifacts
- GET /api/v1/skill-artifacts/:id/content
- POST /api/v1/skill-artifacts/:id/export

### 11.4 Creator

- POST /api/v1/skill-drafts
- GET /api/v1/skill-drafts/:id
- PATCH /api/v1/skill-drafts/:id
- DELETE /api/v1/skill-drafts/:id
- POST /api/v1/skill-drafts/:id/validate
- POST /api/v1/skill-drafts/:id/preview
- POST /api/v1/skill-drafts/:id/publish

### 11.5 Legacy compatibility

- GET /api/v1/skills
- GET /api/v1/skills/overview
- GET /api/v1/skills/market
- POST /api/v1/skills/install
- POST /api/v1/skills
- GET /api/v1/skills/:id/migration-preview
- GET /api/v1/skills/:id
- PATCH /api/v1/skills/:id
- DELETE /api/v1/skills/:id
- POST /api/v1/skills/:id/run
- GET /api/v1/skills/:id/runs

Legacy route 的 /:id/run 不能绕过 Package async-only contract；Package Skill 必须经 POST /api/v1/skill-runs。

### 11.6 相邻消费者

- Chat：GET /api/v1/chat/sessions/:id/skills、POST /api/v1/chat/sessions/:id/skill-runs
- Article Illustration：
  - GET /api/v1/article-illustrations/eligible-skills
  - GET /api/v1/article-illustrations/recoverable
  - POST /api/v1/article-illustrations/plans
  - GET /api/v1/article-illustrations/:id
  - PATCH /api/v1/article-illustrations/:id/scenes/:sceneId
  - POST /api/v1/article-illustrations/:id/confirm
  - POST /api/v1/article-illustrations/:id/resume
  - POST /api/v1/article-illustrations/:id/scenes/:sceneId/retry
  - GET /api/v1/article-illustrations/:id/export

## 12. Migration inventory 和不变量

所有 numbered migration 位于 scripts/migrations。文件名是事实来源；计划第 9 节中的逻辑编号（例如“007 queue”“008 drafts”）与当前仓库实际编号存在偏移，发布时以实际 030–043 文件为准。

### 12.1 001–029 历史 migration

这些 migration 必须保留 schema_migrations 记录，不能删除 Legacy 表或历史 row。它们的作用如下：

| ID | 实际文件/作用 | 兼容要求 |
|---|---|---|
| 001 | 001-skill-runtime-core.sql：Package、Version、Installation、skill_runs_v2 基础表 | 与 Legacy skills/skill_runs 并存，不自动转换 |
| 002 | 002-skill-runtime-events.sql：Run event、seq、schema version、索引 | 保留历史 event；(run_id, seq) 唯一 |
| 003 | 003-skill-runtime-artifacts.sql：Artifact metadata、hash、size、run ownership | 保留 Artifact row 和可查询性 |
| 004 | 004-skill-capability-grants.sql：Capability grant 基础表 | Legacy grant 仍可读 |
| 005 | 005-skill-capability-grant-state.sql：session/consumed state | 默认值保持旧 grant 可读 |
| 006 | 006-skill-run-commands.sql：命令幂等记录 | (run_id, idempotency_key) 唯一 |
| 007 | 007-article-illustration-jobs.sql：Article Illustration job 与 Run/Image link | 不影响 Legacy Skill 表 |
| 008 | 008-deep-research-core.sql：Deep Research run/source/section 基础数据 | 与 Skills Runtime 隔离 |
| 009 | 009-deep-research-recovery-commands.sql：Deep Research recovery command 幂等 | 不删除既有 research run |
| 010 | 010-deep-research-resilience.sql：attempt/checkpoint/cancel/resume resilience | additive/legacy-safe；不回写已完成历史语义 |
| 011 | 011-deep-research-coverage-assessments.sql：coverage assessment | 保留历史 assessment |
| 012 | 012-deep-research-iteration-idempotency.sql：iteration/idempotency | 保留旧 iteration 记录 |
| 013 | 013-deep-research-attempt-lease-ownership.sql：attempt lease/owner | 不与 Skill queue lease 混用 |
| 014 | 014-deep-research-reconciliation.sql：reconciliation/repair fields | 修复只 forward-fix |
| 015 | 015-deep-research-model-selection-snapshot.sql：模型选择快照 | 保留旧 snapshot |
| 016 | 016-deep-research-llm-runtime-usage.sql：LLM usage | 脱敏，不回收历史 usage |
| 017 | 017-deep-research-structured-model-traces.sql：structured model traces | 只读兼容 |
| 018 | 018-deep-research-brief-question-section-mapping.sql：brief/question/section mapping | 保留映射 |
| 019 | 019-deep-research-query-intents-deduplication.sql：query intent/dedup | 不影响 Package data |
| 020 | 020-deep-research-source-quality-assessments.sql：source quality | 保留 source quality 记录 |
| 021 | 021-deep-research-structured-evidence.sql：structured evidence | legacy evidence 使用保守默认值 |
| 022 | 022-deep-research-section-drafts.sql：section drafts | 保留历史草稿 |
| 023 | 023-deep-research-semantic-citation-quality-gates.sql：citation quality gate | 不删除 citation/audit |
| 024 | 024-scheduled-task-runs.sql：scheduled task run 数据 | 与 Skill Worker 独立 |
| 025 | 025-project-chat-workspaces.sql：project/chat workspace 数据 | 不修改 workspace ownership |
| 026 | 026-disable-placeholder-tools.sql：停用 placeholder tools | 只影响工具可用性，不删除 Skills history |
| 027 | 027-tool-permissions-permanent-only.sql：tool permission lifecycle | 不把工具权限自动转成 Skill grant |
| 028 | 028-tools-platform-b1.sql：tools platform B1 基础结构 | 保留旧 tool run/permission |
| 029 | 029-tools-platform-b1-patch.sql：tools platform B1 patch/兼容修复 | additive/forward-fix |

### 12.2 当前 Skills Runtime 030–043

| ID | 实际文件 | 作用 | 回滚/兼容要求 |
|---|---|---|---|
| 030 | 030-skill-runtime-queue-and-control-plane.sql | skill_run_queue、skill_import_reviews、skill_audit_events 和控制面结构 | Legacy rows remain readable；active lease 单 owner |
| 031 | 031-skill-version-drafts-and-snapshots.sql | skill_drafts、version snapshots/diffs | draft 与 immutable version 分离；不自动 publish |
| 032 | 032-skill-run-state-machine.sql | Run revision、required action、heartbeat、cancel/checkpoint 状态 | 只追加字段/索引；历史 Run 可查询 |
| 033 | 033-skill-run-event-protocol.sql | producer/occurred_at、event schema/索引 | (run_id, seq) 唯一；afterSeq 可恢复 |
| 034 | 034-skill-run-execution-metrics.sql | execution metrics、usage、timing、error 字段 | 指标可读；不泄漏 secret |
| 035 | 035-skill-run-recovery.sql | interrupted/recovery/lease/checkpoint 字段 | restart 后可恢复或明确失败 |
| 036 | 036-skill-capability-grant-lifecycle.sql | requested/granted scope、status、approval/revoke、owner、usage/idempotency | 老 grant 用保守 approved 默认；granted scope 是 requested 子集 |
| 037 | 037-skill-run-waiting-actions.sql | waiting_since/waiting_expires_at | approval/waiting 持久化、重复动作安全 |
| 038 | 038-skill-artifact-retention-export.sql | retention_until/exported_at/exported_by | retention 不绕过 ownership/审计 |
| 039 | 039-skill-version-lifecycle.sql | immutable_hash/status/security_status/snapshot_hash/published_at、installation revision/rollback/delete state | current version 必须同 package 且 runnable |
| 040 | 040-skill-lifecycle-delete.sql | Package soft delete/tombstone | 不 destructive delete；查询和审计保留 |
| 041 | 041-skill-artifact-policy.sql | artifact_kind/relative_path、hash/size/path policy 索引 | path 只允许 root 内相对路径 |
| 042 | 042-image-studio-skill-links.sql | Image Studio session/generation 与 Skill Run/Artifact link | nullable/legacy-compatible；CI provider mock |
| 043 | 043-skill-security-audit-fields.sql | security_decision、policy_version、source_fingerprint、security findings | secrets 不入 DB/event/artifact；legacy 默认安全 |

### 12.3 数据不变量

切流和 rollback 后都必须重新验证：

1. SkillRun 只能引用存在的 immutable SkillVersion。
2. active Installation 的 current_version_id 属于同一 package 且 version 可运行。
3. (run_id, seq) 和 (run_id, idempotency_key) 唯一。
4. 一个 Run 不能同时拥有多个 active queue lease owner。
5. grant 的 granted scope 是 requested scope 子集，calls_used <= max_calls。
6. Artifact run_id ownership、文件 SHA-256、size、mime 和相对路径一致。
7. soft delete 不破坏 Run/Event/Artifact 查询和审计。
8. UTC 时间列、revision、DTO 和 renderer 约定一致。

## 13. 日志、指标和诊断查询

### 13.1 HTTP 诊断

- Liveness/readiness：GET /api/v1/skill-runtime/health
- Feature gate：GET /api/v1/skill-runtime/capabilities
- Admin diagnostics：GET /api/v1/skill-runtime/diagnostics，带 x-bloom-role: admin
- Security summary：GET /api/v1/skill-security/status，管理员角色

诊断响应至少关注：queueDepth、queueLagMs、leaseExpired、retry、deadLetter、artifactBytes、approvalWaitMs、runDurationMs、capabilityCalls、capabilityLatencyMs、artifactOperations、importRejects、runsByStatus、capabilityErrors。

### 13.2 文件日志

默认日志：DATA_DIR/logs/YYYY-MM-DD.jsonl。查询时：

- 先按 requestId、runId、skillVersionId、workerId、grantId、artifactId 串联；
- 只保留错误码、状态、耗时、hash、计数和脱敏相对路径；
- authorization、bearer、token、secret、password、credential 替换为 [REDACTED]；
- 不把 package.file_loaded 的文件内容写入事件；事件仅含 path、sha256、sizeBytes。

### 13.3 Metrics

当前 HTTP metric 名称：bloomai.http.request.duration_ms。Skills Runtime metrics 需要按发布阶段观察：

- queue depth/lag、lease expiry、retry/dead-letter；
- run duration/status/failure；
- capability calls/latency/errors；
- grant approval wait/usage；
- Artifact bytes/operations/export；
- import reject/security decision。

每个阶段证据至少保存查询时间窗、过滤条件、聚合结果和 dashboard/CI artifact 引用；不直接提交含内部绝对路径或用户内容的原始日志。

## 14. 关闭、恢复和发布后观察

### 14.1 正常关闭 Package execution

1. 记录当前 capabilities、health、diagnostics、queue/run counts。
2. 设置 SKILL_PACKAGE_EXECUTION_ENABLED=false；停止新 Package Run，保留查询。
3. 通过受控 shutdown 执行 runtime.stop({ drain: false, timeoutMs: 5_000 })。
4. 确认 active lease、Worker status、Run/Event/Artifact 查询仍可用。
5. Legacy routes 保持可用；外部 import/Creator 继续按各自 flags 处理。

### 14.2 恢复 Package execution

1. 确认 incident/rollback trigger 已关闭，DB backup/restore 和 forward-fix 证据已接受。
2. 在临时 root 用 deterministic fixture 验证 package/version/grant/Artifact。
3. 设置 SKILL_PACKAGE_EXECUTION_ENABLED=true，先只开一个 allowlist。
4. 启动应用，确认 runtime.start()、health readiness、Worker heartbeat、queue lag。
5. 观察一个完整窗口后再扩大 allowlist；保存新的 release evidence。

### 14.3 发布后观察窗口

- 15 分钟：health/readiness、Worker crash、queue lag、5xx、security rejects。
- 1 小时：Run status、retry/dead-letter、capability error、Artifact ownership/export。
- 1 个业务高峰：SLO/error budget、Legacy regression、migration pending、backup availability。
- 观察窗口内不得执行未经批准的 retention cleanup 或删除。

## 15. 完成标准和证据归档

P8-004 只有在以下条件全部满足后才可标记 Done：

- [ ] 运维人员可按本文完成六阶段发布，不依赖作者口头解释。
- [ ] 备份、WAL/SHM、SHA-256、空库/旧库 migration rehearsal 有证据。
- [ ] health/readiness、capabilities、diagnostics、security status 有脱敏响应。
- [ ] 所有 Skills Runtime/Legacy/相邻消费者 route 已列出并 smoke。
- [ ] 030–043 以及 001–029 历史 migration 有 inventory；Legacy table/data 不删除。
- [ ] forward-fix、orphan cleanup、retention 和 security incident response 有明确 owner/审批/回滚边界。
- [ ] Package execution 回滚不删除 Run/Event/Artifact，Legacy API 保持可用。
- [ ] release-checklist.md 和 rollback-checklist.md 已填写或作为本次发布的待填写模板归档。

关联证据模板：

- docs/skills/evidence/release-checklist.md
- docs/skills/evidence/rollback-checklist.md
- docs/skills/evidence/README.md
- docs/skills/evidence/release-gate.md
- docs/skills/evidence/migration-schema-snapshot.md

---

## 附录 A：最小 smoke 命令集

~~~powershell
# 依赖和 Skills Runtime 门禁
npm ci --ignore-scripts
npm run lint
npm run typecheck:skills
npm run test:skills:unit
npm run test:skills:integration
npm run test:skills:security
npm run test:skills:migration
npm run test:skills:e2e
npm run test:skills:release-gate

git diff --check
~~~

HTTP smoke（服务运行后，使用脱敏输出）：

~~~powershell
$Base = 'http://127.0.0.1:<PORT>/api/v1'
Invoke-RestMethod "$Base/skill-runtime/capabilities"
Invoke-RestMethod "$Base/skill-runtime/health"
Invoke-RestMethod "$Base/skill-runtime/diagnostics" -Headers @{ 'x-bloom-role' = 'admin' }
Invoke-RestMethod "$Base/skill-security/status" -Headers @{ 'x-bloom-role' = 'admin' }
~~~

任何命令输出含生产绝对路径、token、cookie、secret 或用户内容时，先脱敏再归档；原始输出只存受控 CI/运维系统，不提交仓库。
