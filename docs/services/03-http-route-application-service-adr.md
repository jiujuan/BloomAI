# ADR-0001：HTTP Route 只能通过 Application Service 调用业务能力

- **状态**：已接受
- **日期**：2026-07-16
- **决策者**：BloomAI 后端维护者
- **范围**：`src/server` 的 HTTP Route、Application Service、Repository 及 runtime 依赖边界。

## 背景

历史实现允许部分 HTTP Route 直接访问 Repository、LLM/Mastra/Skill runtime 或附件实现。这样会把协议适配、业务编排、持久化和外部运行时耦合在同一个文件中，使 HTTP contract 回归、复用、错误语义和后续 IPC/job 接入都更难维护。

## 决策

1. 生产 HTTP Route 必须通过 `src/server/services/**` 调用业务能力。Route 只保留 HTTP 输入解析、协议校验、SSE/二进制响应和错误 envelope 映射。
2. Service 是业务用例入口；它可以协调 Repository、LLM、Mastra、Skill、附件、工具、文件系统和 telemetry，但不得导入 `http/routes/**` 或 `hono` / Hono `Context`。
3. Repository 只承担持久化；不得导入 Service、HTTP、LLM、Mastra、Skill 或附件 runtime。运行时事件校验、能力策略和 artifact 事件等业务语义在 runtime/service 边界完成，Repository 只写入已经归一化的数据。
4. 与具体 runtime 无关的跨层类型和稳定引用格式放在 `src/shared/**`，而不是由 Repository 反向依赖 runtime 模块。
5. `src/server/architecture/dependency-boundaries.ts` 是持续门禁，`npm run test:architecture` 递归扫描生产 Route、Service 和 Repository。它检查静态导入和字面量动态导入。
6. 临时例外仅能通过 `DEPENDENCY_BOUNDARY_ALLOWLIST` 登记；每项必须包含精确的层、文件、导入源、原因、负责人和移除阶段。当前不存在已登记例外。

## 后果

- HTTP endpoint、状态码、`{ data }` / `{ error }` envelope 与 Chat 流协议不因分层而改变。
- 新 Route 必须先设计或复用 Service 用例；不能为图省事直接引入 Repo/runtime。
- 需要持久化 runtime 数据时，调用方先完成业务校验与 DTO 归一化，再调用 Repository。
- 违反门禁的提交会在架构测试中失败；允许的例外具有明确责任和删除期限，避免长期双路径。

## 验证与回滚

每次涉及这些目录的变更至少执行：

```powershell
npm run test:architecture
npm run typecheck
npm test
npm run build
```

该决策不引入数据库 schema 或 HTTP 协议变更。若单个迁移出现回归，可回滚相应 Service façade/调用点；不能以永久 allowlist 或 Route → Repo 双路径作为回滚方案。
