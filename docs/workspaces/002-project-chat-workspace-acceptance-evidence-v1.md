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

## 阶段 D：桌面桥接和 Renderer 数据层

- **验收时间：** 2026-08-03
- **执行命令：** `npm test -- src/main/ipc/dialogs.test.ts src/main/ipc/dialogs-handler.test.ts src/renderer/api/projects.test.ts src/renderer/store/project-session.store.test.ts src/server/http/routes/projects.test.ts`
- **结果：** 5 个测试文件、15 个断言通过。完整输出：`C:\Users\xing\AppData\Local\Temp\bloomai-project-chat-stage-d-tests.log`。
- **类型检查：** `npm run typecheck` 通过。完整输出：`C:\Users\xing\AppData\Local\Temp\bloomai-project-chat-stage-d-typecheck.log`。
- **关键证据：**
  - 主进程已注册 `dialog:select-directory` IPC；原生对话框仅允许选择目录，取消或没有路径时只返回 `{ canceled: true }`，成功时只暴露第一条选择路径。preload 与 `Window.bloomai` 声明均公开相同的 `selectDirectory()` 契约。
  - Renderer `platform` 使用项目、项目会话与 recent HTTP API，查询参数会编码；非 Electron 环境安全降级为取消选择，不会伪造路径。
  - project/recent Zustand 状态分别缓存实体、项目会话分页与 recent 分页；加载 101 条项目会话时按 `100 + 1` 请求全量页面，删除仅在服务端确认后同步移除缓存。
  - 创建项目成功后，项目及首会话均进入缓存并激活首会话；创建失败不会改变现有状态。`POST /projects` 现在返回包含 `sessionCount: 1` 的完整 `ProjectSummary`，与 Renderer DTO 一致。
  - `App` 启动时并行加载项目与 15 条普通 recent 聊天；`Ctrl/Cmd+N` 仍调用普通 `createSession`，因此不会把普通聊天错误归入项目。

## 阶段 E：侧栏与弹窗

- **验收时间：** 2026-08-03
- **执行命令：** `npm test -- src/renderer/pages/Chat/ChatPanelMastra.test.ts src/renderer/pages/Chat/project-sidebar.utils.test.ts src/renderer/pages/Chat/ProjectSessionSidebar.test.tsx src/renderer/pages/Chat/ProjectTree.test.tsx src/renderer/pages/Chat/ProjectSessions.test.tsx src/renderer/pages/Chat/RecentSessions.test.tsx src/renderer/pages/Chat/CreateProjectDialog.test.tsx src/renderer/pages/Chat/ProjectWorkspaceContext.test.tsx src/renderer/pages/Chat/SessionRow.test.tsx`
- **结果：** 9 个测试文件、16 个断言通过。完整输出：`C:\Users\xing\AppData\Local\Temp\bloomai-project-chat-stage-e-tests.log`。
- **类型检查：** `npm run typecheck` 通过。完整输出：`C:\Users\xing\AppData\Local\Temp\bloomai-project-chat-stage-e-typecheck.log`。
- **构建：** `npm run build` 通过，Renderer、Electron main 和 preload 均已产出。完整输出：`C:\Users\xing\AppData\Local\Temp\bloomai-project-chat-stage-e-build.log`。构建保留已有的单个 Renderer chunk 超过 500 kB 的体积告警，但进程退出码为 0。
- **关键证据：**
  - 新侧栏已替换旧 `SessionList`：默认显示 6 个项目，第 7 个项目显示可访问的“更多文件夹”；项目采用手风琴展开，重复选择当前项目可收起。
  - 每个项目默认显示 10 条会话；第 11 条时可“展开显示”，展开后可“收起显示”。recent 按累积的 `15 → 30 → 60 → 120…` 规则加载，到达总数后隐藏“更多”。
  - 创建项目弹窗验证 trim 后 1–80 字符名称；目录选择显示跨平台 basename，选择取消时保留原目录；创建成功后自动展开项目并打开首会话。
  - 项目会话显示工作目录上下文，普通会话不显示。若后端流返回 `PROJECT_WORKSPACE_UNAVAILABLE` 或“项目工作目录不可用”，Renderer 标记该项目、显示告警并禁用发送；提交消息与确认计划路径也会防御性阻止，其他项目与普通会话不受影响。
  - 会话行复用并拒绝空白重命名；项目与 recent 的加载/错误/重试状态都有可访问的 UI 表达。

## 阶段 F：回归与验收

- **验收时间：** 2026-08-03
- **全量回归：** `npm test` 通过：173 个测试文件通过、1 个跳过；771 个测试通过、1 个跳过。完整输出：`C:\Users\xing\AppData\Local\Temp\bloomai-project-chat-stage-f-full-test.log`。
- **临时 `DATA_DIR` 服务端集成：** `npm test -- src/server/services/project.service.test.ts src/server/http/routes/projects.test.ts src/server/http/routes/sessions.test.ts src/server/mastra/workspace/project-workspace.factory.test.ts src/server/services/chat.service.test.ts` 通过：5 个测试文件、34 个断言。完整输出：`C:\Users\xing\AppData\Local\Temp\bloomai-project-chat-stage-f-temp-data-integration.log`。
  - 测试在每个场景用 `fs.mkdtempSync(...)` 设置独立 `DATA_DIR`，应用迁移至 `025-project-chat-workspaces` 后验证 HTTP/服务/Workspace 链路。
  - 验证 selected 目录中的已有文件未被移动或删除；自动目录在已有编号间隙与已注册项目的情况下仍原子地产生下一可用 `NewProjectN`。
  - 验证 HTTP 创建项目返回首项目会话，项目会话分页带有正确归属；普通 `POST /sessions` 仅会进入 `scope=recent`。
  - 验证缺失或文件类型的项目根目录返回稳定的 `PROJECT_WORKSPACE_UNAVAILABLE`，不会回退到其他主机目录。
- **静态与构建回归：** 最近一次源代码构建使用 `npm run typecheck` 和 `npm run build` 均通过；日志见阶段 E。构建仅保留既有 Renderer chunk 体积告警，退出码为 0。
- **Electron 原生目录选择人工冒烟：** **未在本次非交互式自动化环境中执行，不能声称已通过。** 自动化已覆盖 IPC 注册、目录选择结果映射、preload 契约和 Renderer 降级；但计划第 11 节的真实原生对话框交互、两个项目内实际文件/命令任务，以及 11/7/61 条数据的人工可视化流程，仍需要在可交互桌面环境执行 `npm run dev` 后按清单复核。
