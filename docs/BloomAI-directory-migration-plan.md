# BloomAI 目录结构迁移实施计划

> 计划日期：2026-06-23  
> 依据：`docs/BloomAI-simplified-directory-structure.md`  
> 目标：只迁移目录结构和程序文件位置，保持现有功能、页面、API 行为不变。  
> 范围：将当前 `apps/desktop`、`packages/ui`、`packages/server` 收敛到根目录 `src/main`、`src/preload`、`src/renderer`、`src/server`、`src/shared`。

## 1. 迁移原则

1. 先搬家，后重构  
   第一轮只移动文件、修正 import、修正构建配置，不改业务逻辑。

2. 以前端当前主线为准  
   当前完整 v0.2 UI 在 `apps/desktop/src`。迁移时以它为准，`packages/ui/src` 只作为旧版本参考，不覆盖现有页面。

3. 以后端当前主线为准  
   `packages/server/src` 是本地 Express 服务主线，整体迁到 `src/server`。

4. 每个阶段都可验证  
   每完成一组迁移，都运行类型检查或构建，避免最后一次性爆炸。

5. 旧目录最后删除  
   只有在新目录构建、启动、核心页面验收通过后，才删除 `apps` 和 `packages`。

## 2. 目标目录

迁移完成后的核心结构：

```txt
bloomai/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── index.html
├── docs/
├── scripts/
└── src/
    ├── main/
    ├── preload/
    ├── renderer/
    ├── server/
    └── shared/
```

## 3. 总体迁移路径

```txt
apps/desktop/electron        -> src/main
apps/desktop/electron/preload.ts -> src/preload/index.ts

apps/desktop/src             -> src/renderer
packages/server/src          -> src/server

apps/desktop/src/lib/schemas -> src/shared/schemas
apps/desktop/src/lib/utils 中的稳定常量 -> src/shared/constants

packages/ui/src              -> 不作为主线迁移；只补充缺失文件时参考
```

## 4. 阶段 1：根目录配置收敛

### 文件迁移

| 旧路径 | 新路径 | 动作 | 说明 |
|---|---|---|---|
| `apps/desktop/package.json` | `package.json` | 合并 | 合并 root、desktop、server、ui 依赖和脚本 |
| `apps/desktop/vite.config.ts` | `electron.vite.config.ts` | 移动并改名 | 入口从 `electron/*` 改为 `src/main`、`src/preload` |
| `apps/desktop/tsconfig.json` | `tsconfig.json` | 合并 | 合并 renderer、main、server 类型配置 |
| `apps/desktop/index.html` | `index.html` | 移动 | React 入口 HTML |
| `turbo.json` | 删除或暂存 | 删除 | 单应用后不再需要 Turbo 编排 |
| `packages/ui/package.json` | 删除 | 删除 | 不再作为独立 package |
| `packages/server/package.json` | 删除 | 删除 | 依赖合并到根 `package.json` |

### package.json 建议脚本

```json
{
  "scripts": {
    "dev": "vite --config electron.vite.config.ts",
    "build": "tsc && vite build --config electron.vite.config.ts",
    "typecheck": "tsc --noEmit",
    "lint": "echo \"lint ok\"",
    "start:server": "tsx src/server/index.ts"
  }
}
```

### 依赖合并清单

从 `apps/desktop/package.json` 保留：

```txt
react
react-dom
zustand
zod
clsx
tailwind-merge
react-markdown
lucide-react
electron
electron-builder
vite
vite-plugin-electron
vite-plugin-electron-renderer
@vitejs/plugin-react
```

从 `packages/server/package.json` 合并：

```txt
@anthropic-ai/sdk
cors
express
sql.js
uuid
tsx
vitest
@types/cors
@types/express
@types/sql.js
@types/uuid
```

移除 workspace 依赖：

```txt
@bloomai/ui
@bloomai/server
workspaces
```

### electron.vite.config.ts 必改点

旧入口：

```ts
entry: 'electron/main.ts'
entry: 'electron/preload.ts'
```

新入口：

