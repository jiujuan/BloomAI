# SKL12-P3-005 导入 Skill 页面验收证据

- 任务：`SKL12-P3-005 导入 Skill 页面`
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-08

## 实现范围

- `PackageInstallDialog` 改为三阶段导入流程：选择来源、解析和扫描、确认安装。
- 支持 GitHub、本地目录、ZIP，以及已经生成的 npx 产物；Renderer 不直接执行任意 npx。
- 对 source URL/path/package name、subdirectory 和 GitHub ref 做校验，并将 npx 产物映射到受控的本地目录或 ZIP source。
- inspect 返回 `reviewId`、`sourceFingerprint`、packages、manifest、Capability、source snapshot 和诊断信息；所有 snake_case DTO 在 API Client 中转换为 renderer camelCase 类型。
- 接线 Import Review 查询、approve/reject 和安装长任务；安装请求必须带 `reviewId`、`sourceFingerprint`、`confirm: true`。
- `rejected`、`warning` 或未审批 review 均不能安装；审批和安装状态使用语义色、图标和明确下一步说明。
- 安装成功后通过审计上下文保留 review/source fingerprint，并在存在 package id 时打开 Package Detail，否则返回 Skills Center。

## TDD 与专项测试

先运行新增失败测试，初始结果为：4 个测试中 4 个失败，失败点覆盖 source 映射和拒绝状态文案；修复后通过。

```powershell
npx vitest run src/renderer/pages/Skills/PackageInstallDialog.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

结果：1 个测试文件通过，4 个测试通过。

```powershell
npx vitest run src/renderer/pages/Skills/skill-runtime.api.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

结果：1 个测试文件通过，7 个测试通过；覆盖 inspect object DTO、snake_case 转换、review GET、approve、reject 和动态 ID 编码。

```powershell
npx vitest run src/renderer/pages/Skills --pool=forks --maxWorkers=1 --minWorkers=1
```

结果：10 个 Renderer Skills 测试文件通过，51 个测试通过。

```powershell
npx tsc --noEmit
```

结果：通过（exit code 0）。

```powershell
git diff --check
```

结果：通过，无 whitespace error。

## 关键验收结论

- 导入过程分阶段显示，inspect/review/install 的边界清晰。
- 警告包含原因、风险和下一步；Rejected 明确禁止安装。
- 安装请求绑定 review 和 source fingerprint，审计上下文不会丢失。
- 与现有 Skills Center 的 Package Detail / Skills Center 跳转已接线。

## 变更文件

- `src/renderer/api/index.ts`
- `src/renderer/pages/Skills/PackageInstallDialog.tsx`
- `src/renderer/pages/Skills/PackageInstallDialog.test.tsx`
- `src/renderer/pages/Skills/SkillsCenterWorkbench.tsx`
- `src/renderer/pages/Skills/skill-runtime.api.test.ts`
- `src/renderer/pages/Skills/skill-runtime.store.ts`
- `src/renderer/pages/Skills/skill-runtime.types.ts`
