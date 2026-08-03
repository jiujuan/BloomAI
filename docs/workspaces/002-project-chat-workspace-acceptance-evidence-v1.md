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
