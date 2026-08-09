# SKL12-P1-001 验收证据：Package/Version Repository 与领域 Facade

## 任务契约

- Package Runtime 的 Catalog 查询只经过 `PackageSkillRepository` / SQLite Package adapter。
- Legacy `skillRepo` 仅保留为冻结的兼容包装，不再与 `legacySkillRepo` 共享可变对象。
- Package-only domain facade 不导入、不暴露 Legacy Repository 或 Legacy mutation surface。

## 实现

- 新增 `src/server/skills/application/package-runtime.catalog.ts`。
- 默认依赖 `createSqlitePackageRepository()`，在 adapter 中完成 Drizzle row 到领域 snapshot 的转换。
- `src/server/db/repositories/skill.repo.ts` 将 `skillRepo` 改为冻结兼容包装，并标记为 deprecated。
- 扩展 `skill-repo.boundary.test.ts` 与新增 `package-runtime.catalog.test.ts`，覆盖 repository-only 查询和 Legacy 边界。

## 验收命令与结果

```text
npm test -- --run src/server/skills/application/package-runtime.catalog.test.ts src/server/db/repositories/skill-repo.boundary.test.ts src/server/skills/application/skills-facade.service.test.ts src/server/skills/application/repository-contract.test.ts src/server/db/repositories/skill-package.repo.test.ts
5 files passed / 30 tests passed

npm run typecheck:skills
exit 0
```

## 结论

PASS：Package/Version/Installation 查询不会通过 Legacy Repository；Legacy 兼容别名已限制为冻结包装；Package-only facade 无 Legacy 依赖。

证据生成时的提交父版本和最终 commit SHA 由 Git 交付记录确认。
