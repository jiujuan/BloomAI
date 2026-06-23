# BloomAI 简化目录结构设计

> 设计日期：2026-06-23  
> 目标：将当前分散的 `apps/desktop`、`packages/ui`、`packages/server` 收敛为常见 Electron + React 单应用结构。  
> 原则：实施简单、模块清晰、后续可扩展；不采用 Clean Architecture，不提前拆多 package。

## 1. 设计结论

BloomAI 前期推荐使用 **Electron 单应用结构 + 轻量模块化**。

根目录就是应用目录，不再保留：

```txt
apps/desktop/
packages/ui/
packages/server/
```

统一收敛为：

```txt
src/main      # Electron 主进程
src/preload   # 安全桥接层
src/renderer  # React 渲染进程
src/server    # 本地 Express 服务
src/shared    # 共享类型、schema、常量
```

这样 BloomAI 会从“monorepo 多包结构”简化为一个更常见、更直接的 Electron 应用结构。后续如果真的需要 Web 版、CLI、插件 SDK，再重新拆出 `packages`。

## 2. 分层说明

### main

Electron 主进程层，负责桌面应用生命周期和系统能力。

主要职责：

- 创建主窗口和悬浮窗口
- 管理托盘
- 注册全局快捷键
- 启动和监控本地 server
- 注册 IPC handler
- 封装系统能力，比如剪贴板、窗口控制、系统信息

### preload

安全桥接层，负责通过 `contextBridge` 把有限 API 暴露给 renderer。

主要职责：

- 暴露 `window.bloomai`
- 屏蔽 Electron 原生 API 细节
- 统一 IPC channel 调用
- 定义 renderer 可访问的桌面能力边界

### renderer

React 渲染进程，负责所有用户界面和前端状态。

主要职责：

- 页面和组件
- Zustand store
- 前端 service
- 调用本地 server API
- 调用 preload API
- 处理 SSE 流式响应

### server

本地 Express 服务，负责 AI、数据库、工具、Skills 等后端能力。

主要职责：

- REST API
- SSE chat stream
- SQLite/sql.js 数据存储
- Repository
- AI model 调用
- Tool 执行
- Skill 执行
- 权限策略

### shared

共享代码层，只放稳定、无副作用、可被多个进程复用的内容。

主要职责：

- IPC channel 常量
- API 常量
- TypeScript 类型
- Zod schema
- 模型常量

不要在 `shared` 中放依赖 Electron、React、Express、数据库或 Node 文件系统的代码。

## 3. 推荐目录结构

