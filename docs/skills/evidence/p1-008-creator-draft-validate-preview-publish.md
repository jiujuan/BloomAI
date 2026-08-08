# SKL12-P1-008 Creator Draft、Validate、Preview 和 Publish 验收证据

- 任务：`SKL12-P1-008`
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-08
- 范围：Creator Draft 的 Package Runtime 边界、canonical manifest Validate、无副作用 Preview、revision CAS Publish、不可变版本和可选启用安装。

## Red 阶段

先运行：

```powershell
npm test -- --run src/server/skills/creator/skill-draft.service.test.ts
```

初始结果：9 个测试中 4 个通过、5 个失败（exit code 1）。失败覆盖：

- Draft 未规范化为 `runtimeKind: package`，Legacy Runtime 声明未被拒绝；
- `enable: true` 未贯穿到安装状态；
- Publish 未使用 Draft revision CAS transaction；
- 重复 Publish 存在产生第二个版本/孤儿记录的风险。

同时加入 SQLite repository 的 atomic publish Red 测试，覆盖 revision 冲突 rollback、Draft 状态更新、`enable` 映射和重复 publish 防护。

## Green 实现

### Package Runtime 和 Legacy 边界

- `skillDraftContentSchema` 将 Creator Draft 的 `runtimeKind` 固定为 `package`，缺省值自动规范化为 `package`。
- 显式 `runtimeKind: legacy` 和 schema 外的 `runtime: legacy` 均拒绝。
- `SKILL.md` frontmatter 中的非 `instruction-agent` runtime 会进入 error/security findings，Publish 被阻止。
- Creator 生成的 `manifest.json` 固定使用 `runtime: instruction-agent`；references 不能覆盖 `SKILL.md` 或 `manifest.json`。

### Validate 和 Preview

- Validate 通过 canonical `resolveManifest` 处理 Markdown/frontmatter。
- `errors` 和 `warnings` 保持分离；不支持的 capability/runtime 作为 error 和 security finding。
- Preview 只计算 revision、manifest、文件列表和警告/错误，不调用 Publish transaction，不创建 package/version/snapshot/installation。
- Draft owner 校验覆盖 Get、Preview 和 Discard。

### Publish、CAS 和 atomic rollback

- Publish 使用 `publishDraftTransaction`，将 Package、Version、Snapshot、Installation 和 Draft 状态更新放入同一数据库 transaction。
- transaction 以 `ownerId + status=draft + expectedRevision` 做 CAS；冲突时整体 rollback。
- 版本保存 manifest hash、immutable hash、snapshot hash 和 source snapshot，生成后不可修改。
- `enable: true/false` 分别映射为安装记录 `enabled=1/0`。
- 已发布 Draft 只读；重复 Publish 不创建第二个 Package/Version/Installation。
- 文件物化失败或 transaction 失败时清理本次新建的 package snapshot 目录。

## 自动化测试证据

命令：

```powershell
npm test -- --run src/server/skills/creator/skill-draft.service.test.ts
```

结果：1 个测试文件，9/9 tests passed。

命令：

```powershell
npm test -- --run src/server/db/repositories/skill-package.repo.test.ts
```

结果：1 个测试文件，11/11 tests passed；包含 SQLite atomic publish/CAS/rollback 测试。

命令：

```powershell
npm test -- --run src/server/skills/creator/skill-draft.service.test.ts src/server/http/routes/skill-creator.test.ts src/server/db/repositories/skill-package.repo.test.ts src/server/skills/application/repository-contract.test.ts
```

结果：4 个测试文件，37/37 tests passed。

命令：

```powershell
npm run typecheck:skills
git diff --check
```

结果：TypeScript skills project typecheck 通过；`git diff --check` 通过。

## 变更文件

- `src/server/skills/creator/skill-draft.schema.ts`
- `src/server/skills/creator/skill-draft.service.ts`
- `src/server/skills/creator/skill-draft.service.test.ts`
- `src/server/db/repositories/skill-package.repo.ts`
- `src/server/db/repositories/skill-package.repo.test.ts`

## 验收结论

`SKL12-P1-008` 验收通过：Creator 仅允许 Package Runtime；Validate 能区分 error/warning；Preview 无持久化和安装副作用；Publish 具备 revision CAS、atomic rollback、immutable version、可选启用安装及重复发布保护。
