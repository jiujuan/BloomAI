
# Skills Runtime v1.1 发布验收清单

> **Task ID：** SKL-P8-004
> **Branch：** feat/skills-system-v1.1-impl
> **用途：** 发布前、每次阶段切换和 GA 签字的可复查清单。不要把本模板中的 <...> 当作已完成证据。

## 1. 验收元数据

| 字段 | 值 |
|---|---|
| Release candidate / commit | <version-or-40-char-sha> |
| Generated at (UTC) | <YYYY-MM-DDTHH:mm:ssZ> |
| DATA_DIR（脱敏） | <TEMP_ROOT or production alias> |
| Node / npm / OS | <node -v / npm -v / OS> |
| Release Owner | <name or role> |
| Runtime Owner | <name or role> |
| Database Owner | <name or role> |
| Security Owner | <name or role> |
| Reviewer | <name or role> |
| Decision | pending / accepted / blocked / rolled_back |

## 2. 变更和保护检查

- [ ] 目标分支和 commit 已锁定；git status --short --branch 已保存。
- [ ] 变更文件与本任务范围一致；没有把用户未跟踪文件、生产 DB、日志、secret 加入提交。
- [ ] package-lock.json 与安装环境一致；npm ci --ignore-scripts 成功。
- [ ] Node 满足项目 engine（>=22.16.0）。
- [ ] backup 在停止写入后生成；DB/WAL/SHM 状态记录完整。
- [ ] backup 每个文件 SHA-256 已记录，且没有把原始生产内容提交仓库。
- [ ] restore rehearsal 已在独立临时 DATA_DIR 完成。
- [ ] 当前 migration pending=[]；旧库 Legacy 表/row count 对照通过。

## 3. 六阶段门禁

| 阶段 | Entry criteria | SLO / error budget | Rollback trigger | Owner | Exit evidence | 状态 |
|---|---|---|---|---|---|---|
| schema-only | backup、空库/旧库 rehearsal、flags 全关 | migration 100%；数据丢失预算 0 | migration 失败、pending、Legacy row/table 减少 | DBO + RO | migration snapshot、backup hash、health | ☐ |
| inspect-only | security negative cases 通过、execution off | inspect p95 ≤ 2s；bypass/secret 预算 0 | source/path/manifest 绕过或副作用 | SO + RTO | inspect HTTP、audit、文件 diff | ☐ |
| install disabled | inspect-only accepted、install 写入关闭 | 安装写请求 100% FEATURE_DISABLED | Package row/file 写入、Legacy 回归 | RTO + SO | error sample、DB/file diff | ☐ |
| worker shadow/dry-run | queue/recovery/crash fixture 通过 | 状态/event 100% 一致；网络 side effect 0 | lease 双 owner、事件错序、越界 Artifact | RTO + DBO + SO | queue/event/artifact snapshot | ☐ |
| Package run allowlist | immutable/source/grant/ownership accepted | 非用户失败 <2%；queue p95 ≤5s | critical/high、越权、crash loop、数据破坏 | RO + RTO + SO | allowlist、metrics、E2E、rollback rehearsal | ☐ |
| GA | 观察窗口、全门禁、on-call、备份恢复 accepted | readiness 99.9%；非用户失败 <1%；零安全事件 | 零预算事件或 error budget burn 超限 | RO + IC | GA sign-off、完整证据包 | ☐ |

## 4. Feature flag 记录

在每次阶段切换填写旧值、新值、操作者、UTC、审批和原因。

| Flag | 旧值 | 新值 | 操作者/UTC | 审批/原因 |
|---|---|---|---|---|
| SKILL_RUNTIME_ENABLED | <...> | <...> | <...> | <...> |
| SKILL_PACKAGE_EXECUTION_ENABLED | <...> | <...> | <...> | <...> |
| SKILL_PACKAGE_IMPORT_ENABLED | <...> | <...> | <...> | <...> |
| SKILL_GITHUB_IMPORT_ENABLED | <...> | <...> | <...> | <...> |
| SKILL_NPX_IMPORT_ENABLED | <...> | <...> | <...> | <...> |
| SKILL_CREATOR_ENABLED | <...> | <...> | <...> | <...> |
| SKILL_CREATOR_PUBLISH_ENABLED | <...> | <...> | <...> | <...> |
| SKILL_WORKER_CONCURRENCY | <...> | <...> | <...> | <...> |
| SKILL_LEASE_TIMEOUT_MS | <...> | <...> | <...> | <...> |
| SKILL_MAX_ATTEMPTS | <...> | <...> | <...> | <...> |
| SKILL_EVENT_RETENTION_DAYS | <...> | <...> | <...> | <...> |
| SKILL_ARTIFACT_RETENTION_DAYS | <...> | <...> | <...> | <...> |
| SKILL_PACKAGE_DATA_ROOT | <redacted> | <redacted> | <...> | <...> |
| SKILL_ARTIFACT_ROOT | <redacted> | <redacted> | <...> | <...> |
| SKILL_EXPORT_ROOT | <redacted> | <redacted> | <...> | <...> |
| SKILL_MAX_PACKAGE_BYTES | <...> | <...> | <...> | <...> |
| SKILL_MAX_PACKAGE_FILES | <...> | <...> | <...> | <...> |
| SKILL_MAX_FILE_BYTES | <...> | <...> | <...> | <...> |
| SKILL_MAX_RUN_DURATION_MS | <...> | <...> | <...> | <...> |
| SKILL_GITHUB_REQUEST_TIMEOUT_MS | <...> | <...> | <...> | <...> |
| SKILL_GITHUB_MAX_ARCHIVE_BYTES | <...> | <...> | <...> | <...> |
| SKILL_GITHUB_ALLOWED_HOSTS | <...> | <...> | <...> | <...> |

