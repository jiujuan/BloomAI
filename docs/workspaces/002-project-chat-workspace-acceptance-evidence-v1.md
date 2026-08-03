# 项目聊天与 Workspace 验收证据

本文档记录按 `002-project-chat-workspace-implementation-plan-v1.0.md` 执行时、**提交前**完成的可复核验收结果。每个阶段的实现、测试和本记录会在对应 Git 提交中一并保存。

## 阶段 A：可迁移数据基础

- **验收时间：** 2026-08-03
- **变更范围：**
  - `scripts/migrations/025-project-chat-workspaces.sql`
  - `src/server/db/schema.ts`
  - `src/shared/schemas/index.ts`
  - 对应迁移与 schema 测试
- **执行命令：** `npm test -- src/shared/schemas/index.test.ts src/server/db/migrations.test.ts`
- **结果：** 2 个测试文件、11 个断言通过。
- **关键证据：**
  - 空数据库连续执行迁移后只记录一次 `025-project-chat-workspaces`。
  - 旧 `sessions` 表升级后包含 `project_id`，既有会话的值为 `NULL`。
  - `projects` 表、目录不区分大小写唯一索引、项目排序索引和项目会话索引存在。
  - 项目名会 trim 并拒绝空白/81 字符名称；目录类型与分页元数据边界已验证。
- **类型检查：** `npm run typecheck` 通过。


## 阶段 B：项目领域与 HTTP API

- **验收时间：** 2026-08-03
- **执行命令：** `npm test -- src/server/db/paths.test.ts src/server/db/repositories/project.repo.test.ts src/server/services/project.service.test.ts src/server/services/session.service.test.ts src/server/http/routes/projects.test.ts src/server/http/routes/sessions.test.ts`
- **结果：** 6 个测试文件、18 个断言通过；`npm run typecheck` 通过。
- **关键证据：**
  - 已选择目录会使用真实路径持久化，且服务不移动或删除用户文件；自动目录会原子递增到 `NewProjectN`。
  - 项目和第一条 `New Chat` 会话会在同一数据库事务中创建；模拟数据库失败时只会清理本次新建且为空的自动目录。
  - 目录按不区分大小写规则拒绝重复注册；无效名称、文件路径和不存在目录会被拒绝。
  - 项目列表返回会话计数；已归档项目会话不计入统计；项目会话支持分页。
  - `GET /projects` / `POST /projects` / 项目会话路由满足 200/201/400/404/409 契约。
  - `GET /sessions?scope=recent` 只返回 `project_id = NULL` 的普通聊天，并保留无参数 `GET /sessions` 的旧 `{ data: Session[] }` 形状。

## 阶段 C：Workspace 权限链路

- **验收时间：** 2026-08-03
- **执行命令：** `npm test -- src/server/mastra/workspace/project-workspace.factory.test.ts src/server/mastra/chat-agent.test.ts src/server/mastra/index.test.ts src/server/services/chat.service.test.ts`
- **结果：** 4 个测试文件、26 个断言通过；`npm run typecheck` 通过。
- **关键证据：**
  - `ProjectWorkspaceFactory` 使用保存的项目根目录创建 `LocalFilesystem` 与 `LocalSandbox`；项目 ID 缓存可复用，根目录变更时会销毁旧实例再重建，单项目释放和全局 shutdown 都会清理资源。
  - 根目录不存在或不是目录时抛出稳定错误码 `PROJECT_WORKSPACE_UNAVAILABLE`，不会退回到进程默认工作目录；流式错误会向 UI 返回“项目工作目录不可用”的可理解提示。
  - `ChatService` 只通过可信 `sessionId -> projectService.resolveProjectForSession()` 得到项目；请求体和伪造 header 中的 `projectId` / `rootPath` 不参与授权。
  - 普通会话不会预检或挂载 Workspace；两个并发项目会话分别写入各自的 `projectId`，并分别预检各自项目根目录。
  - Agent 动态 Workspace 回调只读取服务端写入的 `requestContext.projectId`；项目请求会排除保留的 `mastra_workspace_*` 工具 ID，避免与 Mastra Workspace 工具冲突。
  - `shutdownMastraRuntime()` 已按顺序关闭 Mastra、项目 Workspace 缓存和 schedule runtime storage。
