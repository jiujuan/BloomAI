# Release A1 验收证据

日期：2026-08-03
分支：`feat/tools-platform-impl`
基线提交：`a2cf958`（Release A0）

## 目标

建立可信授权链路：session 授权只存在于进程内存，permanent 授权才进入 SQLite；一次性批准由可信 Electron 主进程签发，并绑定工具、会话和精确输入；HTTP 请求不能通过 `approvalGranted` 字段伪造批准。

## 实现证据

- 新增 `src/server/tools/session-permission-store.ts`，以 `toolId + sessionId` 为键，支持 TTL、撤销、清空会话；新实例不携带旧授权。
- 新增 `src/server/tools/approval-token.ts` 与 `src/server/tools/approval-broker.ts`，使用 HMAC 签名、输入哈希、过期时间和单次消费校验。
- `Capability Broker` 删除 `approvalGranted` 信任入口，只接受可信 `approvalToken`；token 必须匹配工具、session 和输入。
- `POST /tools/:id/run` 使用严格 Zod object 校验，`approvalGranted` 被拒绝，`approvalToken` 才能进入批准校验。
- `tool_permissions` 只保留 `permanent` scope；`027-tool-permissions-permanent-only.sql` 清理重复记录、撤销历史非-permanent grant，并建立 `tool_id` 唯一索引。
- 新增受限 Electron IPC `tool:request-approval`；preload 只暴露结构化批准请求，main 进程通过原生确认框签发 token。

## 自动化测试

执行命令：

```text
npm test -- src/server/tools/session-permission-store.test.ts src/server/tools/approval-broker.test.ts src/server/db/migrations.test.ts src/server/http/routes/tools.test.ts src/server/services/tool.service.test.ts src/server/skills/policy/capability-broker.test.ts
npm run typecheck
npm run build
git diff --check
```

结果：

- 定向测试：6 个测试文件、35 个测试通过。
- Session grant：验证工具和 session 双重绑定、过期、撤销和重启后自然失效。
- Approval token：验证首次消费成功、二次消费拒绝、过期拒绝、工具错配拒绝、session 错配拒绝、输入变更拒绝和错误 secret 拒绝。
- HTTP：验证 `approvalGranted: true` 返回 `VALIDATION_ERROR`，legacy scope `session` 不会被持久化，permanent grant/revoke 响应保持稳定。
- 迁移：验证第 027 迁移清理重复授权、撤销非-permanent 授权、统一 scope 并建立唯一索引。
- `typecheck`：通过。
- `build`：通过；Vite 仅报告既有 chunk size warning，npm 报告既有配置/弃用 warning。
- `git diff --check`：通过。

## 验收映射

| 验收项 | 证据 |
|---|---|
| session 授权不跨重启 | `src/server/tools/session-permission-store.test.ts` 的新实例测试 |
| session A 不授权 session B | `src/server/tools/session-permission-store.test.ts` 的双键绑定测试 |
| HTTP body 不能伪造批准 | `src/server/http/routes/tools.test.ts` 的 `approvalGranted` 拒绝测试 |
| 一次性 token 首次可用、二次不可用 | `src/server/tools/approval-broker.test.ts` |
| token 不能跨工具、session 或输入复用 | `src/server/tools/approval-broker.test.ts` |
| token 过期和签名错误被拒绝 | `src/server/tools/approval-broker.test.ts` |
| durable permission 仅允许 permanent | `src/server/services/tool.service.test.ts`、`src/server/http/routes/tools.test.ts` |
| 历史权限数据可迁移 | `src/server/db/migrations.test.ts` 的第 027 迁移测试 |
| Electron 批准链路已接入 | `src/shared/constants/ipc.ts`、`src/preload/index.ts`、`src/main/index.ts` |

## 结论

Release A1 验收通过。授权状态与一次性批准 token 已从不可信 HTTP body 中分离；session 授权为进程内存语义，SQLite 仅承载 permanent grant。下一 Release 继续处理路径、网络和资源边界。
