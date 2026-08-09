# SKL12-P1-007 验收证据：Artifact Store 和导出生命周期

- **Task ID:** `SKL12-P1-007`
- **分支:** `feat/skills-admin-system`
- **验收日期:** 2026-08-08
- **验收状态:** **PASS**
- **提交:** `feat(skills): complete artifact store and export lifecycle`

## Red 阶段证据

先增加 Artifact 生命周期回归测试，再运行实现，测试按预期暴露缺口：

```powershell
npm test -- --run src/server/skills/artifacts/artifact-store.test.ts
```

初始结果：`12 tests / 10 passed / 2 failed`。失败覆盖：

- Artifact 没有可验证的 `status`、`skillVersionId` 生命周期绑定；
- `processing` Artifact 仍可被读取/导出；
- 内容文件缺失时不会标记为 `orphaned`。

## Green 阶段验证

P1-007 聚焦回归测试：

```powershell
npm test -- --run `
  src/server/skills/artifacts/artifact-store.test.ts `
  src/server/skills/artifacts/artifact-security.test.ts `
  src/server/db/migrations.test.ts `
  src/server/skills/application/repository-contract.test.ts `
  src/server/db/repositories/skill-package.repo.test.ts
```

结果：`5 files passed / 58 tests passed / exit code 0`。

类型和差异检查：

```powershell
npm run typecheck:skills
git diff --check
```

结果：`typecheck exit code 0`；`git diff --check exit code 0`。

## 验收覆盖

| 计划验收条目 | 证据 |
|---|---|
| Artifact 绑定 Run/Version | `ArtifactStore.writeBuffer` 从 Run 取得 `skillVersionId`，Repository 持久化 `skill_version_id`；测试验证 ready Artifact 的 Run/Version lineage。 |
| 类型、大小、checksum 和路径安全 | 既有 `artifact-policy` 校验文件名、类型和大小；`readArtifactBytes` 校验常规文件、大小、SHA-256、MIME；artifact security tests 覆盖路径逃逸、symlink 和篡改。 |
| processing / ready / orphaned | 写入先创建 `processing`，校验文件后更新 `ready`；失败和缺失/损坏内容标记 `orphaned`；测试覆盖 processing 禁止读/导出和缺失文件识别。 |
| ownership 校验 | `readContent` 与 `exportArtifact` 均先执行 Run ownership 校验；跨 Run 读取/导出测试通过。 |
| 显式确认、受控目录和审计 reason | 导出要求 `confirmed === true`、非空 `auditReason`；`resolveExportDestination` 限制受控目录；导出写入审计事件并防止目标冲突。 |
| 文件缺失、损坏、孤儿可识别 | 列表读取和内容读取检测缺失/损坏，持久化更新为 `orphaned` 并返回明确错误；孤儿/processing 不生成内容预览或导出文件。 |

## 变更范围

- `src/server/skills/application/ports.ts`
- `src/server/skills/application/test-doubles.ts`
- `src/server/db/schema.ts`
- `src/server/db/schema-contract.ts`
- `src/server/db/repositories/skill-package.repo.ts`
- `src/server/db/migrations.test.ts`
- `src/server/skills/artifacts/artifact-store.ts`
- `src/server/skills/artifacts/artifact-store.test.ts`
- `scripts/migrations/045-skill-artifact-status.sql`
- `docs/skills/evidence/p1-007-artifact-store-export-lifecycle.md`

## 已知限制

- 文件内容读取仍由受控 Artifact root 下的本地文件系统完成；数据库状态与文件完整性通过 size/SHA-256 校验保持一致。
- 数据库 Artifact Repository 对旧字段保留兼容别名，新的 status 与 `skill_version_id` 通过迁移补齐。