```ts
entry: 'src/main/index.ts'
entry: 'src/preload/index.ts'
```

旧 alias：

```ts
'@': path.resolve(__dirname, 'src')
```

建议新 alias：

```ts
'@renderer': path.resolve(__dirname, 'src/renderer')
'@main': path.resolve(__dirname, 'src/main')
'@server': path.resolve(__dirname, 'src/server')
'@shared': path.resolve(__dirname, 'src/shared')
```

### 阶段验收

```bash
npm run typecheck
```

此阶段允许失败，但失败应只来自文件尚未迁移，不应来自依赖缺失或配置语法错误。

## 5. 阶段 2：Electron 主进程迁移

### 直接迁移

| 旧路径 | 新路径 | 动作 |
|---|---|---|
| `apps/desktop/electron/main.ts` | `src/main/index.ts` | 移动 |
| `apps/desktop/electron/preload.ts` | `src/preload/index.ts` | 移动 |

### 推荐拆分

第一轮可以先只移动，不拆文件。若同步拆分，按下表迁移：

| 旧文件中的逻辑 | 新文件 | 说明 |
|---|---|---|
| `createMainWindow()` | `src/main/windows/MainWindow.ts` | 主窗口创建 |
| `createOverlayWindow()` | `src/main/windows/OverlayWindow.ts` | 悬浮窗创建 |
| `createTray()` | `src/main/services/TrayService.ts` | 托盘 |
| `globalShortcut.register()` | `src/main/services/ShortcutService.ts` | 全局快捷键 |
| `startServer()` | `src/main/services/ServerProcessService.ts` | 本地 server 子进程 |
| `setupIPC()` | `src/main/ipc/index.ts` | IPC 聚合注册 |
| 剪贴板 IPC | `src/main/ipc/clipboard.handler.ts` | `clipboard:read/write` |
| 窗口 IPC | `src/main/ipc/window.handler.ts` | `window:*` |
| App 信息和外链 IPC | `src/main/ipc/app.handler.ts` | `app:version`、`shell:open-external` |

### main 入口修正

原 server 开发入口类似：

```ts
path.join(__dirname, '../../packages/server/src/index.ts')
```

迁移后改为：

```ts
path.join(__dirname, '../server/index.ts')
```

生产入口应指向构建后的 server：

```ts
path.join(__dirname, '../server/index.js')
```

实际路径需结合 Vite/Electron 输出目录确认。迁移时要通过构建产物检查 `dist-electron` 下的相对位置。

### preload 拆分

| 旧逻辑 | 新路径 |
|---|---|
| `readClipboard/writeClipboard` | `src/preload/api/clipboard.ts` |
| `closeOverlay/openMain` | `src/preload/api/window.ts` |
| `getVersion/openExternal` | `src/preload/api/app.ts` |
| `getActiveWindow` | `src/preload/api/system.ts` |
| `contextBridge.exposeInMainWorld` | `src/preload/index.ts` |
| `window.bloomai` 类型 | `src/preload/types.ts` |

### 阶段验收

```bash
npm run typecheck
```

手动检查：

```txt
Electron 主窗口能打开
Alt+Space 能唤起悬浮窗
托盘菜单能显示
preload 暴露的 window.bloomai 能被 renderer 访问
```

## 6. 阶段 3：Renderer 前端迁移

以 `apps/desktop/src` 为迁移来源。

### 入口文件

| 旧路径 | 新路径 | 动作 |
|---|---|---|
| `apps/desktop/src/main.tsx` | `src/renderer/main.tsx` | 移动 |
| `apps/desktop/src/App.tsx` | `src/renderer/App.tsx` | 移动 |
| `apps/desktop/src/styles/global.css` | `src/renderer/styles/global.css` | 移动 |

### lib 迁移

| 旧路径 | 新路径 | 动作 |
|---|---|---|
| `apps/desktop/src/lib/platform.ts` | `src/renderer/api/index.ts` | 移动并改 import |
| `apps/desktop/src/lib/utils.ts` | `src/renderer/utils/index.ts` | 移动 |
| `apps/desktop/src/lib/schemas/index.ts` | `src/shared/schemas/index.ts` | 移动 |