```txt
bloomai/
│
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── index.html
├── README.md
│
├── docs/
│   ├── BloomAI-roadmap.md
│   ├── BloomAI-architecture-analysis.md
│   └── BloomAI-simplified-directory-structure.md
│
├── src/
│   ├── main/                         # Electron 主进程
│   │   ├── index.ts                  # 主进程入口
│   │   ├── windows/
│   │   │   ├── MainWindow.ts
│   │   │   └── OverlayWindow.ts
│   │   ├── ipc/
│   │   │   ├── app.handler.ts
│   │   │   ├── clipboard.handler.ts
│   │   │   ├── window.handler.ts
│   │   │   ├── system.handler.ts
│   │   │   └── index.ts
│   │   ├── services/
│   │   │   ├── TrayService.ts
│   │   │   ├── ShortcutService.ts
│   │   │   ├── ServerProcessService.ts
│   │   │   └── SystemService.ts
│   │   ├── config/
│   │   │   ├── env.ts
│   │   │   └── paths.ts
│   │   └── utils/
│   │       └── logger.ts
│   │
│   ├── preload/                      # 安全桥接层
│   │   ├── index.ts
│   │   ├── api/
│   │   │   ├── app.ts
│   │   │   ├── clipboard.ts
│   │   │   ├── window.ts
│   │   │   └── system.ts
│   │   └── types.ts
│   │
│   ├── renderer/                     # React 渲染进程
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Chat/
│   │   │   │   ├── index.tsx
│   │   │   │   ├── ChatPanel.tsx
│   │   │   │   ├── SessionList.tsx
│   │   │   │   ├── Timeline.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── InputBar.tsx
│   │   │   │   ├── ContextPills.tsx
│   │   │   │   └── chat.store.ts
│   │   │   ├── Personas/
│   │   │   │   ├── index.tsx
│   │   │   │   └── personas.store.ts
│   │   │   ├── Tools/
│   │   │   │   ├── index.tsx
│   │   │   │   ├── ToolDetailPage.tsx
│   │   │   │   ├── ToolTestRunner.tsx
│   │   │   │   ├── PermissionDialog.tsx
│   │   │   │   └── tools.store.ts
│   │   │   ├── Skills/
│   │   │   │   ├── index.tsx
│   │   │   │   ├── SkillEditor.tsx
│   │   │   │   └── skills.store.ts
│   │   │   ├── Settings/
│   │   │   │   ├── index.tsx
│   │   │   │   └── settings.store.ts
│   │   │   └── Onboarding/
│   │   │       └── index.tsx
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.tsx
│   │   │   │   └── NavSidebar.tsx
│   │   │   └── shared/
│   │   │       ├── EmptyState.tsx
│   │   │       ├── Loading.tsx
│   │   │       └── ErrorView.tsx
│   │   ├── hooks/
│   │   │   ├── useClipboard.ts
│   │   │   ├── useActiveWindow.ts
│   │   │   └── useStream.ts
│   │   ├── store/
│   │   │   ├── app.store.ts
│   │   │   ├── ui.store.ts
│   │   │   └── index.ts
│   │   ├── services/
│   │   │   ├── ChatService.ts
│   │   │   ├── SessionService.ts
│   │   │   ├── PersonaService.ts
│   │   │   ├── ToolService.ts
│   │   │   ├── SkillService.ts
│   │   │   └── SettingsService.ts
│   │   ├── api/
│   │   │   ├── http.ts
│   │   │   ├── sse.ts
│   │   │   ├── electron.ts
│   │   │   └── index.ts
│   │   ├── styles/
│   │   │   └── global.css
│   │   └── utils/
│   │       ├── cn.ts
│   │       ├── date.ts
│   │       └── format.ts
│   │
│   ├── server/                       # 本地 Express 服务
│   │   ├── index.ts
│   │   ├── app.ts
│   │   ├── routes/
│   │   │   ├── chat.route.ts
│   │   │   ├── sessions.route.ts
│   │   │   ├── personas.route.ts
│   │   │   ├── settings.route.ts
│   │   │   ├── tools.route.ts
│   │   │   └── skills.route.ts
│   │   ├── services/
│   │   │   ├── ChatService.ts
│   │   │   ├── ModelService.ts
│   │   │   ├── ToolService.ts
│   │   │   ├── SkillService.ts
│   │   │   ├── PermissionService.ts
│   │   │   └── SettingsService.ts
│   │   ├── db/
│   │   │   ├── client.ts
│   │   │   ├── migrations.ts
│   │   │   ├── seed.ts
│   │   │   └── repositories/
│   │   │       ├── session.repo.ts
│   │   │       ├── message.repo.ts
│   │   │       ├── persona.repo.ts
│   │   │       ├── setting.repo.ts
│   │   │       ├── tool.repo.ts
│   │   │       └── skill.repo.ts
│   │   ├── tools/
│   │   │   ├── registry.ts
│   │   │   ├── web.tool.ts
│   │   │   ├── fs.tool.ts
│   │   │   ├── document.tool.ts
│   │   │   ├── multimodal.tool.ts
│   │   │   └── execution.tool.ts
│   │   ├── skills/
│   │   │   ├── runner.ts
│   │   │   ├── js-function.runner.ts
│   │   │   ├── http-api.runner.ts
│   │   │   └── prompt-template.runner.ts
│   │   ├── middleware/
│   │   │   ├── error.ts
│   │   │   ├── validate.ts
│   │   │   └── sse.ts
│   │   └── utils/
│   │       ├── logger.ts
│   │       └── id.ts
│   │
│   └── shared/                       # main / preload / renderer / server 共享
│       ├── constants/
│       │   ├── ipc.ts
│       │   ├── api.ts
│       │   └── models.ts
│       ├── types/
│       │   ├── chat.ts
│       │   ├── session.ts
│       │   ├── persona.ts
│       │   ├── tool.ts
│       │   ├── skill.ts
│       │   ├── settings.ts
│       │   └── api.ts
│       └── schemas/
│           ├── chat.schema.ts
│           ├── session.schema.ts
│           ├── persona.schema.ts
│           ├── tool.schema.ts
│           ├── skill.schema.ts
│           └── settings.schema.ts
│
└── scripts/
    ├── build.ts
    └── migrate.ts
```

