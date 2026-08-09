# SKL12-P4-003 验收证据：Legacy 数据迁移、归档和旧表门禁

- **任务：** `SKL12-P4-003` Legacy 数据迁移、归档和旧表处理
- **分支：** `feat/skills-admin-system`
- **执行日期：** 2026-08-08
- **实现 commit：** 本文件与实现一起提交；提交后以 `git show -s --format=%H HEAD` 作为本任务专用 commit SHA
- **目标：** 一次性、离线、只读 Legacy 迁移验证；不恢复 Legacy 用户 HTTP 功能，不自动删除旧表

## 实现文件

- `scripts/migrations/047-legacy-migration-archive-and-gates.sql`
- `src/server/db/schema.ts`
- `src/server/db/repositories/legacy-migration.repo.ts`
- `src/server/skills/migration/legacy-data-migration.ts`
- `src/server/skills/migration/legacy-data-migration.test.ts`
- `src/server/db/p4-003-legacy-migration.test.ts`
- `src/server/db/migrations.test.ts`
- `scripts/verify-legacy-skills-migration.ts`

## 数据库和迁移结果

迁移版本：`047-legacy-migration-archive-and-gates`

新增持久化表：

- `skill_legacy_archives`：Legacy source 的只读归档，按 `archive_key` 幂等，保存 source SHA-256、脱敏 payload 和 redaction metadata。
- `skill_legacy_migration_runs`：保存可恢复迁移 run 的 phase/status、backup manifest、source/target counts、reconciliation、manual review、gate、rollback 和错误信息。

迁移脚本只创建归档和门禁结构，**不执行 `DROP TABLE skills` 或 `DROP TABLE skill_runs`**。旧表清理只能由后续显式 release gate 执行。

## 离线验收证据

命令：

```text
npm run verify:legacy-skills-migration
```

结果：exit 0；脚本没有导入应用 Hono app，也没有调用 Legacy HTTP route；`globalThis.fetch` 被强制设置为失败函数，验证过程中外部网络调用为 0。

关键输出：

```json
{
  "mode": "offline-one-time-read-only-migration-verification",
  "migrationRunId": "offline-p4-003-9ba81072-b4f3-40c6-a6a4-d431e73912a0",
  "migrationVersion": "047-legacy-migration-archive-and-gates",
  "backup": {
    "manifestPath": "C:\\Users\\xing\\AppData\\Local\\Temp\\bloomai-legacy-migration-backups\\1786206721336-legacy-skills-migration-Vx01mL\\backup-manifest.json",
    "sha256": "d949cb2a87ab3fc941e49575e0c9f6eca7e1aa0efca1cde2b725aefa46621b64",
    "retained": true
  },
  "sourceCounts": { "skills": 4, "runs": 2 },
  "targetCountsBefore": {
    "packages": 0,
    "versions": 0,
    "installations": 0,
    "runs": 0,
    "artifacts": 0
  },
  "targetCountsAfter": {
    "packages": 1,
    "versions": 1,
    "installations": 1,
    "runs": 0,
    "artifacts": 0
  },
  "delta": {
    "packages": 1,
    "versions": 1,
    "installations": 1,
    "runs": 0,
    "artifacts": 0
  },
  "expectedTargetDelta": {
    "packages": 1,
    "versions": 1,
    "installations": 1,
    "runs": 0,
    "artifacts": 0
  },
  "archivedCounts": { "skills": 4, "runs": 2 },
  "manualReviewCount": 3,
  "gate": {
    "allowed": false,
    "reason": "3 Legacy record(s) still require manual review",
    "dropOldTables": false
  },
  "rollback": {
    "rehearsalPassed": true,
    "rollbackPerformed": false,
    "rollbackError": null
  },
  "legacyWritesDisabled": true,
  "externalNetworkCalls": 0,
  "secretLeak": false
}
```

解释：正常迁移路径 `rollbackPerformed: false`；失败演练路径已执行 rollback callback，并以 `rollback.rehearsalPassed: true` 证明恢复逻辑可用。`manualReviewCount: 3` 使 migration gate 保持关闭，因而 `dropOldTables: false` 是预期的安全结果。

## 数据转换和边界结果

- `prompt-template`：自动转换为 Package/Version/Installation。
- `http-api`：保持 `manual_review`，不自动执行外部请求。
- `js-function`：标记为 critical blocked。
- 未知类型：标记为 blocked。
- Legacy skills 和 skill runs：均写入只读归档；归档写入按 key 幂等，归档后的 payload 不允许更新。
- Backup manifest：写入系统临时目录并保留 SHA-256；敏感值在 manifest 中脱敏。
- Package Runtime：验证 target tables 为 `skill_packages`、`skill_versions`、`skill_installations`、`skill_runs_v2`、`skill_artifacts`，不把 Legacy 表当作运行时目标。

## 测试、类型和构建

```text
npx vitest run src/server/skills/migration/legacy-data-migration.test.ts src/server/db/p4-003-legacy-migration.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
通过：2 files passed，5 tests passed

npx vitest run src/server/db/schema-contract.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
通过：1 file passed，3 tests passed；包含 047 migration

npx vitest run src/server/db/migrations.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
通过：1 file passed，16 tests passed；迁移列表已包含 047，CLI 重复执行保持幂等

npx tsc --noEmit
通过：exit 0

npm run build
通过：exit 0；Renderer、Electron main/preload 和 server bundle 均生成

git diff --check
通过：无 whitespace error
```

## 安全和回滚结论

1. 迁移验证脚本为 offline、one-time、read-only 工具，不是用户可调用的应用功能。
2. Legacy HTTP route 没有被重新注册；本任务不恢复旧管理入口。
3. 在 manual review、orphan mapping、digest mismatch 或 artifact ownership mismatch 未清零时，旧表 drop gate 保持关闭。
4. 迁移 run 支持 `expectedUpdatedAt` CAS 更新，防止旧状态覆盖新状态；失败可记录 `failed`、错误和 rollback snapshot，之后可恢复/重试。
5. 归档 payload 强制 `read_only = 1`，source identity 冲突和空门禁字段会被拒绝。

**验收结论：** `SKL12-P4-003` 已完成。迁移前后计数、归档、manual review、失败恢复、脱敏和旧表删除门禁均有专项实现与测试证据；在人工复核未完成前不会删除 Legacy 旧表。
