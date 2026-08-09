# SKL12-P2-003 Creator API 与后台设置 API 验收证据

Date: 2026-08-08
Branch: `feat/skills-admin-system`

## 范围

对应实施计划 `6.3 Phase P2` 的 `SKL12-P2-003`：Creator Draft CRUD、validate、preview、publish，以及 Runtime settings、feature flags、diagnostics 的读取和更新。

本任务不恢复 Legacy 管理入口、Legacy Runtime 或 Legacy 写入路径。Creator 写操作只使用可信请求头中的 actor/owner；请求 body 中的身份字段会被严格 DTO 拒绝。Runtime 设置 API 只暴露当前 Package Runtime 可配置字段，不暴露 Legacy 开关、Legacy 执行/只读字段或内部路径。

## 实现与验收矩阵

| 验收点 | 实现 | 证据 |
|---|---|---|
| Draft CRUD、owner 隔离和稳定分页 | Creator 路由与 `skillPackageRepo.listDrafts` 支持创建、读取、分页列表、更新、丢弃；查询按可信 owner 隔离并稳定排序。 | `src/server/http/routes/skill-creator.p2-003.test.ts`：alice 只能看到自己的 Draft，bob 看不到；分页返回 `meta.page.total`。 |
| revision CAS | Draft update/publish 使用 expectedRevision；过期 revision 返回 `REVISION_CONFLICT`。 | P2-003 专项测试和 `src/server/skills/creator/skill-draft.service.test.ts`。 |
| validate / preview | Draft 内容校验和未发布预览通过 HTTP 暴露，响应不改变发布关系。 | P2-003 专项测试验证 `valid=true`、`published=false`。 |
| 发布追踪关系 | publish 在一个数据库事务中创建 Package、Version、Snapshot、Installation，更新 Draft 的 published 状态和 published version，并写入审计。 | P2-003 专项测试验证四个资源 ID；`src/server/db/repositories/skill-package.repo.test.ts` 验证原子性和 owner/revision CAS。 |
| 发布幂等 | `046-skill-draft-publish-idempotency.sql` 持久化 idempotency key/result；相同 key 重试返回已有资源，不创建第二个 Package；不同 key 返回 `IDEMPOTENCY_CONFLICT`。 | P2-003 专项测试验证 retry、冲突和 Package 数量；repository 回归测试验证无 key 的旧调用仍返回 `REVISION_CONFLICT`。 |
| 可信身份和权限边界 | Creator 写操作要求可信 actor；body 中 `ownerId`/`actor` 伪造被拒绝。Runtime settings 更新、rollback、feature flags 更新要求 `runtime.manage`；普通 `/api/v1/settings` 不能修改 `skill_runtime.*`。 | P2-003 专项测试覆盖 `403 FORBIDDEN`、`400 VALIDATION_ERROR` 和普通 settings 拒绝。 |
| Runtime settings / feature flags | 新增 settings GET/PATCH、rollback、feature-flags GET/PATCH；更新前做字段白名单和完整配置校验，写入 DB override 后清理 Runtime config cache；rollback 删除允许的 override。 | P2-003 专项测试；`src/server/skills/config/skill-runtime.config.test.ts`、`src/server/services/settings.service.test.ts`。 |
| Runtime diagnostics | diagnostics 使用当前 Runtime 配置，返回安全的 configuration 摘要；配置关闭 execution/runtime 时反映 `degraded`，不暴露 Legacy/path 字段。 | P2-003 专项测试和 `src/server/http/routes/skill-runtime-observability.test.ts`。 |
| 审计与安全字段 | publish、settings update、rollback 写入 actor、requestId、security decision、policy version 和资源/变更 payload。 | P2-003 专项测试查询 `skill.runtime.settings.updated` 并校验 `actor=admin`、`securityDecision=allowed`、`policyVersion=skills-admin-v1.2`。 |
| Migration / schema contract | 新增 migration 046 和 `skill_drafts.publish_idempotency_key`、`publish_result_json` schema contract。迁移可重复执行。 | `migrations.test.ts` 与 `schema-contract.test.ts` 通过；迁移清单包含 46 个版本。 |

## 自动化验证

### P2-003 专项测试

```powershell
npm test -- --run src/server/http/routes/skill-creator.p2-003.test.ts
```

结果：`1 test file passed / 3 tests passed / exit code 0`。

