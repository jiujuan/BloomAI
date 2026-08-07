# Skills Admin v1.2 P0 Baseline Evidence

## 验收元数据

| 字段 | 值 |
|---|---|
| Task ID | `SKL12-P0-001` / `SKL12-P0-002` / `SKL12-P0-003` / `SKL12-P0-004` |
| Branch | `feat/skills-admin-system` |
| Commit SHA | `85380f1c6bd06cfde6c7a1b4920d7053a4f1b6fd`（证据生成时的源码父版本；最终提交 SHA 见 Git 交付记录） |
| Generated at (UTC) | `2026-08-07T22:51:16Z` |
| Status | evidence captured; reviewer acceptance pending |

## SKL12-P0-001：源码基线与 Legacy 依赖图

验证命令：

```powershell
npx tsx scripts/skills/p0-baseline-scan.ts --root .
```

完整机器可读快照：[p0-baseline-scan.json](./p0-baseline-scan.json)。

- 扫描文件：**432**
- Legacy 引用：**515**
- 依赖图节点：**996**
- 依赖图边：**1392**

### Legacy disposition 汇总

| Disposition | 数量 | 决策 |
|---|---:|---|
| `audit-retain` | 218 | 仅用于迁移/审计验证，不作为 Package Runtime Catalog 输入。 |
| `delete` | 15 | Package Runtime 替换后进入 P4 删除；P0 不直接删除。 |
| `migrate-retain` | 282 | 迁移完成、备份、回滚和显式批准前只读保留。 |

### 引用分类

| Kind | 数量 |
|---|---:|
| `import` | 35 |
| `route` | 7 |
| `schema/database` | 23 |
| `test/fixture` | 450 |

每一条引用均在 JSON 快照中保留 `file`、`line`、`kind`、匹配文本、`disposition` 和 `rationale`；因此不能以“源码已删除”替代扫描证据。P0 只冻结基线和清理决策，不执行旧表或 Legacy 代码的物理删除。

## SKL12-P0-002：Runtime、Feature Flag 和权限边界

- 缺失配置使用安全默认值；Package Runtime 与 Legacy 生命周期/执行状态分离。
- Runtime capabilities 投影 `ready`、`degraded`、`disabled`，并输出脱敏的 source/capability/limit 信息。
- 未知或缺失角色 fail-closed 为普通用户；危险管理操作仅允许 `admin`/`owner`。
- Renderer 统一进入 `SkillsCenterWorkbench`；Legacy flag 不再驱动用户管理入口。
- 诊断接口和敏感字段脱敏由 P0 测试覆盖。

## SKL12-P0-003：HTTP DTO、错误、分页和幂等契约

- 成功 envelope：`data` + `meta.requestId`，分页写入 `meta.page`。
- 错误 envelope：`error.code`、可读 `message`、`details`、`retryable`、`requestId`。
- HTTP middleware 统一回传 `x-request-id`；缺失 request ID 时生成 UUID。
- revision 冲突使用 `REVISION_CONFLICT`；功能关闭使用 `FEATURE_DISABLED`；重试语义由 `retryable` 明确表达。
- 前端 API/store 使用 DTO 类型，不拼接未编码 ID；mutation 失败恢复 optimistic state。

## SKL12-P0-004：数据库盘点、备份和迁移决策

验证命令：

```powershell
npx tsx scripts/skills/p0-db-inventory.ts --database "C:\Users\xing\.bloomai\bloomai.db" --backup
```

完整 schema/row-count/foreign-key/orphan/migration/backup 快照：[p0-db-inventory.json](./p0-db-inventory.json)。

- 实际数据库：`C:\Users\xing\.bloomai\bloomai.db`
- 表数量：**54**
- 总行数（仅计数）：**4204**
- Foreign-key check：**True**；违规数：**0**
- Orphan checks：**51**；非零 orphan：**0**
- 已应用 migration：**43**；最新：`043-skill-security-audit-fields`
- 待执行 migration：**044-legacy-skill-migration-records**
- 备份：**True**；路径：`C:\Users\xing\.bloomai\bloomai.db.p0-backup-2026-08-07T22-50-44-870Z.bak`；SHA-256：`62fb134cc896c12bffe06ab44c04fd74eef80c17238dfeac4df7207183fabf56`
- 旧表删除：**禁止**；原因：`migration completion and explicit approval required`。

### Migration snapshot