如果暂时不想大范围改 import，可以先保留：

```txt
src/renderer/lib/platform.ts
src/renderer/lib/utils.ts
src/renderer/lib/schemas/index.ts
```

等页面跑通后再移动到 `api/utils/shared`。

### Chat 页面

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/components/chat/ChatPanel.tsx` | `src/renderer/pages/Chat/ChatPanel.tsx` |
| `apps/desktop/src/components/chat/SessionList.tsx` | `src/renderer/pages/Chat/SessionList.tsx` |
| `apps/desktop/src/components/chat/Timeline.tsx` | `src/renderer/pages/Chat/Timeline.tsx` |
| `apps/desktop/src/components/chat/MessageBubble.tsx` | `src/renderer/pages/Chat/MessageBubble.tsx` |
| `apps/desktop/src/components/chat/InputBar.tsx` | `src/renderer/pages/Chat/InputBar.tsx` |
| `apps/desktop/src/components/chat/ContextPills.tsx` | `src/renderer/pages/Chat/ContextPills.tsx` |
| `apps/desktop/src/components/chat/ToolCallCard.tsx` | `src/renderer/pages/Chat/ToolCallCard.tsx` |

新增聚合入口：

```txt
src/renderer/pages/Chat/index.tsx
```

可暂时导出：

```ts
export { ChatPanel } from './ChatPanel'
```

### Personas 页面

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/components/persona/PersonasPage.tsx` | `src/renderer/pages/Personas/index.tsx` |

### Settings 页面

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/components/settings/SettingsPage.tsx` | `src/renderer/pages/Settings/index.tsx` |

### Tools 页面

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/components/tools/ToolManagePage.tsx` | `src/renderer/pages/Tools/index.tsx` |
| `apps/desktop/src/components/tools/ToolDetailPage.tsx` | `src/renderer/pages/Tools/ToolDetailPage.tsx` |
| `apps/desktop/src/components/tools/ToolTestRunner.tsx` | `src/renderer/pages/Tools/ToolTestRunner.tsx` |
| `apps/desktop/src/components/tools/PermissionDialog.tsx` | `src/renderer/pages/Tools/PermissionDialog.tsx` |
| `apps/desktop/src/stores/tools.store.ts` | `src/renderer/pages/Tools/tools.store.ts` |

### Skills 页面

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/components/skills/SkillsMarket.tsx` | `src/renderer/pages/Skills/index.tsx` |
| `apps/desktop/src/components/skills/SkillEditor.tsx` | `src/renderer/pages/Skills/SkillEditor.tsx` |
| `apps/desktop/src/stores/skills.store.ts` | `src/renderer/pages/Skills/skills.store.ts` |

### Onboarding 页面

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/components/shared/Onboarding.tsx` | `src/renderer/pages/Onboarding/index.tsx` |

### 公共组件

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/components/layout/AppShell.tsx` | `src/renderer/components/layout/AppShell.tsx` |
| `apps/desktop/src/components/layout/NavSidebar.tsx` | `src/renderer/components/layout/NavSidebar.tsx` |

### Store

第一轮建议只移动聚合 store，保持内部实现不拆：

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/stores/index.ts` | `src/renderer/store/index.ts` |

后续再拆：

```txt
chat.store.ts
session.store.ts
persona.store.ts
settings.store.ts
ui.store.ts
```

### 阶段验收

```bash
npm run typecheck
npm run build
```

手动页面检查：

```txt
Chat 页面渲染正常
Personas 页面渲染正常
Settings 页面渲染正常
Tools 页面渲染正常
Skills 页面渲染正常
Onboarding 显示和关闭正常
```

## 7. 阶段 4：Server 后端迁移

### 入口和 app

| 旧路径 | 新路径 |
|---|---|
| `packages/server/src/index.ts` | `src/server/index.ts` |
| `packages/server/src/app.ts` | `src/server/app.ts` |