## 5. Backup、migration 和恢复证据

- [ ] Backup 时间、操作者、DB/WAL/SHM 状态已记录。
- [ ] DB backup SHA-256：<hash>。
- [ ] WAL backup SHA-256（如存在）：<hash>。
- [ ] SHM backup SHA-256（如存在）：<hash>。
- [ ] 空库命令/结果：DATA_DIR=<TEMP_ROOT> npm run db:migrate → <exit/result>。
- [ ] 旧库副本命令/结果：DATA_DIR=<TEMP_ROOT> npm run db:migrate → <exit/result>。
- [ ] 重复 migration 是 no-op。
- [ ] current/applied/pending：<redacted JSON>。
- [ ] Legacy 表/row count 对照：<snapshot path/result>。
- [ ] Forward-fix migration ID/审批：<id/approval>。
- [ ] Restore rehearsal 目录和结果：<TEMP_ROOT/result>。
- [ ] 应用回滚后新 schema 保留：<result>。

## 6. Health、capabilities、diagnostics 和 security smoke

- [ ] GET /api/v1/skill-runtime/capabilities 返回 protocol 1.1、config 2026-08-05 和脱敏 limits。
- [ ] GET /api/v1/skill-runtime/health：liveness=true；进入 allowlist/GA 时 readiness=true。
- [ ] GET /api/v1/skill-runtime/diagnostics 带 x-bloom-role: admin 成功；未授权请求被拒绝。
- [ ] GET /api/v1/skill-security/status 管理员请求成功；响应不含攻击细节/secret。
- [ ] health checks 显示 migrations 无 pending。
- [ ] 诊断记录 queue depth/lag、lease/retry/dead-letter、run status、capability errors、Artifact bytes。
- [ ] 日志 DATA_DIR/logs/YYYY-MM-DD.jsonl 已脱敏。

## 7. HTTP smoke matrix

| Flow | Endpoint | 预期 | 证据 |
|---|---|---|---|
| capabilities | GET /api/v1/skill-runtime/capabilities | version/flags/limits，无内部绝对路径 | <response> |
| health | GET /api/v1/skill-runtime/health | liveness/readiness 与阶段一致 | <response> |
| inspect | POST /api/v1/skill-packages/inspect | 合法包通过、恶意/超限包拒绝 | <response/fixture> |
| install disabled | POST /api/v1/skill-packages/install | FEATURE_DISABLED、无 DB/file 写入 | <response/diff> |
| import review | GET/POST /api/v1/skill-import-reviews/:id* | approve/reject 有审计 | <audit> |
| run | POST /api/v1/skill-runs | 仅 allowlist/version 可执行 | <runId> |
| event | GET /api/v1/skill-runs/:id/events | afterSeq、seq/schema 正确 | <events> |
| SSE | GET /api/v1/skill-runs/:id/stream | 当前实现路径可订阅 | <trace/log> |
| command | POST /api/v1/skill-runs/:id/commands | revision/idempotency 生效 | <response> |
| artifact | GET /api/v1/skill-runs/:id/artifacts | ownership 通过 | <response> |
| export | POST /api/v1/skill-artifacts/:id/export | export root/path policy 通过 | <file/hash> |
| grant | POST /api/v1/skill-capability-grants/:id/{approve,reject,revoke} | 未授权被拒绝、审计完整 | <audit> |
| legacy | GET /api/v1/skills、POST /api/v1/skills/:id/run | Legacy 可用；Package 直跑返回 PACKAGE_SKILL_ASYNC_ONLY | <response> |
| creator | POST /api/v1/skill-drafts/:id/{validate,preview,publish} | flags/权限正确；preview 不 publish | <response> |

## 8. 测试矩阵和证据

| Gate | Command | Exit code / count | 证据路径或 CI artifact |
|---|---|---|---|
| lint | npm run lint | <...> | <...> |
| Skills typecheck | npm run typecheck:skills | <...> | <...> |
| unit | npm run test:skills:unit | <...> | <...> |
| integration | npm run test:skills:integration | <...> | <...> |
| security | npm run test:skills:security | <...> | <...> |
| migration | npm run test:skills:migration | <...> | <...> |
| browser E2E | npm run test:skills:e2e | <...> | <trace/video or deterministic harness> |
| release gate | npm run test:skills:release-gate | <...> | <CI log> |
| diff | git diff --check | <...> | <log> |

最低验收：

- [ ] happy path 至少一条。
- [ ] negative path 至少两条（无授权、路径越界/超预算）。
- [ ] crash recovery 至少一条。
- [ ] ownership negative case 至少一条。
- [ ] 运行离线，不依赖 GitHub、npx、LLM、Image 公网。
- [ ] 测试使用临时 DB/data root，运行后无残留。

## 9. 最终签字

- [ ] RO：阶段和 error budget 已复核。
- [ ] RTO：Worker、health/readiness、metrics 已复核。
- [ ] DBO：backup/restore/migration/forward-fix 已复核。
- [ ] SO：source/capability/path/log redaction 已复核。
- [ ] Reviewer：变更范围、文档、命令输出和脱敏已复核。

**Decision：** <accepted / blocked / rolled_back>
**Reason / follow-up：** <...>
**Signed at (UTC)：** <...>