已应用 migration：
- `001-skill-runtime-core`
- `002-skill-runtime-events`
- `003-skill-runtime-artifacts`
- `004-skill-capability-grants`
- `005-skill-capability-grant-state`
- `006-skill-run-commands`
- `007-article-illustration-jobs`
- `008-deep-research-core`
- `009-deep-research-recovery-commands`
- `010-deep-research-resilience`
- `011-deep-research-coverage-assessments`
- `012-deep-research-iteration-idempotency`
- `013-deep-research-attempt-lease-ownership`
- `014-deep-research-reconciliation`
- `015-deep-research-model-selection-snapshot`
- `016-deep-research-llm-runtime-usage`
- `017-deep-research-structured-model-traces`
- `018-deep-research-brief-question-section-mapping`
- `019-deep-research-query-intents-deduplication`
- `020-deep-research-source-quality-assessments`
- `021-deep-research-structured-evidence`
- `022-deep-research-section-drafts`
- `023-deep-research-semantic-citation-quality-gates`
- `024-scheduled-task-runs`
- `025-project-chat-workspaces`
- `026-disable-placeholder-tools`
- `027-tool-permissions-permanent-only`
- `028-tools-platform-b1`
- `029-tools-platform-b1-patch`
- `030-skill-runtime-queue-and-control-plane`
- `031-skill-version-drafts-and-snapshots`
- `032-skill-run-state-machine`
- `033-skill-run-event-protocol`
- `034-skill-run-execution-metrics`
- `035-skill-run-recovery`
- `036-skill-capability-grant-lifecycle`
- `037-skill-run-waiting-actions`
- `038-skill-artifact-retention-export`
- `039-skill-version-lifecycle`
- `040-skill-lifecycle-delete`
- `041-skill-artifact-policy`
- `042-image-studio-skill-links`
- `043-skill-security-audit-fields`

待执行 migration：
- `044-legacy-skill-migration-records`

### 表和行数快照

| Table | Rows |
|---|---:|
| `article_illustration_jobs` | 3 |
| `article_illustration_scenes` | 10 |
| `image_generations` | 58 |
| `image_sessions` | 16 |
| `llm_models` | 20 |
| `llm_providers` | 8 |
| `llm_video_tasks` | 0 |
| `messages` | 400 |
| `personas` | 5 |
| `projects` | 3 |
| `research_artifacts` | 45 |
| `research_citations` | 126 |
| `research_claims` | 143 |
| `research_coverage_assessments` | 16 |
| `research_events` | 1473 |
| `research_evidence` | 210 |
| `research_iterations` | 3 |
| `research_quality_assessments` | 8 |
| `research_questions` | 95 |
| `research_reconciliations` | 0 |
| `research_recovery_commands` | 26 |
| `research_report_section_questions` | 25 |
| `research_report_sections` | 69 |
| `research_run_attempts` | 31 |
| `research_run_checkpoints` | 139 |
| `research_runs` | 24 |
| `research_search_queries` | 93 |
| `research_source_assessments` | 0 |
| `research_source_snapshots` | 88 |
| `research_sources` | 186 |
| `scheduled_task_runs` | 2 |
| `schema_migrations` | 43 |
| `sessions` | 99 |
| `settings` | 21 |
| `skill_artifacts` | 0 |
| `skill_audit_events` | 0 |
| `skill_capability_grants` | 0 |
| `skill_drafts` | 0 |
| `skill_import_reviews` | 0 |
| `skill_installation_commands` | 0 |
| `skill_installations` | 0 |
| `skill_packages` | 0 |
| `skill_run_commands` | 0 |
| `skill_run_events` | 0 |
| `skill_run_queue` | 0 |
| `skill_runs` | 0 |
| `skill_runs_v2` | 0 |
| `skill_version_diffs` | 0 |
| `skill_version_snapshots` | 0 |
| `skill_versions` | 0 |
| `skills` | 8 |
| `tool_permissions` | 0 |
| `tool_runs` | 683 |
| `tools` | 25 |

当前数据库仍有 Legacy `skills`（8 行）和旧 `skill_runs`（0 行）表，且 `044-legacy-skill-migration-records` 尚未应用；因此 P0 明确禁止 DROP/删除旧表，迁移与回滚门槛由 P4/P5 继续处理。

## P0 测试证据

| 命令 | 结果 |
|---|---|
| `npm test -- --run src/server/skills/config/skill-runtime.p0.test.ts src/server/http/skills-policy.p0.test.ts src/server/http/skills-contract.p0.test.ts src/server/skills/p0-baseline-scan.test.ts src/server/db/skills-p0-inventory.test.ts` | **5 files / 10 tests passed** |
| `npm run test:architecture` | **已知基线失败：1 file failed / 6 passed / 15 个既有边界违规** |
| `npm test` | **full suite exit 1，唯一失败为上述既有 architecture boundary assertion；其余测试完成** |

Architecture failure 的违规集中在既有 `chat.ts`、`skill-creator.ts`、`skill-migration.ts`、`skill-package-runtime.ts`、`skill-runtime-observability.ts`、`skill-security.ts`、`skills.ts` 和 repository 文件；P0 不通过扩大 allowlist 隐藏它们，保留为后续架构治理项。

## Release verification evidence

Fresh verification performed after the P0 fixes:

| Command | Result |
|---|---|
| `npm run test:skills:release-gate` | **exit 0** — lint, skills typecheck, unit, integration, security, migration, e2e and migration smoke all passed |
| `npm run build` | **exit 0** — renderer, Electron main/preload and bundled server build completed |

The repository-wide `npm test` was also rerun. It exits 1 only at the pre-existing strict architecture boundary assertion (`src/server/architecture/dependency-boundaries.test.ts`): 6/7 architecture tests pass and the failure reports 15 existing production dependency violations. No allowlist expansion was made to hide that baseline.
## Evidence files

- `p0-baseline-scan.json`：完整 import/route/schema/test 引用与依赖图。
- `p0-db-inventory.json`：schema objects、tables、row counts、foreign keys、orphan checks、migration status、backup checksum 和 Legacy 删除决策。
