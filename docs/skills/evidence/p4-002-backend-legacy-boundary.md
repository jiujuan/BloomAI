# SKL12-P4-002 验收证据：后端 Legacy 入口隔离

- **任务：** `SKL12-P4-002` 删除或隔离后端 Legacy 入口
- **分支：** `feat/skills-admin-system`
- **执行日期：** 2026-08-08
- **范围：** 应用 HTTP 注册、Repository 依赖边界、Legacy 运行时引用和 Package Runtime 回归

## 实现结果

1. `src/server/http/app.ts` 不再导入或注册 `routes/skills.ts` 和 `routes/skill-migration.ts`。
2. Legacy 用户路径不再作为应用功能暴露；应用对旧 market、install、create、run、migration inspect/preview/history 路径返回 `404`。
3. `src/server/db/repositories/skill.repo.ts` 删除过时的 `skillRepo` 默认兼容别名，仅保留显式命名的 `legacySkillRepo` 归档 Repository。
4. Legacy adapter、Legacy service 和测试依赖全部改为显式注入 `legacySkillRepo`/`legacyRepo`，阻止 Package Runtime 重新依赖默认 Legacy 别名。
5. 新增 `src/server/http/p4-002-legacy-boundary.test.ts`，覆盖应用源码注册边界、旧 HTTP 路径 `404` 和 Package Runtime capabilities `200`。
6. 迁移脚本暂时只完成 Repository 名称边界接线；迁移验证从用户 HTTP 路由中进一步隔离为一次性离线工具属于 `SKL12-P4-003`。

## 验收命令与结果

### 编译和打包

```text
npx tsc --noEmit
通过（exit 0）

npm run build
通过（exit 0）
```

### P4-002 专项边界测试

```text
npx vitest run src/server/http/p4-002-legacy-boundary.test.ts --pool=forks --maxWorkers=1 --minWorkers=1

Test Files: 1 passed
Tests:      3 passed
```

专项输出证明：

```text
GET  /api/v1/skills/market                         404
POST /api/v1/skills/install                        404
POST /api/v1/skills                              404
POST /api/v1/skills/legacy-1/run                  404
POST /api/v1/skills/legacy-1/migration/inspect    404
POST /api/v1/skills/legacy-1/migration/preview    404
GET  /api/v1/skills/legacy-1/migration-history     404
GET  /api/v1/skill-runtime/capabilities           200
```

### Package Runtime 和依赖边界回归

```text
npx vitest run src/server/http/routes/skill-package-runtime.test.ts --pool=forks --maxWorkers=1 --minWorkers=1

Test Files: 1 passed
Tests:      18 passed

npx vitest run \
  src/server/db/repositories/skill-repo.boundary.test.ts \
  src/server/services/skill.service.test.ts \
  src/server/http/routes/chat-skill-runtime.test.ts \
  src/server/skills/legacy-regression.test.ts \
  src/server/skills/legacy/compatibility.test.ts \
  --pool=forks --maxWorkers=1 --minWorkers=1

以上 5 个回归文件通过（15 tests passed）。与 P4-002 boundary test（3 tests）和 Package Runtime test（18 tests）合计为 36 个通过测试。
```

### 静态边界检查

```text
rg -n "routes/skills|skillsRoutes|routes/skill-migration|skillMigrationRoutes" src/server/http/app.ts
无匹配

rg -n "export const skillRepo\\b|\\bskillRepo\\b" src/server/db/repositories/skill.repo.ts src/server/services src/server/skills src/server/http/app.ts
生产代码无 `skillRepo` 默认别名匹配；仅专项测试中的负向断言保留该字符串。

git diff --check
通过（仅有 Git 的 LF/CRLF 提示，无 whitespace error）
```

## 已知的后续清理项

`src/server/http/routes/skill-migration.test.ts` 仍是旧 Legacy HTTP 路由测试；由于 P4-002 已取消应用注册，该测试当前按旧契约失败。它不是 P4-002 的生产入口回归，而是 `SKL12-P4-004` 要删除或改造成一次性离线迁移验证的测试/文档清理对象。`tests/integration/skill-runtime/legacy-migration.integration.test.ts` 和 `scripts/verify-legacy-skills-migration.ts` 同样在 P4-003/P4-004 中完成离线化，不恢复旧用户路由。