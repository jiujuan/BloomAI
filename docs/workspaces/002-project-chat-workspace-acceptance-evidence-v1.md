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
