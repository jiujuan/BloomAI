# SKL12-P1-004 验收证据：Installation 生命周期

- 任务：`SKL12-P1-004`
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-08
- 验收状态：PASS

## 实现范围

- `src/server/skills/application/skill-lifecycle.service.ts`
  - enable 前要求当前 Version 属于 Installation 的 Package，并满足 compatible、`runnable`、`verified/approved`。
  - enable/rollback 前调用 Capability revalidation；危险 Capability 或非法声明阻止状态变化。
  - uninstall/enable/disable/rollback 使用 expectedRevision 和 idempotencyKey，卸载后的 Installation 不允许继续变更。
  - rollback 只允许切换到同 Package、非当前、已验证的可运行版本。
- `src/server/skills/application/skill-version.service.ts`
  - switch current 前执行 Installation、Package ownership、版本安全状态和 Capability revalidation 检查。
  - 重复 idempotencyKey 返回已保存命令结果，不重复产生副作用。
- `src/server/skills/application/capability-grant.service.ts`
  - 新增 `revalidateVersion(versionId)`，重新解析 Manifest requested capabilities，并返回 `safe/findings/approvalRequired`。
- `src/server/db/repositories/skill-package.repo.ts`
  - enable CAS、switch、rollback 和 runnable version resolution 均拒绝未审查、不可运行、不兼容或跨 Package 版本。
  - disabled/uninstalled Installation 不解析为可执行 Version。
  - uninstall 为软状态收敛，保留 Installation、Run、Event、Audit 历史。
- `src/server/services/skill-package-runtime.service.ts`
  - 将 Capability Grant Service 接入 Installation lifecycle 和 Version switching。
- 测试覆盖：
  - `skill-lifecycle.service.test.ts`
  - `skill-version.service.test.ts`
  - `skill-package-runtime.service.test.ts`
  - `skill-package.repo.test.ts`
  - `skill-runtime-invariants.test.ts`

## Red / Green 证据

### Red

新增 P1-004 测试先于生产实现执行，覆盖：

- enable 未审查/不可运行 Version 必须拒绝；
- switch 未审查 Version 必须拒绝；
- switch 前必须执行 Capability revalidation；
- disabled Installation 不得创建 Coordinator Run；
- Repository 不得切换到跨 Package 或未审查 Version；
- disabled Installation 不得解析 runnable Version；
- uninstall 重试必须幂等且保留历史。

Red 阶段观察到应用层断言失败、Repository 未审查 Version 切换测试失败，说明测试能约束尚未实现的行为。

### Green

```text
npm test -- --run src/server/skills/application/skill-lifecycle.service.test.ts src/server/skills/application/skill-version.service.test.ts src/server/services/skill-package-runtime.service.test.ts src/server/db/repositories/skill-package.repo.test.ts src/server/db/skill-runtime-invariants.test.ts
```

结果：`5 files passed / 41 tests passed`。

## 验收覆盖

| 契约 | 证据 |
|---|---|
| 禁用后不能创建新 Run | `skill-package-runtime.service.test.ts`：disabled Installation 的 `createRun` 不调用 Coordinator，且返回 `CONFLICT`。 |
| enable 只能启用安全版本 | `skill-lifecycle.service.test.ts`、`skill-package.repo.test.ts`：拒绝 unreviewed、非 runnable、不可兼容版本；CAS 保持 Revision 不变。 |
| switch 校验 Package ownership 和版本安全状态 | `skill-version.service.test.ts`、`skill-package.repo.test.ts`：拒绝跨 Package、unreviewed、非 runnable 目标。 |
| Capability 重新评估 | `skill-lifecycle.service.test.ts`、`skill-version.service.test.ts`：enable、switch、rollback 前调用 `revalidateVersion`；unsafe findings 阻止变更。 |
| rollback 指向已验证快照 | `skill-lifecycle.service.test.ts`：仅允许同 Package、非当前且 verified/approved runnable target。 |
| 卸载保留历史 | `skill-package.repo.test.ts`：Installation 转为 uninstalled，Run/Event/Audit 仍可读取，不执行 hard delete。 |
| 重复操作幂等 | `skill-lifecycle.service.test.ts`、`skill-version.service.test.ts`、`skill-package.repo.test.ts`：相同 idempotencyKey 返回同一结果，不重复写入。 |
| 数据库不变量和回归 | `skill-runtime-invariants.test.ts`：8 项 Package Runtime 不变量通过。 |

## 类型与差异检查

```text
npm run typecheck:skills
```

结果：退出码 `0`。

```text
git diff --check
```

结果：退出码 `0`；无 whitespace error。

## 结论

PASS：P1-004 Installation 查询、enable/disable、switch、rollback、uninstall、Capability revalidation、状态收敛和幂等语义已实现并通过聚焦测试、数据库不变量、类型检查和差异检查。该任务可独立提交。
