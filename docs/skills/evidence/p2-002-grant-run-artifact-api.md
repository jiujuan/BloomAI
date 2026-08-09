# SKL12-P2-002 Grant/Run/Artifact API 验收证据

## 范围

对应实施计划 `6.3 Phase P2` 的 `SKL12-P2-002`：Grant 操作、Run 创建/列表/detail/next-action/events/SSE/commands/cancel，以及 Artifact 列表/content/export。

本任务不恢复 Legacy 管理入口、Legacy Runtime 或 Legacy 写入路径；身份以可信请求头为准，拒绝 body 身份字段伪造。

## 修改文件

- `src/server/http/routes/skill-package-runtime.ts`
- `src/server/http/routes/skill-package-runtime.test.ts`
- `src/server/http/routes/skill-package-runtime.p2-002.test.ts`
- `src/server/services/skill-package-runtime.service.ts`
- `src/server/services/skill-package-runtime.service.test.ts`
- `src/server/skills/application/capability-grant.service.ts`
- `src/server/skills/artifacts/artifact-store.ts`

## TDD 红阶段证据

新增专项测试后，先在未完成实现的状态执行：

```text
npm test -- --run src/server/http/routes/skill-package-runtime.p2-002.test.ts
```

初始结果为 3 项失败，分别暴露：

1. Grant 操作接受 body 中伪造的 `actor`；
2. Run 创建未写入 `skill.run.created` 审计；
3. Artifact export 接受 body 中伪造的 `actor`。

随后按最小改动实现生产代码并重新执行专项测试。

## 专项验收

```text
npm test -- --run src/server/http/routes/skill-package-runtime.p2-002.test.ts
```

结果：`1 passed`, `3 tests passed`。

专项测试覆盖：

- Grant approve/reject/revoke 仅使用 `x-bloom-actor`，body `actor` 被严格 DTO 拒绝；
- Grant 审计包含 actor、requestId、`securityDecision=allowed`、`policyVersion=skills-admin-v1.2`；
- Run create/command/cancel 审计；
- Run event history 与 SSE 使用同一 seq/type/payload 顺序；
- cancel 幂等和 stale revision 的 `REVISION_CONFLICT`；
- Artifact ownership；
- export confirmation；
- export 目标路径控制；
- 普通用户禁止 export；
- Artifact export 审计；
- Legacy execution 继续被既有 HTTP 集成测试阻断。

## 回归和领域测试

```text
npm test -- --run src/server/http/routes/skill-package-runtime.test.ts
```

结果：`1 passed`, `18 tests passed`。

```text
npm test -- --run src/server/services/skill-package-runtime.service.test.ts
```

结果：`1 passed`, `9 tests passed`。

```text
npm test -- --run src/server/skills/application/capability-grant.service.test.ts
```

结果：`1 passed`, `5 tests passed`。

```text
npm test -- --run src/server/skills/artifacts/artifact-store.test.ts
```

结果：`1 passed`, `12 tests passed`。

## 静态验收

```text
npm run typecheck:skills
```

结果：通过，`tsc --noEmit -p tsconfig.skills.json` 无错误。

```text
git diff --check
```

结果：通过。

## 安全和契约验收结论

- Grant approve/reject/revoke 和 Artifact export 的 actor 不再从 body 读取；可信 actor 只来自 `x-bloom-actor`。
- strict schema 拒绝身份字段伪造，并返回明确的 `VALIDATION_ERROR`。
- Run 与 Artifact 写操作保留 requestId、actor、策略版本和 security decision 审计上下文。
- Artifact 读取和导出均执行 run ownership 检查；export 要求确认、受控目录和高权限角色。
- Run command/cancel 保持 coordinator 状态机校验，并使用 idempotency key 防止重复业务审计。
- Legacy execution 继续由现有阻断测试验证，不新增 Legacy 开关或管理路径。

## 回滚说明

该任务可通过回滚提交 `feat(skills): complete P2-002 grant run artifact API` 整体撤销；不会触碰工作区中用户已有的文档、安装器资源或验证目录改动。