### routes

| 旧路径 | 新路径 |
|---|---|
| `packages/server/src/routes/chat.route.ts` | `src/server/routes/chat.route.ts` |
| `packages/server/src/routes/sessions.route.ts` | `src/server/routes/sessions.route.ts` |
| `packages/server/src/routes/personas.route.ts` | `src/server/routes/personas.route.ts` |
| `packages/server/src/routes/settings.route.ts` | `src/server/routes/settings.route.ts` |
| `packages/server/src/routes/tools.route.ts` | `src/server/routes/tools.route.ts` |
| `packages/server/src/routes/skills.route.ts` | `src/server/routes/skills.route.ts` |

### services

第一轮可以保持原文件名，减少 import 改动：

| 旧路径 | 新路径 |
|---|---|
| `packages/server/src/services/tool.service.ts` | `src/server/services/tool.service.ts` |
| `packages/server/src/services/skill.service.ts` | `src/server/services/skill.service.ts` |

第二轮再改名：

| 临时新路径 | 最终路径 |
|---|---|
| `src/server/services/tool.service.ts` | `src/server/services/ToolService.ts` |
| `src/server/services/skill.service.ts` | `src/server/services/SkillService.ts` |

### db

| 旧路径 | 新路径 |
|---|---|
| `packages/server/src/db/client.ts` | `src/server/db/client.ts` |
| `packages/server/src/db/repositories/session.repo.ts` | `src/server/db/repositories/session.repo.ts` |
| `packages/server/src/db/repositories/message.repo.ts` | `src/server/db/repositories/message.repo.ts` |
| `packages/server/src/db/repositories/persona.repo.ts` | `src/server/db/repositories/persona.repo.ts` |
| `packages/server/src/db/repositories/tool.repo.ts` | `src/server/db/repositories/tool.repo.ts` |
| `packages/server/src/db/repositories/skill.repo.ts` | `src/server/db/repositories/skill.repo.ts` |

### middleware

| 旧路径 | 新路径 |
|---|---|
| `packages/server/src/middleware/index.ts` | `src/server/middleware/index.ts` |

第二轮可拆分为：

```txt
src/server/middleware/error.ts
src/server/middleware/validate.ts
src/server/middleware/sse.ts
```

### 后续可选拆分

`tool.service.ts` 当前包含所有工具执行器。迁移第一轮不拆，功能跑通后再拆到：

```txt
src/server/tools/registry.ts
src/server/tools/web.tool.ts
src/server/tools/fs.tool.ts
src/server/tools/document.tool.ts
src/server/tools/multimodal.tool.ts
src/server/tools/execution.tool.ts
```

`skill.service.ts` 后续可拆到：

```txt
src/server/skills/runner.ts
src/server/skills/js-function.runner.ts
src/server/skills/http-api.runner.ts
src/server/skills/prompt-template.runner.ts
```

### 阶段验收

```bash
npm run start:server
```

手动检查：

```txt
GET http://127.0.0.1:3718/health 返回 { "status": "ok" }
GET /api/v1/sessions 可返回 data
GET /api/v1/personas 可返回 data
GET /api/v1/tools 可返回 data
GET /api/v1/skills 可返回 data
```

## 8. 阶段 5：shared 迁移