## 4. 当前目录迁移关系

```txt
apps/desktop/electron        -> src/main
apps/desktop/electron/main.ts -> src/main/index.ts
apps/desktop/electron/preload.ts -> src/preload/index.ts

apps/desktop/src             -> src/renderer
apps/desktop/src/components  -> src/renderer/components 或 src/renderer/pages/*
apps/desktop/src/stores      -> src/renderer/store 或各 pages/*/*.store.ts
apps/desktop/src/lib         -> src/renderer/api、src/renderer/utils、src/shared

packages/server/src          -> src/server
packages/server/src/routes   -> src/server/routes
packages/server/src/services -> src/server/services
packages/server/src/db       -> src/server/db

packages/ui/src              -> src/renderer
packages/ui/src/lib/schemas  -> src/shared/schemas
packages/ui/src/lib/platform.ts -> src/renderer/api/electron.ts 或 src/renderer/api/http.ts
```

## 5. 文件放置规则

### 页面相关代码

只被某个页面使用的组件、store、局部样式，放在对应页面目录中：

```txt
src/renderer/pages/Chat/
src/renderer/pages/Tools/
```

例如 `MessageBubble.tsx` 只服务聊天页，就放在 `pages/Chat`，不要放公共组件。

### 公共 UI 组件

被多个页面复用的组件，放：

```txt
src/renderer/components/
```

例如 `AppShell`、`NavSidebar`、`EmptyState`。

### 前端 API 调用

HTTP、SSE、Electron preload 调用统一放：

```txt
src/renderer/api/
```

页面和 store 不直接写 `fetch` 或 `window.bloomai.invoke`，而是调用 `api` 或 `services`。

### 前端业务 service

前端 service 用来包装页面级业务操作：

```txt
src/renderer/services/ChatService.ts
src/renderer/services/ToolService.ts
```

它们可以调用 `src/renderer/api`，但不直接访问 Electron 或数据库。

### 后端 service

后端 service 放 AI、工具、Skill、权限等后端业务逻辑：

```txt
src/server/services/
```

route 只负责 HTTP 输入输出，不塞复杂业务逻辑。

### 数据库代码

数据库连接、迁移、seed、repository 全部放：

```txt
src/server/db/
```

不要让 renderer 或 main 直接访问数据库。

### 共享类型和 schema

main、preload、renderer、server 都会用到的类型和 schema 放：

```txt
src/shared/
```

`shared` 必须保持纯净，不依赖运行环境。

## 6. 命名约定

页面目录使用 PascalCase：

```txt
Chat/
Tools/
Settings/
```

React 组件使用 PascalCase：

```txt
ChatPanel.tsx
MessageBubble.tsx
PermissionDialog.tsx
```

store 使用小写业务名：

```txt
chat.store.ts
tools.store.ts
settings.store.ts
```

server route 使用小写业务名：

```txt
chat.route.ts
tools.route.ts
skills.route.ts
```

server service 使用 PascalCase：

```txt
ChatService.ts
ToolService.ts
PermissionService.ts
```

repository 使用小写业务名：

```txt
session.repo.ts
message.repo.ts
tool.repo.ts
```

## 7. 为什么不保留 packages

当前阶段不建议保留 `packages`，原因是：

- BloomAI 还没有多个独立发布单元。
- `packages/ui` 和 `apps/desktop/src` 已经出现重复实现。
- `packages/server` 实际只服务桌面本地应用，没有独立部署需求。
- 多 package 会增加路径跳转、构建配置和依赖管理成本。

未来满足以下条件时，再考虑恢复 `packages`：

- 出现 Web 版，需要复用 renderer UI。
- 出现 CLI，需要复用 server/core 能力。
- 出现插件 SDK，需要独立发布类型和工具接口。
- server 需要独立部署或作为远程服务运行。

## 8. 最终原则

前期只保留一个应用、一套源码、一套构建配置。

```txt
src/main      # Electron 主进程
src/preload   # 安全桥接
src/renderer  # React UI
src/server    # 本地 API 服务
src/shared    # 共享类型、schema、常量
```

这套结构比当前 monorepo 多包结构更短、更直接，也更适合 BloomAI 当前阶段。它仍然保留了 Electron 应用天然的进程边界，并为后续扩展 Web、CLI、插件 SDK 留出了重新拆包的空间。
