# SKL12-P1-003 验收证据：Catalog、Version、Update 和删除语义

- 任务：`SKL12-P1-003`
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-07
- 验收状态：PASS

## 实现范围

- `src/server/db/repositories/skill-package.repo.ts`
  - Catalog 默认只返回未归档 Package，并对 `total` 使用相同过滤条件。
  - 增加 `includeArchived` 选项；详情和历史查询仍可读取归档 Package。
  - Catalog 使用 `updated_at DESC, id ASC` 稳定排序。
  - 软删除保留 Package、Version、Run 和 Audit 引用，不执行物理删除。
- `src/server/skills/application/skill-version.service.ts`
  - Update preview 规范化 candidate，保留 Manifest、source snapshot、security status/findings。
  - Preview 返回 Manifest/Capability/source SHA/source commit/security diff 和风险 warning。
  - archived Package 的 preview/update 返回 `CONFLICT`。
  - Update 使用 preview 后的规范化 candidate 创建不可变 Version；重复 immutable content 返回既有 Version，不自动切换当前 Version。
- `src/server/skills/application/skill-version.diff.ts`
  - 增加 source commit、security status/findings 差异及风险等级/warning。
  - 敏感 Manifest 字段仍只输出 `[redacted]`。
- `src/server/http/routes/skill-package-runtime.ts`
  - Version candidate DTO 接受 `securityFindings` JSON object。

## 验收命令与结果

### P1-003 聚焦测试

```text
npm test -- --run src/server/skills/application/skill-version.diff.test.ts src/server/skills/application/skill-version.service.test.ts src/server/db/repositories/skill-package.repo.test.ts
```

结果：`3 files passed / 17 tests passed`。

### P1-003 回归测试

```text
npm test -- --run src/server/skills/application/skill-version.service.test.ts src/server/skills/application/skill-version.diff.test.ts src/server/skills/application/skill-lifecycle.service.test.ts src/server/db/repositories/skill-package.repo.test.ts src/server/services/skill-package-runtime.service.test.ts src/server/http/routes/skill-package-runtime.test.ts
```

结果：`6 files passed / 46 tests passed`。

### 类型与差异检查

```text
npm run typecheck:skills
```

结果：退出码 `0`。

```text
git diff --check
```

结果：退出码 `0`；仅有 Git 的 LF/CRLF 提示，无 whitespace error。

## 验收覆盖

| 契约 | 证据 |
|---|---|
| Catalog 默认隐藏 archived Package，分页总数一致 | `skill-package.repo.test.ts`：软删除后默认列表只包含 active Package；详情仍可读取 `deleted_at/delete_reason` |
| Version immutable/duplicate | `skill-version.service.test.ts`：immutable content 去重，重复更新不创建新 Version、不切换 current pointer |
| Preview 展示 Manifest、Capability、source provenance 与 security 风险变化 | `skill-version.diff.test.ts`、`skill-version.service.test.ts`：覆盖 manifest/file/capability、source SHA/commit、security status/findings、风险 warning |
| Update 不自动切换当前 Version | `skill-version.service.test.ts`：更新结果保留原 `currentVersionId`，未调用 `switchCurrentVersion` |
| archived Package 禁止更新 | `skill-version.service.test.ts`：preview/update 均返回 `CONFLICT` |
| 软删除不破坏历史引用 | `skill-package.repo.test.ts`：Version、Run、Audit 记录仍存在；不存在 hard delete |
| 当前运行/安装约束仍生效 | `skill-lifecycle.service.test.ts`、`skill-package-runtime.service.test.ts`、HTTP 回归测试 |
| Import Review 的无风险 inspect 状态与实现一致 | `skill-package-runtime.test.ts`：无 warning inspect 返回 `validated`，warning/review 流程仍单独覆盖 |

## 结论

PASS：P1-003 的 Catalog、Version history/Diff、Update preview/update、immutable version 和可审计软删除语义已实现并通过测试、类型检查和差异检查。该任务可独立提交。
