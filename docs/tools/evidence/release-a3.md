# Release A3 验收证据

## 范围

Release A3 覆盖统一 Tool Contract、输入/输出校验、可取消 Tool Runtime、超时与有界清理、运行状态记录，以及 `tool_runs` 审计数据的脱敏和大小限制。

## 实现证据

- `src/server/tools/contracts.ts`
  - 为内置工具集中定义 Zod input/output contract。
  - 暴露 contract metadata、默认值和 UI 可用的字段投影。
- `src/server/tools/tool-runtime.ts`
  - 创建并传播 `AbortSignal`。
  - 超时后向 executor 发出 abort。
  - 仅等待有界清理宽限期，避免孤儿执行阻塞请求。
  - 记录 `success`、`error`、`timeout`、`cancelled` 等运行状态及孤儿执行指标。
- `src/server/tools/execute-tool.ts`
  - 在 executor 前执行统一 input schema 校验。
  - 在成功完成前执行 output schema 校验。
  - 将 HTTP、Agent 和既有执行入口接入共享 runtime。
- `src/server/mastra/tools.ts`、`src/server/db/client.ts`、
  `src/server/db/repositories/tool.repo.ts`、`src/server/services/tool.service.ts`
  - Agent、数据库目录、Tool Service 使用同一份 contract 生成和校验结果。
- `src/server/tools/audit-redactor.ts`
  - 脱敏 Authorization、Cookie、token、API key、密码和绝对私密路径。
  - URL query 敏感字段逐项脱敏。
  - 大 payload 保存有界 preview、原始字节数、存储字节数、截断标记和 SHA-256。
- `src/renderer/pages/Tools/ToolTestRunner.tsx`
  - 数字输入使用明确的空值和数值校验，不再把非法值静默转换为 `0`。

## 自动化测试证据

### A3 定向验收

执行命令：

```text
npm test -- src/server/tools/tool-runtime.test.ts src/server/tools/availability.test.ts src/server/http/routes/tools.test.ts src/server/services/tool.service.test.ts
```

结果：

```text
4 test files passed
20 tests passed
```

覆盖的验收场景：

- 非法 `maxChars`、`limit` 和缺失必填字段在 HTTP 层返回稳定 `VALIDATION_ERROR`，不会进入 executor。
- Agent/Mastra、数据库 schema projection、Tool Service projection 与共享 contract 保持一致。
- input/output schema 失败会阻止错误数据完成运行，并将 run 标记为 `error`。
- timeout/cancel 会传播到 executor 的 `AbortSignal`，运行状态分别记录为 `timeout` 或 `cancelled`。
- 审计记录不包含 URL query secret、Authorization/token 原文或私密路径。
- 大 output 被截断，`originalBytes > storedBytes`，保留 `truncated` 和 SHA-256，存储大小不超过默认 16 KiB。

### 全量门禁

执行结果：

```text
npm test -- --reporter=dot
exit code 0

npm run typecheck
passed

npm run build
passed

git diff --check
passed
```

## 验收结论

Release A3 验收通过。Agent、HTTP、UI 手动测试入口和数据库目录已共享统一 contract；运行时具备真实取消、超时和有界清理行为；运行审计默认脱敏并受大小限制。可以进入 Release B1。