覆盖：Draft owner 隔离、分页、revision CAS、validate、preview、发布追踪、发布幂等、不同 key 冲突、缺少可信 actor、Runtime settings 权限、safe-field 校验、feature flags、rollback、diagnostics degraded、audit，以及 Legacy/path 字段拒绝。

### P2-003 相关回归与迁移契约

```powershell
npm test -- --run `
  src/server/http/routes/skill-creator.test.ts `
  src/server/http/routes/settings.test.ts `
  src/server/http/routes/skill-runtime-observability.test.ts `
  src/server/skills/creator/skill-draft.service.test.ts `
  src/server/skills/config/skill-runtime.config.test.ts `
  src/server/db/repositories/skill-package.repo.test.ts `
  src/server/services/settings.service.test.ts `
  src/server/http/routes/skill-package-runtime.p2.test.ts `
  src/server/http/routes/skill-package-runtime.p2-002.test.ts `
  src/server/http/routes/skill-creator.p2-003.test.ts `
  src/server/db/migrations.test.ts `
  src/server/db/schema-contract.test.ts
```

结果：`12 test files passed / 72 tests passed / exit code 0`。

分项结果：

- `skill-creator.test.ts`: 1 test
- `settings.test.ts`: 2 tests
- `skill-runtime-observability.test.ts`: 3 tests
- `skill-draft.service.test.ts`: 9 tests
- `skill-runtime.config.test.ts`: 13 tests
- `skill-package.repo.test.ts`: 11 tests
- `settings.service.test.ts`: 4 tests
- `skill-package-runtime.p2.test.ts`: 4 tests
- `skill-package-runtime.p2-002.test.ts`: 3 tests
- `skill-creator.p2-003.test.ts`: 3 tests
- `migrations.test.ts`: 16 tests
- `schema-contract.test.ts`: 3 tests

### 类型与差异检查

```powershell
npm run typecheck:skills
git diff --check
```

结果：

- `npm run typecheck:skills`: exit code `0`，`tsc --noEmit -p tsconfig.skills.json` 通过；
- `git diff --check`: exit code `0`，未发现 whitespace error。

## 失败与修复记录

首次执行 migration/schema 回归时，已有 `migrations.test.ts` 仍期望 45 个 migration，实际新增 `046-skill-draft-publish-idempotency` 后为 46 个，因此出现 2 个断言失败。已将迁移数量和完整版本清单更新为 46，并重新执行同一命令，结果为 `2 test files passed / 19 tests passed / exit code 0`。

另一个 repository 回归暴露旧的无 idempotency key 直接重放调用被错误映射为 `IDEMPOTENCY_CONFLICT`；已在 `publishDraftTransaction` 区分“已持久化 key 的幂等冲突”和“旧调用的 revision conflict”，重新执行 repository 测试结果为 `1 test file passed / 11 tests passed / exit code 0`。

## 变更文件

- `scripts/migrations/046-skill-draft-publish-idempotency.sql`
- `src/server/db/migrations.test.ts`
- `src/server/db/repositories/settings.repo.ts`
- `src/server/db/repositories/skill-package.repo.ts`
- `src/server/db/schema-contract.ts`
- `src/server/db/schema.ts`
- `src/server/http/app.ts`
- `src/server/http/routes/skill-creator.p2-003.test.ts`
- `src/server/http/routes/skill-creator.ts`
- `src/server/http/routes/skill-runtime-observability.ts`
- `src/server/http/routes/skill-runtime-settings.ts`
- `src/server/http/skills-policy.ts`
- `src/server/services/skill-runtime-settings.service.ts`
- `src/server/skills/config/skill-runtime.config.ts`
- `src/server/skills/creator/skill-draft.schema.ts`
- `src/server/skills/creator/skill-draft.service.ts`
- `src/server/skills/observability/skill-runtime.diagnostics.ts`
- `docs/skills/evidence/p2-003-creator-settings-api.md`

## 工作区隔离

本任务只应提交上面的 P2-003 文件。用户已有的文档、HTML、图标资源、安装器范围文件和 `docs/MCP/2026-08-02-bloomai-mcp-client-implementation-plan.md` 改动不属于本任务，必须保持未暂存、未提交。

## 回滚

回滚本任务提交会移除 Creator/Runtime settings API、publish 幂等字段和 diagnostics settings 接线，同时恢复 migration 清单和 schema contract 到前一版本；不会删除用户已有文档或资源改动。