### schemas

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/lib/schemas/index.ts` | `src/shared/schemas/index.ts` |
| `packages/ui/src/lib/schemas/index.ts` | 不迁移或对照合并 | 避免覆盖当前版本 |

### constants

| 来源 | 新路径 | 内容 |
|---|---|---|
| `apps/desktop/src/lib/utils.ts` | `src/shared/constants/models.ts` | `AVAILABLE_MODELS`、`MODEL_LABELS` 等稳定模型常量 |
| Electron IPC 字符串 | `src/shared/constants/ipc.ts` | `clipboard:read`、`window:open-main` 等 channel |
| `platform.ts` API base | `src/shared/constants/api.ts` | 默认端口、API prefix |

### types

可以先不拆，等 schema 稳定后再从 Zod infer 导出：

```txt
src/shared/types/chat.ts
src/shared/types/session.ts
src/shared/types/persona.ts
src/shared/types/tool.ts
src/shared/types/skill.ts
src/shared/types/settings.ts
src/shared/types/api.ts
```

### shared 约束

`src/shared` 不能依赖：

```txt
electron
react
express
fs
path
sql.js
```

它只能放纯类型、schema、常量和无副作用工具。

### 阶段验收

```bash
npm run typecheck
```

## 9. 阶段 6：Import 和别名修复

### 必须搜索的旧引用

```txt
../../packages/server
../../packages/ui
@bloomai/server
@bloomai/ui
./components/
../components/
./lib/
../lib/
./stores/
../stores/
electron/main.ts
electron/preload.ts
```

### 推荐替换方向

| 旧引用 | 新引用 |
|---|---|
| `../lib/platform` | `@renderer/api` |
| `../lib/utils` | `@renderer/utils` |
| `../lib/schemas` | `@shared/schemas` |
| `../stores` | `@renderer/store` |
| `./components/chat/*` | `@renderer/pages/Chat/*` |
| `./components/tools/*` | `@renderer/pages/Tools/*` |
| `./components/skills/*` | `@renderer/pages/Skills/*` |
| `../../packages/server/src/*` | `@server/*` |

### tsconfig paths

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@main/*": ["src/main/*"],
      "@preload/*": ["src/preload/*"],
      "@renderer/*": ["src/renderer/*"],
      "@server/*": ["src/server/*"],
      "@shared/*": ["src/shared/*"]
    }
  }
}
```

### 阶段验收

```bash
npm run typecheck
npm run build
```

## 10. 阶段 7：旧目录处理

### 验证通过前

不要删除旧目录，可以暂时改名：

```txt
apps/      -> _legacy/apps/
packages/  -> _legacy/packages/
```

### 验证通过后删除

```txt
apps/
packages/
turbo.json
```

同时检查并删除旧引用：

```txt
@bloomai/ui
@bloomai/server
workspaces
turbo run
apps/desktop
packages/server
packages/ui
```

## 11. 完整旧路径到新路径映射

### 根和配置

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/package.json` | `package.json` |
| `apps/desktop/vite.config.ts` | `electron.vite.config.ts` |
| `apps/desktop/tsconfig.json` | `tsconfig.json` |
| `apps/desktop/index.html` | `index.html` |
| `package-lock.json` | `package-lock.json` |
| `.env.example` | `.env.example` |
| `.gitignore` | `.gitignore` |
| `README.md` | `README.md` |
| `docs/*` | `docs/*` |

### Electron

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/electron/main.ts` | `src/main/index.ts` |
| `apps/desktop/electron/preload.ts` | `src/preload/index.ts` |

### Renderer

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/main.tsx` | `src/renderer/main.tsx` |
| `apps/desktop/src/App.tsx` | `src/renderer/App.tsx` |
| `apps/desktop/src/index.ts` | 删除或改为 `src/renderer/index.ts` |
| `apps/desktop/src/styles/global.css` | `src/renderer/styles/global.css` |
| `apps/desktop/src/lib/platform.ts` | `src/renderer/api/index.ts` |
| `apps/desktop/src/lib/utils.ts` | `src/renderer/utils/index.ts` |
| `apps/desktop/src/lib/schemas/index.ts` | `src/shared/schemas/index.ts` |
| `apps/desktop/src/stores/index.ts` | `src/renderer/store/index.ts` |
| `apps/desktop/src/stores/tools.store.ts` | `src/renderer/pages/Tools/tools.store.ts` |
| `apps/desktop/src/stores/skills.store.ts` | `src/renderer/pages/Skills/skills.store.ts` |

### Renderer 组件和页面

| 旧路径 | 新路径 |
|---|---|
| `apps/desktop/src/components/chat/ChatPanel.tsx` | `src/renderer/pages/Chat/ChatPanel.tsx` |
| `apps/desktop/src/components/chat/SessionList.tsx` | `src/renderer/pages/Chat/SessionList.tsx` |
| `apps/desktop/src/components/chat/Timeline.tsx` | `src/renderer/pages/Chat/Timeline.tsx` |
| `apps/desktop/src/components/chat/MessageBubble.tsx` | `src/renderer/pages/Chat/MessageBubble.tsx` |
| `apps/desktop/src/components/chat/InputBar.tsx` | `src/renderer/pages/Chat/InputBar.tsx` |
| `apps/desktop/src/components/chat/ContextPills.tsx` | `src/renderer/pages/Chat/ContextPills.tsx` |
| `apps/desktop/src/components/chat/ToolCallCard.tsx` | `src/renderer/pages/Chat/ToolCallCard.tsx` |
| `apps/desktop/src/components/persona/PersonasPage.tsx` | `src/renderer/pages/Personas/index.tsx` |
| `apps/desktop/src/components/settings/SettingsPage.tsx` | `src/renderer/pages/Settings/index.tsx` |
| `apps/desktop/src/components/tools/ToolManagePage.tsx` | `src/renderer/pages/Tools/index.tsx` |
| `apps/desktop/src/components/tools/ToolDetailPage.tsx` | `src/renderer/pages/Tools/ToolDetailPage.tsx` |
| `apps/desktop/src/components/tools/ToolTestRunner.tsx` | `src/renderer/pages/Tools/ToolTestRunner.tsx` |
| `apps/desktop/src/components/tools/PermissionDialog.tsx` | `src/renderer/pages/Tools/PermissionDialog.tsx` |
| `apps/desktop/src/components/skills/SkillsMarket.tsx` | `src/renderer/pages/Skills/index.tsx` |
| `apps/desktop/src/components/skills/SkillEditor.tsx` | `src/renderer/pages/Skills/SkillEditor.tsx` |
| `apps/desktop/src/components/shared/Onboarding.tsx` | `src/renderer/pages/Onboarding/index.tsx` |
| `apps/desktop/src/components/layout/AppShell.tsx` | `src/renderer/components/layout/AppShell.tsx` |
| `apps/desktop/src/components/layout/NavSidebar.tsx` | `src/renderer/components/layout/NavSidebar.tsx` |

### Server

| 旧路径 | 新路径 |
|---|---|
| `packages/server/src/index.ts` | `src/server/index.ts` |
| `packages/server/src/app.ts` | `src/server/app.ts` |
| `packages/server/src/routes/chat.route.ts` | `src/server/routes/chat.route.ts` |
| `packages/server/src/routes/sessions.route.ts` | `src/server/routes/sessions.route.ts` |
| `packages/server/src/routes/personas.route.ts` | `src/server/routes/personas.route.ts` |
| `packages/server/src/routes/settings.route.ts` | `src/server/routes/settings.route.ts` |
| `packages/server/src/routes/tools.route.ts` | `src/server/routes/tools.route.ts` |
| `packages/server/src/routes/skills.route.ts` | `src/server/routes/skills.route.ts` |
| `packages/server/src/services/tool.service.ts` | `src/server/services/tool.service.ts` |
| `packages/server/src/services/skill.service.ts` | `src/server/services/skill.service.ts` |
| `packages/server/src/db/client.ts` | `src/server/db/client.ts` |
| `packages/server/src/db/repositories/session.repo.ts` | `src/server/db/repositories/session.repo.ts` |
| `packages/server/src/db/repositories/message.repo.ts` | `src/server/db/repositories/message.repo.ts` |
| `packages/server/src/db/repositories/persona.repo.ts` | `src/server/db/repositories/persona.repo.ts` |
| `packages/server/src/db/repositories/tool.repo.ts` | `src/server/db/repositories/tool.repo.ts` |
| `packages/server/src/db/repositories/skill.repo.ts` | `src/server/db/repositories/skill.repo.ts` |
| `packages/server/src/middleware/index.ts` | `src/server/middleware/index.ts` |

### packages/ui 处理

`packages/ui/src` 是旧版共享 UI，不作为主线迁移。处理策略：

| 旧路径 | 新路径 | 处理 |
|---|---|---|
| `packages/ui/src/App.tsx` | 不迁移 | 旧版 App，避免覆盖 v0.2 |
| `packages/ui/src/components/*` | 不迁移 | 若有缺失组件再人工对照 |
| `packages/ui/src/stores/index.ts` | 不迁移 | 旧版 store，避免覆盖 v0.2 |
| `packages/ui/src/lib/platform.ts` | 不迁移 | 与 desktop 版本重复 |
| `packages/ui/src/lib/utils.ts` | 对照合并 | 仅补充缺失工具函数 |
| `packages/ui/src/lib/schemas/index.ts` | 对照合并到 `src/shared/schemas/index.ts` | 不能直接覆盖 |
| `packages/ui/src/styles/global.css` | 不迁移 | 以 desktop 样式为准 |

## 12. 验证计划

### 自动验证

每个阶段至少运行：

```bash
npm run typecheck
```

迁移完成后运行：

```bash
npm run build
```

后端单独验证：

```bash
npm run start:server
```

### 手动功能验收

```txt
1. 应用启动
   - Electron 主窗口正常打开
   - 本地 server 自动启动
   - /health 返回 ok

2. Chat
   - 会话列表正常加载
   - 可创建新会话
   - 可发送消息
   - SSE 流式返回正常
   - 消息能持久化

3. Personas
   - 角色列表正常加载
   - 可创建、编辑、删除自定义角色

4. Settings
   - API key 能保存
   - 主题切换正常
   - 设置刷新后仍保留

5. Tools
   - 工具列表正常加载
   - 工具详情正常显示
   - Tool Test Runner 能执行工具
   - 权限弹窗正常
   - tool_runs 正常记录

6. Skills
   - Skills Market 正常显示
   - 可安装/卸载 Skill
   - 可运行 Skill
   - skill_runs 正常记录

7. Electron 能力
   - Alt+Space 打开悬浮窗
   - 托盘菜单正常
   - 剪贴板读取正常
   - 外链打开正常

8. Onboarding
   - 首次启动显示
   - 完成后不再反复弹出
```

## 13. 推荐执行顺序

```txt
1. 合并 package/config
2. 迁移 server 到 src/server，先跑通 /health
3. 迁移 main/preload，保证 Electron 能启动 server
4. 迁移 renderer，保证页面能渲染
5. 迁移 shared schema/types/constants
6. 修复所有 import 和 alias
7. 跑 typecheck/build/dev
8. 完成功能手动验收
9. 暂存或删除旧 apps/packages
```

## 14. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| import 大面积失效 | 构建失败 | 先移动文件但保留相似目录名，逐步替换 alias |
| `packages/ui` 覆盖现有 UI | v0.2 页面倒退 | 明确以 `apps/desktop/src` 为主，`packages/ui` 只参考 |
| server fork 路径错误 | Electron 启动后 API 不可用 | 先单独跑 `npm run start:server`，再接入 main |
| preload 路径错误 | `window.bloomai` 不存在 | 单独检查 `contextBridge` 暴露对象 |
| sql.js 数据路径变化 | 历史数据丢失或新建空库 | 保持 `DATA_DIR` 和 `DB_PATH` 逻辑不变 |
| 构建输出相对路径变化 | 生产包不能启动 server | 检查 `dist-electron` 输出结构后修正 `ServerProcessService` |

## 15. 完成定义

迁移完成必须满足：

```txt
npm run typecheck 通过
npm run build 通过
npm run dev 能启动 Electron
本地 server /health 正常
Chat / Personas / Settings / Tools / Skills / Onboarding 页面可用
旧 @bloomai/ui 和 @bloomai/server 引用清零
旧 apps/desktop 和 packages 路径引用清零
旧目录删除或明确移入 _legacy
```

迁移完成后，再考虑进行第二阶段代码整理，例如拆分 ToolService、SkillService、store、middleware。第一阶段不要把“目录迁移”和“业务重构”混在一起。
