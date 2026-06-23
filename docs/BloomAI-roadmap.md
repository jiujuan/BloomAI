# BloomAI — Product Roadmap

> **BloomAI** 是一款本地优先的 AI 桌面助手，集智能聊天、多 Agent、Skill 市场、工作流自动化、工具系统于一体。
> 技术栈：Electron + Vite + React + Zustand + Zod + shadcn/ui + Tailwind CSS + Express + SQLite3 + node:sqlite + dbmate + Mastra.ai + AI SDK

---

## 版本命名约定

| 版本   | 代号        | 核心主题           | 目标用户阶段   |
|--------|-------------|-------------------|--------------|
| v0.1   | Seedling    | 智能聊天引擎        | 内测 10 人    |
| v0.2   | Sprout      | Skills 市场 + 工具系统 | 公开 Alpha 200 人 |
| v0.3   | Bloom       | Multi-Agent        | Beta 1,000 人 |
| v0.4   | Flourish    | 工作流自动化        | v1.0 正式发布 5,000 人 |

---

## 全局架构约定（所有 Roadmap 共享）

```
bloomai/                              # monorepo root
├── apps/
│   └── desktop/                      # Electron 桌面应用
│       ├── electron/                 # 主进程
│       └── src/                      # Renderer（复用 packages/ui）
├── packages/
│   ├── ui/                           # 共享前端组件 + Zustand stores
│   ├── core/                         # 业务逻辑（零平台依赖）
│   └── server/                       # Express 后端
├── package.json                      # workspace root (pnpm)
└── turbo.json
```

### 平台抽象层（platform.ts）
```
packages/ui/lib/platform.ts
  isElectron ? IPC : fetch/SSE
```
桌面 ↔ Web 切换只改这一个文件，其余代码不感知平台。

---

---

# Roadmap v0.1 — Seedling

## 🎯 阶段目标

**核心目标**：打通从用户输入到 AI 流式回复的完整链路，建立工程骨架，可以流畅多轮对话，角色和模型可切换。

**里程碑**：内部 Demo 可演示 → 内测 10 名用户 → 收集基础可用性反馈。

**KPI**：
- 唤醒到第一个 token ≤ 500ms
- 流式输出无卡顿（P99 chunk 间隔 ≤ 50ms）
- 会话历史本地持久化，重启后可恢复
- 内测用户 DAU ≥ 5

---

## 程序目录结构（v0.1 新建）

```
bloomai/
├── apps/
│   └── desktop/
│       ├── electron/
│       │   ├── main.ts               # NEW 主进程入口
│       │   ├── preload.ts            # NEW contextBridge IPC 暴露
│       │   ├── tray.ts               # NEW 系统托盘
│       │   ├── shortcuts.ts          # NEW 全局快捷键注册
│       │   └── ipc/
│       │       ├── index.ts          # NEW IPC 路由注册总入口
│       │       ├── chat.ipc.ts       # NEW 聊天 IPC handler
│       │       └── settings.ipc.ts   # NEW 设置 IPC handler
│       ├── src/
│       │   ├── main.tsx              # NEW Renderer 入口
│       │   └── app.tsx               # NEW App 根组件
│       ├── vite.config.ts            # NEW
│       └── electron-builder.config.ts# NEW
│
├── packages/
│   ├── ui/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.tsx      # NEW 整体布局（侧边导航+内容区）
│   │   │   │   └── NavSidebar.tsx    # NEW 52px 图标导航栏
│   │   │   ├── chat/
│   │   │   │   ├── ChatPanel.tsx     # NEW 主聊天面板
│   │   │   │   ├── SessionList.tsx   # NEW 会话列表（左侧 196px）
│   │   │   │   ├── Timeline.tsx      # NEW 消息时间线
│   │   │   │   ├── MessageBubble.tsx # NEW 消息气泡（user/bot/system）
│   │   │   │   ├── InputBar.tsx      # NEW 输入框 + 工具按钮
│   │   │   │   ├── StreamingText.tsx # NEW 流式文字渲染 + 光标
│   │   │   │   ├── CodeBlock.tsx     # NEW 代码块 + 复制/运行
│   │   │   │   └── ContextPills.tsx  # NEW 上下文 pill 组件
│   │   │   ├── persona/
│   │   │   │   ├── PersonaPicker.tsx # NEW 角色选择下拉
│   │   │   │   └── PersonaEditor.tsx # NEW 角色预设编辑器
│   │   │   ├── settings/
│   │   │   │   └── SettingsPage.tsx  # NEW 设置页（模型/快捷键/外观）
│   │   │   └── shared/
│   │   │       ├── Toggle.tsx        # NEW
│   │   │       ├── Badge.tsx         # NEW
│   │   │       └── EmptyState.tsx    # NEW 空状态组件
│   │   ├── stores/
│   │   │   ├── chat.store.ts         # NEW Zustand 聊天状态
│   │   │   ├── session.store.ts      # NEW 会话列表状态
│   │   │   ├── settings.store.ts     # NEW 设置状态
│   │   │   └── ui.store.ts           # NEW UI 状态（侧边栏/主题）
│   │   ├── hooks/
│   │   │   ├── useStream.ts          # NEW SSE 流式消费 hook
│   │   │   └── useHotkey.ts          # NEW 快捷键监听 hook
│   │   └── lib/
│   │       ├── platform.ts           # NEW 平台抽象（IPC vs fetch）
│   │       └── schemas/
│   │           ├── chat.schema.ts    # NEW Zod 类型定义
│   │           └── settings.schema.ts# NEW
│   │
│   ├── core/
│   │   ├── agents/
│   │   │   └── chat.agent.ts         # NEW Mastra chatAgent 工厂
│   │   ├── context/
│   │   │   └── context-builder.ts    # NEW 上下文构建（历史+剪贴板+活跃窗口）
│   │   └── model-router/
│   │       └── router.ts             # NEW 多模型路由（claude/gpt/ollama）
│   │
│   └── server/
│       ├── app.ts                    # NEW Express 应用工厂
│       ├── routes/
│       │   ├── chat.route.ts         # NEW POST /api/v1/chat/stream
│       │   ├── sessions.route.ts     # NEW CRUD /api/v1/sessions
│       │   └── settings.route.ts     # NEW GET/PATCH /api/v1/settings
│       ├── services/
│       │   └── chat.service.ts       # NEW 聊天业务逻辑
│       ├── db/
│       │   ├── client.ts             # NEW node:sqlite 封装
│       │   ├── migrations/
│       │   │   ├── 001_sessions.sql  # NEW
│       │   │   ├── 002_messages.sql  # NEW
│       │   │   └── 003_personas.sql  # NEW
│       │   └── repositories/
│       │       ├── session.repo.ts   # NEW
│       │       ├── message.repo.ts   # NEW
│       │       └── persona.repo.ts   # NEW
│       └── middleware/
│           ├── error.ts              # NEW 统一错误处理
│           ├── validate.ts           # NEW Zod 请求校验
│           └── stream.ts             # NEW SSE 流式响应工具
│
├── package.json                      # NEW workspace root
└── turbo.json                        # NEW
```

---

## UI 界面蓝图（v0.1）

### 主界面 — 聊天

```
┌──────────────────────────────────────────────────────────────────┐
│  BloomAI                                          [─] [□] [✕]   │
├────┬───────────────────┬────────────────────────────────────────┤
│    │ 🔍 [搜索会话…] [+] │ 💬 Python SMTP 脚本  [Developer▼][claude-sonnet▼][⋯]│
│ 💬 ├─────────────────── ├────────────────────────────────────────┤
│    │ 今天               │ 上下文: [VS Code · main.py ×][📋 代码 ×][+ 添加]  │
│ 📁 │ ● Python SMTP 脚本 ├────────────────────────────────────────┤
│    │   加了重试逻辑…    │                                        │
│ ✅ │ ● Q2 报告摘要      │  ── 今天 2026-06-05 ──                 │
│    │   核心指标增长…    │                                        │
│ ⚡ │ ● 重构 auth 模块   │  [你] 写一个 Python SMTP 发邮件脚本   │
│    │   JWT 存在 race…   │       支持附件和多收件人   09:14       │
│ 🧠 │ 昨天               │                                        │
│    │ ● 东京旅行计划     │  [🤖] 好的！以下是完整示例：           │
│ ⚙️ │   推荐新宿→浅草…  │       ┌─── Python ──[复制][▶运行]───┐  │
│    │ ● 产品周报初稿     │       │ import smtplib             │  │
│    │   本周完成3个…     │       │ from email.mime…           │  │
│    │                   │       └────────────────────────────┘  │
│    │                   │       [👍][👎][↩引用][复制]  09:14     │
│    │                   │                                        │
│    │                   │  [你] 加上指数退避重试   09:16         │
│    │                   │                                        │
│    │                   │  [🤖] 用 tenacity 实现最优雅…▌         │
│    │                   │       （流式输出中）                   │
│    │                   │                                        │
│    ├─────────────────── ├────────────────────────────────────────┤
│    │ tokens: ████░░ 2,286│ [📎][🎤][/]  输入消息，或 / 命令… [▶]│
│    │ /8,192 claude-s    │ tokens: ████░░░ 2,286 / 8,192          │
└────┴───────────────────┴────────────────────────────────────────┘
```

### 角色预设编辑器

```
┌─── 角色预设 ──────────────────────────────────────────────────┐
│  [← 返回]  角色预设管理                                        │
├──────────────────┬──────────────────────────────────────────── │
│ D  Developer     │  🟣 Developer                    [复制][保存]│
│ W  Writer        │ ─────────────────────────────────────────── │
│ A  Analyst       │ 角色名称                                     │
│ T  Translator    │ ┌─────────────────────────────────────────┐ │
│ C  Coach         │ │ Developer                               │ │
│ ─────────────── │ └─────────────────────────────────────────┘ │
│ [+ 新建角色]     │ System Prompt                               │
│                  │ ┌─────────────────────────────────────────┐ │
│                  │ │ You are an expert software engineer…    │ │
│                  │ │ {{activeApp}} {{clipboardContent}}      │ │
│                  │ └─────────────────────────────────────────┘ │
│                  │ 默认模型                                     │
│                  │ [claude-sonnet-4-5 ✓] [claude-opus] [local]│
│                  │ 能力开关                                     │
│                  │ 上下文感知  [●─────] ON                     │
│                  │ 知识库检索  [───●  ] OFF                    │
└──────────────────┴────────────────────────────────────────────┘
```

