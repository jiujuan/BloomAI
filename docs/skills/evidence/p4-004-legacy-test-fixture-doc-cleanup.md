# SKL12-P4-004 验收证据：清理 Legacy 测试、fixture 和文档引用

- **任务：** `SKL12-P4-004` 清理 Legacy 测试、fixture 和文档引用
- **分支：** `feat/skills-admin-system`
- **执行日期：** 2026-08-08（Asia/Shanghai）
- **运行环境：** Windows 11 build 26200；Node `v24.15.0`；npm `11.8.0`
- **实现 commit：** 本文件与实现一起提交；提交后使用 `git show -s --format=%H HEAD` 记录本任务 commit SHA
- **目标：** 生产功能测试不再依赖 Legacy 管理 fixture；迁移验证保留为一次性、离线、只读开发/发布工具；用户文档不再宣称 Legacy 管理功能受支持

## 变更范围

### 删除的 Legacy 管理测试和 fixture

以下路径已删除，不再作为应用功能或生产功能测试入口：

- `tests/e2e/skills/legacy-skills-migration.browser.test.ts`
- `tests/e2e/skills/fixtures/legacy-skills.json`
- `tests/e2e/skills/fixtures/package-manifest.json`
- `src/server/http/routes/skill-migration.test.ts`

删除后 `tests/e2e/skills` 只保留 Package Runtime 浏览器验收；不再加载 Legacy skill manifest 或旧 package manifest fixture。

### 保留并隔离的离线迁移验证

原测试已改为明确的离线迁移验证命名和边界：

- `tests/integration/skill-runtime/legacy-migration.offline-read-only.integration.test.ts`
- `tests/security/legacy-migration.offline-read-only.security.test.ts`
- `scripts/verify-legacy-skills-migration.ts`

测试不再导入 Hono 应用或调用 Legacy HTTP route；覆盖脱敏、归档、可迁移/人工复核判定、rollback rehearsal、旧表 drop gate、无网络调用和禁止执行 Legacy source 等约束。

### Package scripts 和文档

新增/调整脚本：

- `npm run verify:skills-legacy-migration-offline`：明确表示一次性、离线、只读迁移验证
- `npm run test:skills:migration:offline`：运行 Skills 类型检查和离线迁移验证
- `npm run test:skills:migration:smoke`：切换到新的 offline 验证脚本
- `npm run verify:legacy-skills-migration`：保留为兼容 alias，不改变离线、只读边界

`README.md` 和 `docs/skills/evidence/README.md` 已更新：Skills Admin 仅面向 Package Runtime；Legacy 不再作为用户可管理的市场、安装或运行功能；迁移验证仅限开发/发布流程。

## 验收命令和结果

### 1. 先修正并验证 Package Runtime 安全边界回归

```text
npx vitest run tests/integration/skill-runtime/skill-runtime.integration.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

结果：exit 0；1 file passed；2 tests passed。

集成测试现在明确验证：

1. `install` 后的版本处于 `awaiting_permission_review`，未完成安全/权限审核时 Run 返回 `404 NOT_FOUND`；
2. 只有 `securityStatus=verified` 且 installation 为 `installed/enabled` 的 reviewed fixture 才能进入 Run → queue → worker → Artifact → export 主链；
3. Artifact export 使用 `x-bloom-actor`，覆盖 ownership/audit 授权契约，而不是放宽生产路由。

### 2. Package Runtime 集成测试

```text
npm run test:skills:integration
```

结果：exit 0；5 files passed；27 tests passed。

### 3. 安全测试

```text
npm run test:skills:security
```

结果：exit 0；2 files passed；35 tests passed（其中离线迁移安全边界 25 tests）。

### 4. Skills E2E 测试

```text
npm run test:skills:e2e
```

结果：exit 0；1 file passed；1 test passed。测试只运行 `tests/e2e/skills/skill-runtime.browser.test.ts`，不再加载 Legacy fixture 或旧 Legacy migration browser test。

### 5. 离线迁移验证

```text
npm run test:skills:migration:offline
```

结果：exit 0；`typecheck:skills` 通过；离线迁移 verifier 通过，关键脱敏摘要如下：

```json
{
  "mode": "offline-one-time-read-only-migration-verification",
  "migrationVersion": "047-legacy-migration-archive-and-gates",
  "sourceCounts": { "skills": 4, "runs": 2 },
  "targetCountsAfter": {
    "packages": 1,
    "versions": 1,
    "installations": 1,
    "runs": 0,
    "artifacts": 0
  },
  "manualReviewCount": 3,
  "gate": { "allowed": false, "dropOldTables": false },
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

### 6. 全量类型检查、构建和 whitespace 检查

```text
npx tsc --noEmit
npm run build
git diff --check
```

结果：

- `npx tsc --noEmit`：exit 0；
- `npm run build`：exit 0；Renderer、Electron main/preload 和 server bundle 均构建成功；仅保留既有 chunk size warning；
- `git diff --check`：无 whitespace error；Git 仅提示离线迁移测试文件的工作区 LF/CRLF 转换提示，不是 whitespace failure。

### 7. Legacy 路径和引用扫描

扫描范围：`src/`、`tests/`、`scripts/`、`README.md`、`docs/skills/evidence/README.md`；排除实施计划和本任务证据中的历史路径说明。

```text
legacy-skills.json
package-manifest.json
legacy-skills-migration.browser.test
legacy-migration.integration.test
legacy-skill-migration.security.test
src/server/http/routes/skill-migration.test
Legacy Skill migration HTTP routes
```

结果：上述 stale reference 在生产源码、测试、脚本、README 和证据索引中均为 0；旧文件路径全部不存在。保留的迁移测试路径仅为：

- `tests/integration/skill-runtime/legacy-migration.offline-read-only.integration.test.ts`
- `tests/security/legacy-migration.offline-read-only.security.test.ts`

## 验收结论

`SKL12-P4-004` 已完成：

- Legacy 管理 browser test、旧管理 fixture 和 Legacy HTTP route test 已删除；
- 尚未结束的数据迁移验证已明确隔离为一次性、离线、只读流程；
- Package Runtime 生产集成/E2E/security 测试不依赖 Legacy fixture；
- README 和证据索引明确 Legacy 管理不再受支持；
- 未放宽 Package Runtime 的安全/ownership 边界；
- 专项测试、集成测试、安全测试、E2E、离线 migration verifier、类型检查、构建和静态扫描均通过。

## 风险和回滚

- **风险：** 仍需处理的历史 Legacy 数据只能通过离线 verifier/迁移工具验证；这不是用户可调用的 HTTP 功能，manual review 未清零时旧表 drop gate 保持关闭。
- **回滚：** 若需要回滚本任务，可恢复本任务删除的测试/fixture、撤销 package script/README/证据索引变更，并保留 P4-003 的迁移门禁实现；不会自动恢复 Legacy 用户路由或 Renderer 管理入口。
- **工作区边界：** 提交时仅显式暂存本任务文件；其他已有用户修改和未跟踪文档不纳入本 commit。