### 设置页面

```
┌─── 设置 ──────────────────────────────────────────────────────┐
│  [模型] [快捷键] [外观] [隐私] [关于]                          │
├────────────────────────────────────────────────────────────────┤
│  活跃模型                                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ● claude-sonnet-4-5   Cloud · Anthropic    [✓ 已选中]    │  │
│  │ ● claude-opus-4-6     Cloud · Anthropic                  │  │
│  │ ◐ llama3:8b           Local · Ollama                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│  API Keys                                                       │
│  Anthropic  [sk-ant-••••••••3f9a     ] [测试连接]              │
│  OpenAI     [sk-...               ] [测试连接]                 │
│                                                                  │
│  快捷键                                                         │
│  唤醒悬浮窗    ⌥ Space                [修改]                   │
│  新建会话      ⌘ N                    [修改]                   │
│  切换主题      ⌘ Shift D              [修改]                   │
│                                                                  │
│  行为设置                                                       │
│  剪贴板监控   [●] ON   自动感知复制内容                         │
│  上下文感知   [●] ON   注入活跃窗口信息                         │
│  语音唤醒     [○] OFF  "Hey BloomAI"                           │
└────────────────────────────────────────────────────────────────┘
```

### 首次启动 Onboarding

```
┌─── BloomAI 初始设置 ──────────────── ● ○ ○ ○  1/4 ───────────┐
│                                                                  │
│  [← 返回]     AI 模型配置                    [稍后再说]         │
│  ─────────────────────────────────────────────────────────────  │
│  ① 欢迎  ② 模型配置 ③ 系统权限 ④ 快捷键                        │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  🔑 Anthropic API Key                                           │
│  ┌──────────────────────────────────┐  [测试]                  │
│  │ sk-ant-api03-••••••••••••3f9a   │                            │
│  └──────────────────────────────────┘                           │
│  ✅ 连接成功 · claude-sonnet-4-5 可用                           │
│                                                                  │
│  选择默认模型                                                    │
│  ┌──────────────────┐ ┌──────────────────┐                     │
│  │ claude-sonnet    │ │ claude-opus      │                     │
│  │ ✓ 推荐 · 均衡    │ │   最强 · 较慢    │                     │
│  └──────────────────┘ └──────────────────┘                     │
│  ┌──────────────────┐ ┌──────────────────┐                     │
│  │ GPT-4o          │ │ Llama3 (本地)    │                     │
│  │   OpenAI         │ │   隐私优先       │                     │
│  └──────────────────┘ └──────────────────┘                     │
│                                                                  │
│                              [上一步]  [继续 →]                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 功能清单（v0.1）

### P0 必须完成
- [x] 全局快捷键唤醒悬浮窗（⌥ Space）
- [x] 多轮对话（SSE 流式输出）
- [x] 会话创建/切换/删除
- [x] 消息历史本地持久化（SQLite）
- [x] 角色预设（Persona）管理
- [x] 多模型路由（Claude / GPT / Ollama）
- [x] 系统托盘常驻
- [x] Context Pills（剪贴板 + 活跃窗口）
- [x] 代码块高亮 + 复制按钮
- [x] 首次启动 Onboarding（4步）
- [x] 设置页（API Key / 快捷键 / 外观）
- [x] 深色/浅色主题切换

### P1 本阶段完成
- [x] 会话搜索
- [x] 会话按日期分组
- [x] Token 用量实时显示
- [x] 消息操作（复制/重新生成/点赞点踩）
- [x] 空状态设计（4个页面）

---

## 核心功能任务

### Task 1 — 工程骨架初始化
```
pnpm init → turbo.json → workspace packages
electron-builder 配置
vite.config.ts (renderer + main)
tsconfig.json 各包配置
dbmate 初始化
```

### Task 2 — IPC 桥接
```
preload.ts → contextBridge.exposeInMainWorld
  - ipcRenderer.invoke   → 请求/响应
  - ipcRenderer.stream   → AsyncGenerator SSE
  - clipboard.readText   → 读取剪贴板
  - getActiveWindow      → 获取活跃窗口
  - dialog.showOpenDialog → 文件选择
platform.ts 根据 isElectron 决策路由
```

### Task 3 — Mastra Chat Agent
```typescript
// packages/core/agents/chat.agent.ts
export function createChatAgent(persona: Persona) {
  return new Agent({
    name: `bloom-${persona.id}`,
    instructions: persona.systemPrompt,
    model: anthropic(persona.modelOverride ?? 'claude-sonnet-4-5'),
    tools: {},   // v0.1 暂无工具，v0.2 加入
  });
}
```

### Task 4 — SSE 流式路由
```typescript
// POST /api/v1/chat/stream
// 1. 构建上下文（历史+剪贴板+活跃窗口）
// 2. 创建/获取 Mastra agent
// 3. agent.stream() → textStream
// 4. for await chunk → res.write SSE
// 5. [DONE] → 持久化 message
```

### Task 5 — Zustand Store 设计
```typescript
// chat.store.ts
interface ChatStore {
  sessions: Session[]
  activeSessionId: string | null
  messages: Record<string, Message[]>
  streamingText: string
  isStreaming: boolean
  sendMessage: (content: string) => Promise<void>
  createSession: () => Promise<Session>
  deleteSession: (id: string) => Promise<void>
}
```

---

## 核心接口（v0.1）

```
POST   /api/v1/chat/stream                # SSE 流式对话
GET    /api/v1/sessions                   # 会话列表
POST   /api/v1/sessions                   # 新建会话
DELETE /api/v1/sessions/:id               # 删除会话
GET    /api/v1/sessions/:id/messages      # 消息历史（分页）
GET    /api/v1/personas                   # 角色列表
POST   /api/v1/personas                   # 创建角色
PATCH  /api/v1/personas/:id               # 更新角色
DELETE /api/v1/personas/:id               # 删除角色
GET    /api/v1/settings                   # 读取设置
PATCH  /api/v1/settings                   # 更新设置
```

---

## 数据库迁移文件（v0.1 新建）

```sql
-- 001_sessions.sql
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '新对话',
  persona_id TEXT REFERENCES personas(id),
  model      TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 002_messages.sql
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content    TEXT NOT NULL,
  tool_calls TEXT,
  tokens     INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);

-- 003_personas.sql
CREATE TABLE personas (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  system_prompt  TEXT NOT NULL,
  model_override TEXT,
  is_builtin     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
INSERT INTO personas VALUES
  ('developer','Developer','You are an expert software engineer...','claude-sonnet-4-5',1,unixepoch()),
  ('writer','Writer','You are a professional content writer...','claude-sonnet-4-5',1,unixepoch()),
  ('analyst','Analyst','You are a data analyst...','claude-opus-4-6',1,unixepoch());

-- 004_settings.sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
INSERT INTO settings VALUES
  ('model','claude-sonnet-4-5',unixepoch()),
  ('theme','system',unixepoch()),
  ('shortcut_overlay','Alt+Space',unixepoch());
```

---

## 测试策略（v0.1）

### 单元测试（Vitest）
```
packages/core/agents/chat.agent.test.ts    # Agent 创建/Persona 注入
packages/core/context/context-builder.test.ts # 上下文构建逻辑
packages/server/routes/chat.route.test.ts  # SSE 路由
packages/server/db/repositories/*.test.ts  # Repo CRUD
packages/ui/stores/chat.store.test.ts      # Zustand store actions
```

### E2E 测试（Playwright + Electron）
```
发送消息 → 收到流式回复 → 持久化验证
新建会话 → 切换会话 → 历史恢复
切换模型 → 流式回复使用新模型
角色切换 → system prompt 更新验证
```

### 手动验收测试
```
1. 冷启动 → 快捷键 → 悬浮窗 ≤ 500ms
2. 发送消息 → 流式回复无断流
3. 重启 App → 历史会话完整
4. 断网 → 优雅错误提示
```

---

## 本阶段【禁止】修改或新增的功能/文件

```
❌ packages/core/tools/          # v0.2 才建
❌ packages/core/agents/skills.* # v0.2 才建
❌ packages/core/workflows/      # v0.4 才建
❌ packages/server/routes/agents.route.ts   # v0.3 才建
❌ packages/server/routes/workflows.route.ts# v0.4 才建
❌ apps/desktop/src/pages/FileManager.tsx   # v0.2 才建
❌ apps/desktop/src/pages/Tasks.tsx         # v0.3 才建
❌ apps/desktop/src/pages/Automation.tsx    # v0.4 才建
❌ 任何 RAG/向量数据库相关代码             # 不在本轮计划内
```

---

## 验收清单（v0.1 ✅ Done 条件）

```
□ pnpm dev 一键启动，Electron 窗口正常打开
□ 快捷键 ⌥ Space 唤醒悬浮窗，延迟 ≤ 500ms
□ 发送消息，流式回复正常渲染，光标动画正确
□ 代码块语法高亮，复制按钮可用
□ 新建/切换/删除会话，数据库持久化
□ 重启 App，历史会话恢复
□ 3 个内置角色可切换，System Prompt 生效
□ 多模型切换（claude-sonnet / claude-opus / gpt-4o）
□ Settings 页 API Key 保存到 Keychain
□ Onboarding 4 步流程走通
□ 深色/浅色主题切换
□ 单元测试覆盖率 ≥ 60%
□ 构建产物 pnpm build 无报错
```

---

---

# Roadmap v0.2 — Sprout

## 🎯 阶段目标

**核心目标**：构建完整 Tools 系统（22 个工具）+ Skills 市场（安装/创建/运行），让对话具备调用外部能力的基础。

**里程碑**：公开 Alpha，Product Hunt 发布，目标 200 下载量。

**KPI**：
- Tool 调用成功率 ≥ 97%
- Skill 安装到可用 ≤ 5s
- 7 日留存率 ≥ 40%
- NPS ≥ 30

---

## 程序目录结构（v0.2 新增）

```
bloomai/
├── packages/
│   ├── core/
│   │   ├── tools/                          # NEW 完整工具系统
│   │   │   ├── index.ts                    # NEW 统一导出
│   │   │   ├── registry.ts                 # NEW ToolRegistry 单例
│   │   │   ├── base.tool.ts                # NEW BaseTool 抽象基类
│   │   │   ├── web/
│   │   │   │   ├── web-search.tool.ts      # NEW SearXNG 搜索
│   │   │   │   ├── web-fetch.tool.ts       # NEW Playwright 抓取
│   │   │   │   ├── web-screenshot.tool.ts  # NEW 网页截图
│   │   │   │   └── web-extract.tool.ts     # NEW 结构化提取
│   │   │   ├── fs/
│   │   │   │   ├── bash.tool.ts            # NEW 白名单 shell
│   │   │   │   ├── read.tool.ts            # NEW 文件读取
│   │   │   │   ├── write.tool.ts           # NEW 文件写入
│   │   │   │   ├── edit.tool.ts            # NEW 精准编辑
│   │   │   │   ├── grep.tool.ts            # NEW 正则搜索
│   │   │   │   └── glob.tool.ts            # NEW 路径匹配
│   │   │   ├── document/
│   │   │   │   ├── markdown.tool.ts        # NEW marked 解析
│   │   │   │   ├── pdf.tool.ts             # NEW pdf-parse
│   │   │   │   ├── txt.tool.ts             # NEW 纯文本+编码检测
│   │   │   │   ├── csv.tool.ts             # NEW papaparse
│   │   │   │   └── docx.tool.ts            # NEW mammoth
│   │   │   ├── multimodal/
│   │   │   │   ├── vision.tool.ts          # NEW Claude vision
│   │   │   │   ├── ocr.tool.ts             # NEW Tesseract.js
│   │   │   │   ├── image-gen.tool.ts       # NEW DALL-E 3
│   │   │   │   └── image-edit.tool.ts      # NEW sharp
│   │   │   └── execution/
│   │   │       ├── node-runner.tool.ts     # NEW node:vm 沙箱
│   │   │       ├── python-runner.tool.ts   # NEW 受限子进程
│   │   │       └── shell.tool.ts           # NEW 全 shell（高危）
│   │   │
│   │   └── skills/                         # NEW Skills 系统
│   │       ├── skill-runner.ts             # NEW SkillRunner（3 种类型）
│   │       └── skill-validator.ts          # NEW 参数 schema 验证
│   │
│   ├── ui/
│   │   └── components/
│   │       ├── chat/
│   │       │   └── ToolCallCard.tsx        # NEW Tool 调用卡片（3态）
│   │       ├── tools/
│   │       │   ├── ToolManagePage.tsx      # NEW 工具管理页
│   │       │   ├── ToolDetailPage.tsx      # NEW 工具详情
│   │       │   ├── ToolTestRunner.tsx      # NEW 手动测试面板
│   │       │   └── PermissionDialog.tsx    # NEW 权限弹窗（低/中/高危）
│   │       └── skills/
│   │           ├── SkillsMarket.tsx        # NEW Skills 市场页
│   │           ├── SkillCard.tsx           # NEW 市场 Skill 卡片
│   │           ├── SkillEditor.tsx         # NEW 自建 Skill 编辑器
│   │           └── SkillRunner.tsx         # NEW 手动运行 Skill
│   │
│   └── server/
│       ├── routes/
│       │   ├── tools.route.ts              # NEW 工具管理 API
│       │   └── skills.route.ts             # NEW Skills CRUD + 运行
│       ├── services/
│       │   ├── tool.service.ts             # NEW 权限检查+执行封装
│       │   └── skill.service.ts            # NEW Skill 安装/运行
│       └── db/
│           └── migrations/
│               ├── 005_tools.sql           # NEW tools + tool_runs + permissions
│               └── 006_skills.sql          # NEW skills + skill_runs
```

---

## UI 界面蓝图（v0.2 新增）

### 工具管理页

```
┌─── 工具管理 ─────────────────────────────────────────────────────┐
│  🔧 工具管理     [🔍 搜索工具…]  [权限]  [运行历史]               │
├────────────────────────────────────────────────────────────────── │
│  总数 22  |  已启用 18  |  今日调用 1,247  |  待授权 2            │
├──────────────────────────────────────────────────────────────────│
│  [全部▼] [Web] [文件系统] [文档] [多模态] [执行]                  │
├──────────────────────────────────────────────────────────────────│
│  🌐 Web 工具 (4)                                                 │
│  ┌────────────────────────┐  ┌────────────────────────┐         │
│  │ 🌐 web_search          │  │ 🔗 web_fetch           │         │
│  │    [network]  342次/今 │  │    [network]  89次/今  │         │
│  │                 [●] ON │  │                 [●] ON │         │
│  └────────────────────────┘  └────────────────────────┘         │
│  📁 文件系统 (6)                                                  │
│  ┌────────────────────────┐  ┌─── ⚠️ bash ──────────┐          │
│  │ 📄 fs_read [fs·只读]  │  │    [shell·高危]       │          │
│  │                 [●] ON │  │    需授权     [●] ON  │          │
│  └────────────────────────┘  └────────────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
```

### 权限弹窗（三种）

```
低风险                    中风险                    高风险
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ 📁 文件系统访问  │   │ 🌐 网络访问      │   │ 💻 Shell 访问    │
│ fs_read 请求权限 │   │ web_fetch 请求   │   │ shell 请求权限   │
│ ● 低风险·只读   │   │ ⚠ 中风险·外部   │   │ 🔴 高风险·谨慎  │
│─────────────────│   │─────────────────│   │──────────────────│
│ · 读取指定文件  │   │ 将访问以下 URL: │   │⚠️ 可执行任意命令 │
│ · 限家目录      │   │ docs.anthropic… │   │ · 读写删除文件  │
│ · 不可写入      │   │ · 仅此 URL      │   │ · 发起网络请求  │
│─────────────────│   │─────────────────│   │──────────────────│
│ [仅本次✓][永久] │   │ [仅URL✓][此域名]│   │ [仅本次✓][永久] │
│─────────────────│   │─────────────────│   │──────────────────│
│  [拒绝]  [允许] │   │ [拒绝]  [允许]  │   │[拒绝][了解风险,允许]│
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

### Skills 市场页

```
┌─── Skills ──────────────────────────────────────────────────────┐
│  🧩 Skills   [🔍 搜索 skills…]   [筛选]   [+ 创建 Skill]       │
├──────────────┬──────────────────────────────────────────────────┤
│ 分类         │  已安装 (4)                             [查看全部]│
│ 全部 (47) ✓ │  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ 网络搜索 (8)│  │ 🌐       │ │ 📝       │ │ ⭐       │        │
│ 文本处理(12)│  │web_search│ │summarizer│ │小红书关键词│        │
│ 代码工具 (9)│  │官方      │ │官方      │ │我创建的   │        │
│ 数据分析 (6)│  │HTTP      │ │Prompt    │ │JS        │        │
│ ─────────── │  │[✓ 已安装]│ │[✓ 已安装]│ │[✓ 已安装]│        │
│ 来源         │  └──────────┘ └──────────┘ └──────────┘        │
│ 市场         │  市场推荐                               [查看全部]│
│ 我创建的     │  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ 已安装       │  │ 📊       │ │ ✅       │ │ 🐙       │        │
│              │  │data      │ │readabil- │ │github    │        │
│              │  │analyzer  │ │ity check │ │search    │        │
│              │  │↓2.3k     │ │↓1.8k     │ │↓4.1k     │        │
│              │  │[+ 安装]  │ │[+ 安装]  │ │[+ 安装]  │        │
│              │  └──────────┘ └──────────┘ └──────────┘        │
└──────────────┴──────────────────────────────────────────────────┘
```

### 对话中的 Tool Call 卡片

```
running 状态:
┌─ 🌐 web_search ──────────────── [⟳ 搜索中] ────────────────────[∨]┐
│  参数: query="Mastra workflow TypeScript"  limit=8                  │
│  正在请求 SearXNG…  ████████░░░░░░░░                               │
└──────────────────────────────────────────────────────────────────── ┘

success 状态:
┌─ 🌐 web_search ────────────── [✓ 完成] 432ms · 6条 ────────────[∧]┐
│  参数: query="Mastra workflow TypeScript"                            │
│  结果(前2条):                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Mastra — The TypeScript AI Framework                        │   │
│  │ mastra.ai/docs  搜索结果摘要…                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  [复制结果]  [打开链接]                                              │
└──────────────────────────────────────────────────────────────────── ┘

error 状态:
┌─ 💻 bash ─────────────────── [✕ 失败] 8.0s·超时 ──────────────[∧]┐
│  参数: command="find ~/Projects -name '*.ts'"                       │
│  Error: Command timed out after 8000ms  exit: 143                   │
│  [重试]  [修改参数]  [跳过此工具]                                    │
└──────────────────────────────────────────────────────────────────── ┘
```

---

## 功能清单（v0.2）

### P0 必须完成
- [x] 22 个内置工具全部实现并注册
- [x] BaseTool 基类（超时+持久化+Mastra 适配）
- [x] ToolRegistry 单例
- [x] 三级权限系统（只读默认/写入确认/Shell 永久授权）
- [x] 权限弹窗 UI（低/中/高 三种）
- [x] Tool Call 卡片（running/success/error 三态）
- [x] 工具管理页（启用/禁用/详情）
- [x] Skills 市场 UI（安装/卸载/搜索）
- [x] Skill 编辑器（JS function / HTTP API / Prompt Template）
- [x] Skill 手动测试运行

### P1 本阶段完成
- [x] 工具运行历史页（全局监控 + 统计）
- [x] 工具详情页（schema + 使用统计 + 挂载 Agent）
- [x] 工具测试运行面板
- [x] Chat Agent 自动挂载已安装 Skills

---

## 核心功能任务

### Task 1 — BaseTool + ToolRegistry
```typescript
// packages/core/tools/base.tool.ts
abstract class BaseTool<TInput, TOutput> {
  abstract id: string
  abstract description: string
  abstract inputSchema: ZodSchema<TInput>
  abstract outputSchema: ZodSchema<TOutput>
  abstract run(input: TInput): Promise<TOutput>

  toMastraTool(): MastraTool {
    return createTool({
      id: this.id,
      description: this.description,
      inputSchema: this.inputSchema,
      execute: async ({ context }) => {
        const run = await toolRunRepo.start(this.id, context)
        try {
          const result = await Promise.race([
            this.run(context as TInput),
            timeout(15_000, 'Tool timeout'),
          ])
          await toolRunRepo.complete(run.id, result)
          return result
        } catch (e) {
          await toolRunRepo.fail(run.id, String(e))
          throw e
        }
      },
    })
  }
}
```

### Task 2 — 三级权限检查
```typescript
// 权限等级: 'readonly' | 'write' | 'shell'
// 执行前检查 → 未授权 → 发 IPC 事件 → 前端弹窗 → 用户选择 → 写入 DB
async function checkPermission(toolId: string, level: PermLevel) {
  const perm = await permRepo.get(toolId)
  if (perm?.granted) return true
  // 发送 permission-request 事件到 renderer
  const granted = await ipcMain.emit('permission:request', { toolId, level })
  if (granted) await permRepo.grant(toolId, scope)
  return granted
}
```

### Task 3 — SkillRunner 三种类型
```typescript
type SkillType = 'js-function' | 'http-api' | 'prompt-template'

// js-function: node:vm 沙箱，timeout 5s
// http-api: fetch + 参数替换模板
// prompt-template: 直接调用 chatAgent.generate()
```

---

## 核心接口（v0.2 新增）

```
GET    /api/v1/tools                        # 工具列表
GET    /api/v1/tools/:id                    # 工具详情
POST   /api/v1/tools/:id/run                # 手动测试运行
GET    /api/v1/tools/:id/runs               # 运行历史
GET    /api/v1/tools/permissions            # 权限状态
POST   /api/v1/tools/permissions/:id/grant  # 授予
POST   /api/v1/tools/permissions/:id/revoke # 撤销

GET    /api/v1/skills                       # 已安装 Skill
GET    /api/v1/skills/market                # 市场（分页+搜索）
POST   /api/v1/skills/install               # 从市场安装
POST   /api/v1/skills                       # 创建自定义
GET    /api/v1/skills/:id                   # 详情+schema
PATCH  /api/v1/skills/:id                   # 更新
DELETE /api/v1/skills/:id                   # 卸载
POST   /api/v1/skills/:id/run               # 手动运行
GET    /api/v1/skills/:id/runs              # 运行历史
```

---

## 数据库迁移（v0.2 新增）

```sql
-- 005_tools.sql
CREATE TABLE tools (
  id                  TEXT PRIMARY KEY,
  category            TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL,
  params_schema       TEXT NOT NULL,
  result_schema       TEXT NOT NULL,
  is_builtin          INTEGER DEFAULT 1,
  is_enabled          INTEGER DEFAULT 1,
  requires_permission TEXT,
  created_at          INTEGER NOT NULL
);
CREATE TABLE tool_runs (
  id           TEXT PRIMARY KEY,
  tool_id      TEXT NOT NULL REFERENCES tools(id),
  session_id   TEXT REFERENCES sessions(id),
  input_json   TEXT NOT NULL,
  output_json  TEXT,
  status       TEXT NOT NULL,
  error_msg    TEXT,
  duration_ms  INTEGER,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER
);
CREATE TABLE tool_permissions (
  id         TEXT PRIMARY KEY,
  tool_id    TEXT NOT NULL REFERENCES tools(id),
  granted    INTEGER DEFAULT 0,
  granted_at INTEGER,
  scope      TEXT DEFAULT 'session'
);

-- 006_skills.sql
CREATE TABLE skills (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('js-function','http-api','prompt-template')),
  source        TEXT NOT NULL,
  params_schema TEXT NOT NULL,
  author        TEXT,
  version       TEXT DEFAULT '1.0.0',
  is_public     INTEGER DEFAULT 0,
  install_count INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE TABLE skill_runs (
  id           TEXT PRIMARY KEY,
  skill_id     TEXT NOT NULL REFERENCES skills(id),
  input_json   TEXT NOT NULL,
  output_json  TEXT,
  status       TEXT NOT NULL,
  duration_ms  INTEGER,
  created_at   INTEGER NOT NULL
);
```

---

## 测试策略（v0.2）

```
packages/core/tools/web/web-search.tool.test.ts   # mock SearXNG 响应
packages/core/tools/fs/read.tool.test.ts          # 沙箱文件读取
packages/core/tools/execution/node-runner.test.ts # vm 沙箱隔离验证
packages/core/skills/skill-runner.test.ts         # 三种类型全覆盖
packages/server/routes/tools.route.test.ts        # 权限拦截逻辑
```

**重点测试场景**：
- vm 沙箱无法访问 fs/network（安全测试）
- 工具超时 15s 后正确抛出 + 持久化 error 状态
- 权限弹窗在同一 session 内只弹一次

---

## 本阶段【禁止】修改的文件

```
❌ packages/core/agents/chat.agent.ts 中的 Persona 逻辑（仅增加 tools 注入）
❌ packages/server/db/migrations/001-004.sql（只增不改）
❌ packages/ui/components/chat/（只增 ToolCallCard，不改现有组件）
❌ packages/core/workflows/    # v0.4 才建
❌ 任何 Agent 相关路由          # v0.3 才建
```

---

## 验收清单（v0.2）

```
□ 22 个工具全部注册到 ToolRegistry
□ web_search 调用成功返回结果
□ fs_read 读取本地文件
□ vision 分析图片返回描述
□ bash 白名单命令执行，非白名单命令被拦截
□ node_runner 沙箱无法访问 require('fs')
□ 工具超时 15s 后回报 error 状态
□ 权限弹窗在首次调用 fs_write/shell 时弹出
□ 高危权限弹窗显示红色警告
□ Tool Call 卡片 running/success/error 三态正确
□ Skills 市场可浏览，安装后挂载到 Chat Agent
□ 自建 js-function Skill 可在沙箱运行
□ 工具管理页启用/禁用开关生效
□ 工具运行历史可查询
□ 单元测试覆盖率 ≥ 65%
```

---

---

# Roadmap v0.3 — Bloom

## 🎯 阶段目标

**核心目标**：Multi-Agent 系统上线，含小红书种草 Agent、公众号写作 Agent，支持自定义 Agent 配置（挂载 Skills/Tools），Agent 市场发布。

**里程碑**：Beta 发布，目标 1,000 活跃用户，NPS ≥ 35。

**KPI**：
- Agent 首次运行成功率 ≥ 95%
- 市场 Agent 模板 ≥ 10 个
- 用户自建 Agent 平均 ≥ 3 个/人
- 30 日留存率 ≥ 30%

---

## 程序目录结构（v0.3 新增）

```
bloomai/
├── packages/
│   ├── core/
│   │   └── agents/
│   │       ├── chat.agent.ts              # MODIFY 增加 tools 注入
│   │       ├── agent-factory.ts           # NEW Agent 工厂
│   │       ├── registry/
│   │       │   └── agent-registry.ts      # NEW Agent 注册表
│   │       └── templates/
│   │           ├── xiaohongshu.agent.ts   # NEW 小红书种草 Agent
│   │           ├── wechat-article.agent.ts# NEW 公众号写作 Agent
│   │           ├── code-reviewer.agent.ts # NEW 代码审查 Agent
│   │           ├── data-analyst.agent.ts  # NEW 数据分析 Agent
│   │           └── translator.agent.ts    # NEW 翻译 Agent
│   │
│   ├── ui/
│   │   └── components/
│   │       ├── agents/
│   │       │   ├── AgentMarket.tsx        # NEW Agent 市场
│   │       │   ├── AgentCard.tsx          # NEW 市场卡片
│   │       │   ├── AgentDetail.tsx        # NEW Agent 详情页
│   │       │   ├── AgentEditor.tsx        # NEW 自定义 Agent 编辑器
│   │       │   ├── AgentToolPicker.tsx    # NEW Tools/Skills 挂载选择器
│   │       │   ├── AgentRunHistory.tsx    # NEW Agent 运行历史
│   │       │   └── AgentSelector.tsx      # NEW 对话中切换 Agent
│   │       └── chat/
│   │           └── AgentStepCard.tsx      # NEW Agent 步骤卡片
│   │
│   └── server/
│       ├── routes/
│       │   └── agents.route.ts            # NEW Agent CRUD + 流式运行
│       ├── services/
│       │   └── agent.service.ts           # NEW Agent 业务逻辑
│       └── db/
│           └── migrations/
│               └── 007_agents.sql         # NEW agents + agent_runs
```

---

## UI 界面蓝图（v0.3 新增）

### Agent 市场

```
┌─── Agent 市场 ───────────────────────────────────────────────────┐
│  🤖 Agents  [🔍 搜索 agents…]  [筛选]  [+ 创建 Agent]           │
├──────────────┬───────────────────────────────────────────────────│
│ 分类         │  我的 Agent (3)                        [管理]      │
│ 全部 ✓       │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│ 内容创作 (8) │  │ 📝       │  │ 📰       │  │ 🔍       │       │
│ 代码工具 (6) │  │小红书    │  │公众号    │  │代码审查  │       │
│ 数据分析 (4) │  │种草助手  │  │写作助手  │  │助手      │       │
│ 翻译 (3)     │  │4 tools   │  │3 tools   │  │6 tools   │       │
│ 搜索 (5)     │  │[▶ 运行]  │  │[▶ 运行]  │  │[▶ 运行]  │       │
│ ──────────── │  └──────────┘  └──────────┘  └──────────┘       │
│ 来源         │  市场推荐                              [查看全部]  │
│ 官方 ✓       │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│ 社区         │  │ 📊       │  │ 🌐       │  │ ✍️      │       │
│ 我创建的     │  │数据分析  │  │竞品调研  │  │邮件助手  │       │
│              │  │专家      │  │Agent     │  │          │       │
│              │  │官方      │  │社区 ⭐4.8│  │官方      │       │
│              │  │↓3.2k     │  │↓1.9k     │  │↓2.7k     │       │
│              │  │[+ 安装]  │  │[+ 安装]  │  │[+ 安装]  │       │
│              │  └──────────┘  └──────────┘  └──────────┘       │
└──────────────┴───────────────────────────────────────────────────┘
```

### Agent 编辑器

```
┌─── 配置 Agent ──────────────────────────────────────────────────┐
│  [← 返回]  配置 Agent 工具                          [保存]      │
├──────────────────┬──────────────────────────────────────────────│
│ 已挂载工具 (4)   │  [全部] [Web] [文件] [文档] [多模态] [执行]  │
│                  │  搜索: [🔍 搜索工具…]                        │
│ 🌐 web_search   │  ─────────────────────────────────────────── │
│ 👁 vision       │  🌐 Web 工具                                  │
│ 📄 doc_pdf      │  ┌──────────────────────────────────────┐    │
│ 📝 doc_txt      │  │ 🌐 web_search  [network]  ✓已挂载    │    │
│ ─────────────── │  │    搜索互联网，返回排名结果            │    │
│ AI 建议:         │  └──────────────────────────────────────┘    │
│ 建议加入         │  ┌──────────────────────────────────────┐    │
│ image_gen 和     │  │ 🔗 web_fetch  [network]   [+ 挂载]   │    │
│ web_fetch        │  │    抓取网页正文和结构化内容            │    │
│                  │  └──────────────────────────────────────┘    │
│                  │  👁 多模态工具                                 │
│                  │  ┌──────────────────────────────────────┐    │
│                  │  │ 👁 vision  [network]  ✓已挂载        │    │
│                  │  │ 🖼 image_gen [network]  [+ 挂载]     │    │
│                  │  └──────────────────────────────────────┘    │
│                  │  ─────────────────────────────────────────── │
│                  │  已挂载 4 个 · 建议同一 Agent ≤12 个         │
└──────────────────┴──────────────────────────────────────────────┘
```

### Agent 运行中（对话视图）

```
[你] 帮我写一篇关于"极简主义生活"的小红书笔记

[🌸 小红书种草助手] ────────────────────────────────────────────
│ ┌─ 🌐 web_search ──────────────────── [✓ 完成] 389ms ──[∧]┐   │
│ │ query="极简主义生活 小红书 2026 流行"                     │   │
│ │ 找到 8 条热门话题，#极简生活 阅读量 2.3亿                 │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ 🖼 image_gen ─────────────────── [✓ 完成] 3.9s ──[∧]──┐  │
│ │ prompt="极简风格白色居家照，暖调自然光"                    │  │
│ │ [图片预览] xhs-cover.png · 1024×1024                      │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                               │
│ 📝 正在生成笔记…▌                                             │
└───────────────────────────────────────────────────────────────┘
```

---

## 功能清单（v0.3）

### P0 必须完成
- [x] Agent 注册表（AgentRegistry）
- [x] Agent 工厂（动态 tools 注入）
- [x] 5 个内置 Agent 模板（小红书/公众号/代码审查/数据分析/翻译）
- [x] Agent 配置界面（System Prompt + 模型 + Tools 挂载）
- [x] Agent 市场 UI（浏览/安装/评分）
- [x] 对话中 Agent 切换（AgentSelector）
- [x] Agent 运行历史

### P1 本阶段完成
- [x] Agent 步骤卡片（多步推理可视化）
- [x] Agent 发布到市场（自定义 Agent 发布）
- [x] Agent 运行统计（成功率/平均耗时）

---

## 核心功能任务

### Task 1 — 小红书 Agent 系统 Prompt
```typescript
export const xiaohongshuAgentConfig: AgentConfig = {
  name: '小红书种草助手',
  type: 'xiaohongshu',
  systemPrompt: `你是一名专业的小红书内容创作者。
风格：标题≤15字含emoji·正文300-500字分段·标签8-12个
步骤：搜索话题热度→提炼卖点→撰写正文→生成标签→配图建议
{{productInfo}} {{userDemand}}`,
  defaultTools: ['web_search', 'image_gen', 'web_fetch'],
  defaultSkills: ['keyword-extract'],
  model: 'claude-sonnet-4-5',
}
```

### Task 2 — Agent 流式运行路由
```typescript
// POST /api/v1/agents/:id/run/stream
router.post('/:id/run/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  const agent = await agentRepo.get(req.params.id)
  const tools = toolRegistry.toMastraTools(agent.toolIds)
  const skills = await skillRepo.getByIds(agent.skillIds)
  const skillTools = Object.fromEntries(
    skills.map(s => [s.name, skillRunner.toMastraTool(s)])
  )
  const mastraAgent = createChatAgent(agent, { ...tools, ...skillTools })
  const run = await agentRunRepo.create({ agentId: agent.id })

  const stream = await mastraAgent.stream(
    [{ role: 'user', content: req.body.input }],
    {
      onStepFinish: async (step) => {
        res.write(`data: ${JSON.stringify({ type: 'step', step })}\n\n`)
        await agentRunRepo.addStep(run.id, step)
      },
    }
  )
  for await (const chunk of stream.textStream) {
    res.write(`data: ${JSON.stringify({ type: 'delta', text: chunk })}\n\n`)
  }
  await agentRunRepo.complete(run.id, stream.text)
  res.write('data: [DONE]\n\n')
  res.end()
})
```

---

## 核心接口（v0.3 新增）

```
GET    /api/v1/agents                       # Agent 列表
POST   /api/v1/agents                       # 创建 Agent
GET    /api/v1/agents/:id                   # Agent 详情
PATCH  /api/v1/agents/:id                   # 更新 Agent
DELETE /api/v1/agents/:id                   # 删除 Agent
POST   /api/v1/agents/:id/run/stream        # 流式运行（SSE）
GET    /api/v1/agents/:id/runs              # 运行历史
GET    /api/v1/agents/:id/runs/:runId       # 单次运行详情
POST   /api/v1/agents/:id/publish           # 发布到市场
GET    /api/v1/agents/market                # 市场 Agent 列表
POST   /api/v1/agents/market/:id/install    # 从市场安装
```

---

## 数据库迁移（v0.3 新增）

```sql
-- 007_agents.sql
CREATE TABLE agents (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'custom',
  description  TEXT,
  system_prompt TEXT NOT NULL,
  model        TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
  tool_ids     TEXT NOT NULL DEFAULT '[]',
  skill_ids    TEXT NOT NULL DEFAULT '[]',
  config_json  TEXT NOT NULL DEFAULT '{}',
  is_builtin   INTEGER DEFAULT 0,
  is_public    INTEGER DEFAULT 0,
  install_count INTEGER DEFAULT 0,
  enabled      INTEGER DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE agent_runs (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  session_id  TEXT REFERENCES sessions(id),
  input       TEXT NOT NULL,
  output      TEXT,
  steps_json  TEXT DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'running',
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);
```

---

## 测试策略（v0.3）

```
packages/core/agents/xiaohongshu.agent.test.ts  # 输出格式验证（标题/标签/字数）
packages/core/agents/agent-factory.test.ts       # tools/skills 正确注入
packages/server/routes/agents.route.test.ts      # SSE 步骤事件验证
E2E: 完整运行小红书 Agent → 验证 web_search + image_gen 均被调用
E2E: 切换 Agent → 对话 System Prompt 更新
```

**重点测试**：
- Agent 调用 tool 失败时继续推理而非崩溃
- 并发运行多个 Agent 不互相干扰

---

## 本阶段【禁止】修改的文件

```
❌ packages/core/tools/（工具系统已稳定，禁止改动）
❌ packages/core/skills/（只读，不改）
❌ packages/server/db/migrations/001-006.sql（只增不改）
❌ packages/core/workflows/                  # v0.4 才建
❌ apps/desktop/src/pages/Automation.tsx     # v0.4 才建
```

---

## 验收清单（v0.3）

```
□ 5 个内置 Agent 模板全部可运行
□ 小红书 Agent 输出符合格式（标题≤15字/标签8-12个）
□ 公众号 Agent 输出有完整结构（开头+3-5节+结尾）
□ Agent 运行时 Tool Call 卡片正常展示步骤
□ Agent 配置界面可挂载/取消挂载工具
□ Agent 市场可浏览、安装市场 Agent
□ 用户可创建自定义 Agent 并发布到市场
□ 对话中 AgentSelector 切换生效
□ Agent 运行历史可查看步骤详情
□ 单元测试覆盖率 ≥ 70%
□ Agent 调用失败降级处理正确
```

---

---

# Roadmap v0.4 — Flourish

## 🎯 阶段目标

**核心目标**：工作流自动化引擎上线，支持自然语言生成工作流、可视化步骤编辑、Cron/事件触发、运行日志实时推送。完成 v1.0 质量标准：性能优化、安全审计、多语言。

**里程碑**：v1.0 正式发布，目标 5,000 活跃用户，NPS ≥ 45。

**KPI**：
- 工作流运行成功率 ≥ 98%
- NL → 工作流生成准确率 ≥ 80%（用户验收）
- DAU/MAU ≥ 40%
- 内存占用（后台待机）< 120MB
- P99 响应 < 500ms

---

## 程序目录结构（v0.4 新增）

```
bloomai/
├── packages/
│   ├── core/
│   │   └── workflows/                          # NEW 工作流引擎
│   │       ├── workflow-executor.ts            # NEW Mastra Workflow 构建+运行
│   │       ├── workflow-scheduler.ts           # NEW Cron + 事件触发调度
│   │       ├── workflow-generator.ts           # NEW NL → 工作流 AI 生成
│   │       └── templates/
│   │           ├── daily-digest.workflow.ts    # NEW 每日摘要
│   │           ├── weekly-report.workflow.ts   # NEW 周报生成
│   │           ├── clipboard-translate.workflow.ts  # NEW 剪贴板翻译
│   │           └── file-backup.workflow.ts     # NEW 文件备份
│   │
│   ├── ui/
│   │   └── components/
│   │       └── automation/
│   │           ├── AutomationPage.tsx          # NEW 自动化主页
│   │           ├── WorkflowList.tsx            # NEW 工作流列表
│   │           ├── WorkflowEditor.tsx          # NEW 步骤可视化编辑器
│   │           ├── WorkflowRunLog.tsx          # NEW 实时运行日志
│   │           ├── WorkflowGenerator.tsx       # NEW NL 生成工作流
│   │           └── TriggerConfig.tsx           # NEW 触发器配置
│   │
│   └── server/
│       ├── routes/
│       │   └── workflows.route.ts              # NEW 工作流 CRUD + 运行
│       ├── services/
│       │   └── workflow.service.ts             # NEW 工作流业务逻辑
│       └── db/
│           └── migrations/
│               └── 008_workflows.sql           # NEW workflows + runs + steps
```

---

## UI 界面蓝图（v0.4 新增）

### 工作流自动化主页

```
┌─── 自动化 ────────────────────────────────────────────────────────┐
│  ⚡ 自动化    [+ 新建工作流]  [📹 录制模式]  [我的工作流 (5)]       │
├──────────────┬────────────────────────────────────────────────────│
│ 我的工作流   │  每日邮件摘要                          [●] 活跃    │
│ ─────────── │  ─────────────────────────────────────────────────  │
│ ● 每日邮件   │  🤖 用自然语言描述你的工作流:                       │
│ ● 周报生成   │  ┌────────────────────────────────────────────┐   │
│ ● 剪贴板翻译 │  │ 每天早上9点，读取未读邮件，AI摘要后推送通知 │   │
│ ○ 截图 OCR  │  └────────────────────────────────────────────┘   │
│ ● 项目备份   │                              [解析工作流 ▶]        │
│              │  执行步骤:                                         │
│              │  ①  ⏰ 触发器    cron: 0 9 * * *                   │
│              │  │                                                  │
│              │  ②  📧 获取邮件  tool: emailFetch · 24h未读        │
│              │  │                                                  │
│              │  ③  🤖 AI 摘要  agent: chatAgent · 3句话摘要       │
│              │  │                                                  │
│              │  ④  🔔 推送通知  tool: notify + 写入任务           │
│              │                                                      │
│              │  上次运行日志:                                       │
│              │  09:00:01 ▶ workflow started                        │
│              │  09:00:02 emailFetch — 7 unread                     │
│              │  09:00:04 chatAgent.generate — summarizing…         │
│              │  09:00:06 ✓ notify sent · 2 tasks saved             │
│              │                                                      │
│              │              [测试运行]  [保存并启用]               │
└──────────────┴────────────────────────────────────────────────────┘
```

### 自然语言生成工作流

```
┌─── NL 生成工作流 ──────────────────────────────────────────────┐
│  🪄 描述你想自动化的任务                                        │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 每周五下午5点，整理本周修改过的代码文件，生成变更摘要，    │ │
│  │ 并发送邮件给团队                                          │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                              [生成工作流 ▶]    │
│  ─────────────────────────────────────────────────────────────  │
│  AI 解析结果:                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 触发: 每周五 17:00 (cron: 0 17 * * 5)                 │   │
│  │ ①  fs_glob — 扫描本周修改文件 (*.ts *.py *.go)        │   │
│  │ ②  fs_read — 读取变更内容                              │   │
│  │ ③  chatAgent — 生成变更摘要（按模块分类）              │   │
│  │ ④  emailFetch → emailSend — 发送给团队                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [编辑步骤]  [直接启用]                                         │
└────────────────────────────────────────────────────────────────┘
```

---

## 功能清单（v0.4）

### P0 必须完成
- [x] Mastra Workflow 集成（串行/并行/分支）
- [x] Cron 触发器（定时执行）
- [x] 事件触发器（剪贴板/文件变化/快捷键）
- [x] 步骤可视化编辑器
- [x] 运行日志实时推送（WebSocket）
- [x] NL → 工作流 AI 生成
- [x] 4 个内置工作流模板
- [x] 工作流运行历史

### P1 本阶段完成
- [x] 录制模式（录制操作 → 生成脚本）
- [x] 工作流暂停/继续/取消
- [x] 多语言支持（中/英）
- [x] 性能优化（后台 < 120MB）
- [x] 安全审计（权限最小化）

---

## 核心功能任务

### Task 1 — 工作流执行器
```typescript
// packages/core/workflows/workflow-executor.ts
export async function buildMastraWorkflow(wf: WorkflowRecord) {
  const stepDefs: Step[] = JSON.parse(wf.stepsJson).map(step =>
    new Step({
      id: step.id,
      execute: async ({ context }) => {
        if (step.agentId) {
          const agent = await agentRepo.get(step.agentId)
          const tools = toolRegistry.toMastraTools(agent.toolIds)
          const ma = createChatAgent(agent, tools)
          const prompt = renderTemplate(step.promptTemplate, context)
          const result = await ma.generate(prompt)
          return { output: result.text, context: { ...context, [step.id]: result.text } }
        }
        if (step.toolId) {
          const tool = toolRegistry.get(step.toolId)
          const input = renderParams(step.params, context)
          return tool.run(input)
        }
      },
    })
  )
  return stepDefs.reduce(
    (wfb, step, i) => i === 0 ? wfb.step(step) : wfb.then(step),
    new Workflow({ name: wf.id }).step(stepDefs[0])
  ).commit()
}
```

### Task 2 — Cron 调度器
```typescript
// packages/core/workflows/workflow-scheduler.ts
export async function startScheduler() {
  const workflows = await workflowRepo.getAllEnabled()
  for (const wf of workflows) {
    if (wf.triggerType === 'cron') {
      cron.schedule(wf.triggerConfig, () => runWorkflow(wf.id, {}))
    }
    if (wf.triggerType === 'clipboard') {
      clipboardWatcher.on('change', () => runWorkflow(wf.id, { content: clipboard.readText() }))
    }
  }
}
```

### Task 3 — NL 生成工作流
```typescript
// packages/core/workflows/workflow-generator.ts
export async function generateFromNL(description: string): Promise<WorkflowDraft> {
  const agent = createChatAgent(workflowDesignerPersona, {})
  const result = await agent.generate(`
    用户需求: ${description}
    请生成 JSON 格式的工作流定义，包含 trigger 和 steps 数组。
    steps 中每个 step 可使用以下工具: ${toolRegistry.list().map(t => t.id).join(', ')}
  `)
  return JSON.parse(result.text)
}
```

---

## 核心接口（v0.4 新增）

```
GET    /api/v1/workflows                    # 工作流列表
POST   /api/v1/workflows                    # 创建工作流
GET    /api/v1/workflows/:id                # 工作流详情
PATCH  /api/v1/workflows/:id                # 更新
DELETE /api/v1/workflows/:id                # 删除
POST   /api/v1/workflows/:id/run            # 立即触发
POST   /api/v1/workflows/:id/pause          # 暂停
POST   /api/v1/workflows/:id/resume         # 继续
GET    /api/v1/workflows/:id/runs           # 运行历史
GET    /api/v1/workflows/runs/:runId        # 步骤详情
POST   /api/v1/workflows/generate           # NL 生成工作流

WS     /ws/agent                            # 工作流实时状态推送
```

---

## 数据库迁移（v0.4 新增）

```sql
-- 008_workflows.sql
CREATE TABLE workflows (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  trigger_type   TEXT NOT NULL CHECK(trigger_type IN ('cron','event','manual','webhook')),
  trigger_config TEXT NOT NULL DEFAULT '{}',
  steps_json     TEXT NOT NULL DEFAULT '[]',
  enabled        INTEGER DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE TABLE workflow_runs (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  status      TEXT NOT NULL DEFAULT 'running',
  context_json TEXT NOT NULL DEFAULT '{}',
  error_msg   TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE workflow_steps (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES workflow_runs(id),
  step_id     TEXT NOT NULL,
  agent_run_id TEXT REFERENCES agent_runs(id),
  status      TEXT NOT NULL,
  output_json TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);
```

---

## 测试策略（v0.4）

```
packages/core/workflows/workflow-executor.test.ts  # 串行/并行/分支逻辑
packages/core/workflows/workflow-scheduler.test.ts # Cron 调度准时性
packages/core/workflows/workflow-generator.test.ts # NL 解析准确率
packages/server/routes/workflows.route.test.ts     # CRUD + 触发

E2E: 创建每日摘要工作流 → 手动触发 → 验证步骤全部完成
E2E: NL 输入 → 生成工作流定义 → 解析步骤结构正确
E2E: 工作流步骤失败 → 后续步骤正确中断 + 日志记录

性能测试:
  后台待机内存 < 120MB
  工作流触发到第一步执行 ≤ 200ms
  10 个并发工作流不互相干扰
```

---

## 本阶段【禁止】修改的文件

```
❌ packages/core/tools/（已稳定，只能新增工具不改框架）
❌ packages/core/agents/templates/（只能新增模板）
❌ packages/server/db/migrations/001-007.sql（只增不改）
❌ packages/ui/lib/platform.ts（平台抽象层已定型）
```

---

## 验收清单（v0.4 = v1.0 发布标准）

```
□ 4 个内置工作流模板全部可运行
□ Cron 工作流准时触发（误差 ≤ 1s）
□ 步骤编辑器可增删改步骤
□ NL 生成的工作流结构准确率 ≥ 80%
□ 工作流运行日志 WebSocket 实时推送
□ 工作流失败后步骤状态正确标记
□ 后台待机内存 < 120MB（Activity Monitor 验证）
□ 全量 E2E 通过（包含 v0.1-v0.4 所有场景）
□ 单元测试覆盖率 ≥ 75%
□ pnpm build 产物可安装并正常运行
□ 中英双语界面切换正确
□ 安全审计通过（权限最小化 / API Key Keychain 存储）
□ NPS 问卷准备就绪（10 名 Beta 用户填写）
□ Product Hunt 发布素材准备完毕
```

---

---

## 跨版本依赖关系总结

```
v0.1 Seedling (工程骨架 + 聊天)
  └─ 为 v0.2 提供: sessions / messages / personas 表, IPC 桥接, platform.ts

v0.2 Sprout (Tools + Skills)
  └─ 为 v0.3 提供: ToolRegistry, BaseTool, SkillRunner, 权限系统

v0.3 Bloom (Multi-Agent)
  └─ 为 v0.4 提供: AgentRegistry, agent_runs 表, 流式 Agent 运行

v0.4 Flourish (Workflow)
  └─ 串联所有前置模块: Agent + Tools + Skills → 工作流步骤
```

## 全局不变约定

```
1. 数据库迁移只增不改（dbmate up only）
2. platform.ts 是唯一平台感知文件
3. 所有路由统一前缀 /api/v1
4. Zod schema 是前后端唯一类型真相来源
5. 每个 Roadmap 的"禁止修改文件"必须严格遵守
6. 新增功能优先写单元测试再实现（TDD）
```

---

*文档版本: v1.0 · 编写日期: 2026-06-10 · 维护: BloomAI PM Team*

---

---

# 附录 A — 依赖包清单（按版本引入）

## v0.1 核心依赖

### 桌面层（apps/desktop）
```jsonc
{
  "dependencies": {
    "electron": "^29.0.0",
    "electron-builder": "^24.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "vite-plugin-electron": "^0.28.0",
    "vite-plugin-electron-renderer": "^0.14.0"
  }
}
```

### 前端（packages/ui）
```jsonc
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0",
    "zod": "^3.23.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-tooltip": "^1.1.0",
    "@radix-ui/react-scroll-area": "^1.1.0",
    "tailwindcss": "^3.4.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0",
    "lucide-react": "^0.383.0",
    "react-markdown": "^9.0.0",
    "rehype-highlight": "^7.0.0",
    "remark-gfm": "^4.0.0"
  }
}
```

### 后端（packages/server）
```jsonc
{
  "dependencies": {
    "express": "^4.19.0",
    "@types/express": "^4.17.0",
    "better-sqlite3": "^9.6.0",
    "@mastra/core": "^0.3.0",
    "@ai-sdk/anthropic": "^0.0.40",
    "@ai-sdk/openai": "^0.0.40",
    "ai": "^3.3.0",
    "zod": "^3.23.0",
    "keytar": "^7.9.0",
    "winston": "^3.13.0"
  },
  "devDependencies": {
    "dbmate": "^2.16.0",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0"
  }
}
```

### 工程工具（根目录）
```jsonc
{
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "prettier": "^3.2.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.0.0",
    "playwright": "^1.44.0",
    "@playwright/test": "^1.44.0"
  }
}
```

---

## v0.2 新增依赖（Tools + Skills）

```jsonc
{
  "dependencies": {
    "playwright": "^1.44.0",            // web_fetch / web_screenshot
    "@mozilla/readability": "^0.5.0",   // web_fetch 正文提取
    "jsdom": "^24.0.0",                 // web_fetch DOM 解析
    "cheerio": "^1.0.0",               // web_extract
    "fast-glob": "^3.3.0",             // fs_glob
    "pdf-parse": "^1.1.1",             // doc_pdf
    "marked": "^12.0.0",               // doc_markdown
    "papaparse": "^5.4.0",             // doc_csv
    "mammoth": "^1.7.0",               // doc_docx
    "tesseract.js": "^5.1.0",          // ocr
    "sharp": "^0.33.0",                // image_edit
    "openai": "^4.52.0",               // image_gen (DALL-E 3)
    "node-fetch": "^3.3.0"             // image_gen 下载
  }
}
```

---

## v0.3 新增依赖（Multi-Agent）

```jsonc
{
  "dependencies": {
    "@mastra/core": "^0.4.0"           // 升级：支持 Agent 注册表
  }
}
```

---

## v0.4 新增依赖（Workflow）

```jsonc
{
  "dependencies": {
    "node-cron": "^3.0.0",             // Cron 调度
    "ws": "^8.17.0",                   // WebSocket 实时推送
    "@types/ws": "^8.5.0",
    "chokidar": "^3.6.0"               // 文件变化事件触发器
  }
}
```

---

---

# 附录 B — 数据库完整 Schema（汇总）

```
bloomai.db（SQLite 单文件，存于 ~/Library/Application Support/BloomAI/）

┌─────────────────────────────────────────────────────────────────┐
│                        核心表关系                                 │
│                                                                  │
│  personas ──< sessions ──< messages                             │
│                  │                                               │
│                  └──< agent_runs >── agents ──< skills          │
│                                          │                       │
│  workflows ──< workflow_runs             └──< tools             │
│                   └──< workflow_steps ──< agent_runs            │
│                                                                  │
│  tools ──< tool_runs                                             │
│  tools ──< tool_permissions                                      │
│  skills ──< skill_runs                                           │
└─────────────────────────────────────────────────────────────────┘

迁移文件顺序:
  001_sessions.sql     v0.1  sessions + messages + personas
  002_messages.sql     v0.1  （合并到 001）
  003_personas.sql     v0.1  （合并到 001）
  004_settings.sql     v0.1  settings
  005_tools.sql        v0.2  tools + tool_runs + tool_permissions
  006_skills.sql       v0.2  skills + skill_runs
  007_agents.sql       v0.3  agents + agent_runs
  008_workflows.sql    v0.4  workflows + workflow_runs + workflow_steps
```

---

---

# 附录 C — CI/CD 配置

## GitHub Actions 工作流

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
        node: [20]

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Run unit tests
        run: pnpm test --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

      - name: Build
        run: pnpm build
        env:
          NODE_ENV: production

  e2e:
    runs-on: macos-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - name: Install Playwright
        run: pnpm playwright install --with-deps
      - name: Run E2E tests
        run: pnpm test:e2e
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY_TEST }}

  build-release:
    runs-on: ${{ matrix.os }}
    needs: [test, e2e]
    if: startsWith(github.ref, 'refs/tags/v')
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - name: Build Electron app
        run: pnpm dist
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: bloomai-${{ matrix.os }}
          path: apps/desktop/dist/*.{dmg,exe,AppImage}
```

## turbo.json 完整配置

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".turbo/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:e2e": {
      "dependsOn": ["build"],
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {
      "outputs": []
    },
    "db:migrate": {
      "cache": false
    },
    "db:new": {
      "cache": false
    }
  }
}
```

## package.json 根目录脚本

```json
{
  "scripts": {
    "dev":          "turbo run dev",
    "dev:desktop":  "turbo run dev --filter=@bloomai/desktop",
    "build":        "turbo run build",
    "dist":         "turbo run build && electron-builder --config apps/desktop/electron-builder.config.ts",
    "test":         "turbo run test",
    "test:e2e":     "playwright test",
    "typecheck":    "turbo run typecheck",
    "lint":         "turbo run lint",
    "format":       "prettier --write .",
    "db:migrate":   "dbmate --url 'sqlite:./data/bloomai.db' up",
    "db:new":       "dbmate new",
    "db:reset":     "dbmate --url 'sqlite:./data/bloomai.db' drop && pnpm db:migrate",
    "prepare":      "husky"
  }
}
```

## 本地开发启动顺序

```bash
# 1. 安装依赖
pnpm install

# 2. 运行数据库迁移
pnpm db:migrate

# 3. 配置环境变量
cp .env.example .env.local
# 填写 ANTHROPIC_API_KEY, SEARXNG_URL 等

# 4. 启动开发环境（同时启动 Vite + Electron + Express）
pnpm dev:desktop

# 5. （可选）单独启动后端调试
cd packages/server && pnpm dev
```

## .env.example

```bash
# AI 模型
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# 本地工具依赖
SEARXNG_URL=http://localhost:8888     # web_search 后端
OLLAMA_URL=http://localhost:11434     # 本地 LLM

# 数据库
DATABASE_URL=sqlite:./data/bloomai.db

# 应用配置
NODE_ENV=development
LOG_LEVEL=debug
PORT=3718

# Electron
VITE_DEV_SERVER_URL=http://localhost:5173
```

---

---

# 附录 D — 开发规范

## 代码风格

```
语言:     TypeScript strict mode，禁用 any
格式化:   Prettier（单引号，无分号，行宽 100）
检查:     ESLint + @typescript-eslint/recommended
命名:
  变量/函数:  camelCase
  类/接口:    PascalCase
  常量:       SCREAMING_SNAKE_CASE
  文件:       kebab-case.tool.ts / kebab-case.store.ts
  路由文件:   feature.route.ts
  组件文件:   FeatureName.tsx
```

## Git 提交规范（Conventional Commits）

```
feat(chat): add streaming text component
fix(tools): handle timeout in web_fetch correctly
docs(roadmap): update v0.2 acceptance checklist
chore(deps): upgrade @mastra/core to 0.4.0
test(agents): add xiaohongshu agent format validation
refactor(ipc): simplify stream bridge logic
perf(ui): virtualize session list with @tanstack/react-virtual
style(chat): fix message bubble border radius on mobile

分支策略:
  main          → 发布分支，只接受 PR
  develop       → 集成分支
  feat/v0.x-*   → 功能分支（如 feat/v0.2-tools-system）
  fix/*         → 修复分支
  release/v0.x  → 发布准备分支
```

## 组件开发规范

```typescript
// 每个 React 组件文件的标准结构
// components/chat/MessageBubble.tsx

import { type FC } from 'react'
import { cn } from '@/lib/utils'

// 1. Props 接口（用 Zod 或 TypeScript interface）
interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system'
  content: string
  isStreaming?: boolean
  className?: string
}

// 2. 组件实现
export const MessageBubble: FC<MessageBubbleProps> = ({
  role,
  content,
  isStreaming = false,
  className,
}) => {
  return (
    <div className={cn('message-bubble', `message-bubble--${role}`, className)}>
      {content}
      {isStreaming && <span className="streaming-cursor" aria-hidden />}
    </div>
  )
}

// 3. 组件显示名（便于 DevTools 调试）
MessageBubble.displayName = 'MessageBubble'
```

## API 响应规范

```typescript
// 成功响应
{ "data": T, "meta"?: { "total": number, "page": number } }

// 错误响应
{
  "error": {
    "code": "VALIDATION_ERROR" | "NOT_FOUND" | "PERMISSION_DENIED" | "AI_ERROR" | "TOOL_TIMEOUT",
    "message": "Human-readable description",
    "details"?: ZodError["flatten"]
  }
}

// SSE 流式事件格式
data: {"type": "delta",  "text": "..."}
data: {"type": "step",   "step": {...}}      // Agent 工具调用步骤
data: {"type": "error",  "error": "..."}
data: [DONE]
```

## Zustand Store 规范

```typescript
// 每个 store 的标准结构
// stores/chat.store.ts

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// 1. State 接口
interface ChatState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Record<string, Message[]>
  streamingText: string
  isStreaming: boolean
}

// 2. Actions 接口
interface ChatActions {
  setActiveSession: (id: string) => void
  addMessage: (sessionId: string, message: Message) => void
  appendStreamChunk: (chunk: string) => void
  finalizeStream: () => void
  sendMessage: (content: string) => Promise<void>
}

// 3. 创建 Store（devtools + immer 中间件）
export const useChatStore = create<ChatState & ChatActions>()(
  devtools(
    immer((set, get) => ({
      // initial state
      sessions: [],
      activeSessionId: null,
      messages: {},
      streamingText: '',
      isStreaming: false,

      // actions
      setActiveSession: (id) => set(state => { state.activeSessionId = id }),

      appendStreamChunk: (chunk) =>
        set(state => { state.streamingText += chunk }),

      sendMessage: async (content) => {
        set(state => { state.isStreaming = true; state.streamingText = '' })
        try {
          const stream = await platform.chatStream({ content, sessionId: get().activeSessionId! })
          for await (const chunk of stream) {
            get().appendStreamChunk(chunk.text)
          }
        } finally {
          set(state => { state.isStreaming = false })
        }
      },
    })),
    { name: 'bloomai-chat' }
  )
)
```

## 错误处理规范

```typescript
// 前端：useStream hook 的错误边界
export function useStream() {
  const [error, setError] = useState<Error | null>(null)

  const stream = async (payload: ChatStreamPayload) => {
    setError(null)
    try {
      // ...streaming logic
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setError(err)
      // 对用户展示友好错误，不暴露内部细节
      toast.error(friendlyMessage(err.message))
    }
  }

  return { stream, error }
}

// 后端：统一错误中间件
// packages/server/middleware/error.ts
export const errorMiddleware: ErrorRequestHandler = (err, req, res, next) => {
  const statusCode = err.statusCode ?? 500
  const code = err.code ?? 'INTERNAL_ERROR'
  logger.error({ code, message: err.message, stack: err.stack, path: req.path })
  res.status(statusCode).json({ error: { code, message: err.message } })
}
```

---

---

# 附录 E — 技术风险与应对策略

## v0.1 技术风险

```
风险 1: Electron 沙箱与 IPC 权限
  - 现象: contextBridge 限制导致 Native API 无法直接访问
  - 应对: 所有系统 API 在主进程实现，通过 IPC 暴露给渲染进程
  - 备案: 禁用沙箱（降低安全性，仅开发期）

风险 2: AI SDK Streaming 兼容性
  - 现象: Mastra + AI SDK 流式 API 在 Node.js 主进程中表现不一致
  - 应对: 在 Express Server 子进程中运行，IPC 透传 chunk
  - 备案: 降级为轮询（非流式）

风险 3: SQLite 并发写入
  - 现象: 多个窗口同时写入可能导致 SQLITE_BUSY
  - 应对: node:sqlite WAL 模式 + 写入队列序列化
  - 备案: 单进程架构，所有 DB 操作通过 Express Server 中转
```

## v0.2 技术风险

```
风险 1: Playwright 内存占用
  - 现象: 每次 web_fetch 启动浏览器实例，内存峰值 > 300MB
  - 应对: 复用 browser 实例（Browser Pool，最多 2 个），闲置 5min 关闭
  - 备案: 降级为 node-fetch + cheerio（不处理 JS 渲染页面）

风险 2: vm 沙箱安全边界
  - 现象: node:vm 并非完全安全沙箱，恶意代码可能逃逸
  - 应对: 额外限制：无 require、无 process、无 global，超时 5s
  - 备案: 使用 isolated-vm（更安全的 V8 Isolate）替换

风险 3: Tesseract.js 首次加载慢
  - 现象: OCR 首次初始化需下载 ~15MB 语言包，体验差
  - 应对: 应用启动后后台预加载，显示初始化进度
  - 备案: 云端 OCR API 兜底（需网络）
```

## v0.3 技术风险

```
风险 1: Agent 工具数量限制
  - 现象: 挂载工具 > 15 个时模型 tool selection 准确率下降
  - 应对: 强制限制 Agent 最多挂载 12 个工具，UI 显示警告
  - 备案: 工具分组（仅传入最相关 Top-K 工具描述）

风险 2: 并发 Agent 运行资源争用
  - 现象: 多个工作流同时运行多个 Agent，API 限速触发
  - 应对: 全局 API 请求队列 + 指数退避重试
  - 备案: 降级为串行执行
```

## v0.4 技术风险

```
风险 1: Cron 调度精度
  - 现象: 系统休眠后 node-cron 任务不触发或延迟
  - 应对: 应用激活时检查 missed jobs，补偿执行
  - 备案: 使用系统级 cron（macOS launchd / Windows Task Scheduler）

风险 2: WebSocket 断连
  - 现象: 长时间运行的工作流（> 5min）WebSocket 连接断开
  - 应对: 心跳包（每 30s ping），断线重连自动订阅 run log
  - 备案: 轮询 /api/v1/workflows/runs/:runId（5s 间隔）

风险 3: NL 生成工作流准确率不稳定
  - 现象: 复杂描述生成的 steps JSON 结构错误
  - 应对: Zod 严格校验输出，失败时返回结构化错误引导用户修改
  - 备案: 提供固定模板让用户选择，NL 生成作为辅助
```

---

---

# 附录 F — 全局 UI 设计规范

## 设计 Token（CSS Variables）

```css
/* 颜色语义化 Token */
--color-background-primary:    /* 主背景 */
--color-background-secondary:  /* 次级背景（侧边栏/卡片） */
--color-background-tertiary:   /* 三级背景 */
--color-background-info:       /* 信息/操作背景（蓝） */
--color-background-success:    /* 成功状态背景（绿） */
--color-background-warning:    /* 警告状态背景（橙） */
--color-background-danger:     /* 危险状态背景（红） */

--color-text-primary:          /* 主文字 */
--color-text-secondary:        /* 次级文字 */
--color-text-tertiary:         /* 辅助文字（标签/时间） */
--color-text-info:             /* 信息文字 */
--color-text-success:          /* 成功文字 */
--color-text-warning:          /* 警告文字 */
--color-text-danger:           /* 危险文字 */

--color-border-primary:        /* 焦点边框 */
--color-border-secondary:      /* 普通边框 */
--color-border-tertiary:       /* 分隔线 */
--color-border-info:           /* 信息边框 */
--color-border-success:        /* 成功边框 */
--color-border-danger:         /* 危险边框 */

/* 圆角 */
--border-radius-sm:  4px
--border-radius-md:  6px
--border-radius-lg:  10px

/* 字体 */
--font-sans:    "Anthropic Sans", system-ui, sans-serif
--font-mono:    "JetBrains Mono", "Fira Code", monospace
```

## 布局规范

```
整体布局:       左侧导航(48px) + 会话列表(196px，可选) + 内容区(flex-1)
侧边导航宽度:   48px（图标 + tooltip）
会话列表宽度:   196px（固定）
最小窗口尺寸:   900px × 600px
悬浮窗尺寸:     380px × 可变高（最大 480px）
```

## 组件尺寸规范

```
Nav 图标按钮:   34×34px，border-radius: 6px
输入框高度:     32px（small）/ 36px（default）/ 40px（large）
按钮高度:       26px（xs）/ 30px（sm）/ 34px（md）/ 38px（lg）
Avatar 尺寸:    24px（sm）/ 32px（md）/ 40px（lg）
Tool 图标:      22×22px（inline）/ 28×28px（card）
Badge padding:  2px 8px，border-radius: 99px
```

## 图标规范

```
图标库:     Tabler Icons（ti-* 前缀，Outline 风格）
图标尺寸:   12px（inline badge）/ 14px（button）/ 16px（nav）/ 20px（hero）
所有图标必须添加 aria-hidden="true"
图标+文字时 gap: 5px
```

## 动效规范

```
悬浮窗出现:     slide-in from right，duration: 150ms，ease-out
模型切换下拉:   fade + scale，duration: 120ms
卡片折叠展开:   height transition，duration: 200ms，ease-in-out
流式光标:       blink 0.8s infinite（0%,100% opacity:1，50% opacity:0）
加载骨架:       pulse 1.4s ease infinite（0%,100% opacity:1，50% opacity:0.4）
Tool 权限弹窗:  backdrop-blur + fade-in，duration: 150ms
```

---

---

# 附录 G — 项目成功指标（全版本汇总）

## 技术指标

```
性能
  唤醒到悬浮窗出现        ≤ 150ms（热启动）/ ≤ 500ms（冷启动）
  第一个 SSE chunk 到达   ≤ 800ms（P50）/ ≤ 1500ms（P99）
  后台待机内存            < 120MB
  工具执行超时            15s（硬限制）
  DB 查询                 < 10ms（P99，有索引查询）

稳定性
  Tool 调用成功率         ≥ 97%
  Agent 运行成功率        ≥ 95%
  工作流运行成功率        ≥ 98%
  崩溃率                  < 0.1% 会话

代码质量
  单元测试覆盖率          ≥ 75%（v0.4 目标）
  TypeScript 严格模式     100% 无 any
  ESLint 零警告           CI 强制
```

## 产品指标

```
v0.1 内测
  内测用户数             ≥ 10
  DAU                    ≥ 5

v0.2 Alpha
  下载量                 ≥ 200
  7日留存率              ≥ 40%
  NPS                    ≥ 30

v0.3 Beta
  活跃用户数             ≥ 1,000
  30日留存率             ≥ 30%
  NPS                    ≥ 35
  用户自建 Agent/人均     ≥ 3

v0.4 v1.0
  活跃用户数             ≥ 5,000
  DAU/MAU                ≥ 40%
  NPS                    ≥ 45
  工作流使用率/DAU       ≥ 20%
```

---

---

# 附录 H — 快速参考卡

## 新增工具 3 步流程

```
Step 1: 新建文件
  packages/core/tools/{category}/my-tool.tool.ts
  继承 BaseTool，实现 id / description / inputSchema / outputSchema / run()

Step 2: 导出
  packages/core/tools/{category}/index.ts
  export { MyTool } from './my-tool.tool'

Step 3: 数据库 Seed
  packages/server/db/migrations/XXX_seed_tools.sql
  INSERT INTO tools (id, category, name, ...) VALUES (...)

ToolRegistry 在启动时自动扫描，无需手动注册。
```

## 新增 Agent 模板 2 步流程

```
Step 1: 新建模板文件
  packages/core/agents/templates/my-agent.agent.ts
  导出 AgentConfig 对象（name / systemPrompt / defaultTools / model）

Step 2: 数据库 Seed
  INSERT INTO agents (id, name, system_prompt, tool_ids, ...) VALUES (...)
```

## 新增数据库表流程

```bash
# 创建迁移文件
pnpm db:new add_my_feature

# 编辑 db/migrations/XXX_add_my_feature.sql
# 添加 CREATE TABLE 语句

# 运行迁移
pnpm db:migrate

# 创建 Repository
packages/server/db/repositories/my-feature.repo.ts
```

## 本地开发常用命令

```bash
pnpm dev:desktop          # 启动 Electron 开发环境
pnpm test                 # 运行所有单元测试
pnpm test:e2e             # 运行 E2E 测试（需先 build）
pnpm db:migrate           # 运行数据库迁移
pnpm db:reset             # 重置数据库（清空所有数据）
pnpm typecheck            # TypeScript 类型检查
pnpm lint                 # ESLint 检查
pnpm format               # Prettier 格式化
```

---

*文档版本: v1.1 · 最后更新: 2026-06-10 · 维护: BloomAI PM Team*
*下一次更新时机: v0.1 内测验收完成后*
