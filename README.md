# 🌸 BloomAI

> 一个本地优先的 AI 桌面工作台：把对话、研究、创作、工具调用和自动化任务集中在一个 Electron 应用中。

BloomAI 面向需要长期使用 AI 的个人用户和开发者。它既可以作为日常 Chat 客户端，也可以作为连接多家模型、网页工具、本地文件和自定义技能的可扩展工作台。

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [常用命令](#常用命令)
- [Windows 打包](#windows-打包)
- [数据与运行限制](#数据与运行限制)
- [项目结构](#项目结构)
- [架构概览](#架构概览)
- [测试与质量检查](#测试与质量检查)
- [故障排查](#故障排查)
- [开发文档](#开发文档)

## 项目简介

BloomAI 是一个 **Electron + React + TypeScript** 应用，前端提供桌面化工作区，后端在本地启动 Hono 服务并负责数据持久化、模型调用、工具执行、技能运行和定时任务调度。

项目的核心原则：

- **本地优先**：会话、项目、设置、任务和运行记录保存在本地数据目录中。
- **模型可替换**：通过设置页或配置接入云端模型、OpenAI-compatible 服务和本地 Ollama。
- **能力可控**：工具按权限和风险分级，文件写入、Shell 等高风险操作需要明确授权。
- **逐步增强**：基础聊天不依赖复杂工作流；需要时再启用联网、研究、工具、技能和自动化能力。

> BloomAI 仍在持续迭代中。部分能力依赖对应的模型、API Key、浏览器或本地运行时，具体以当前代码和设置页显示为准。

## 功能特性

### 1. Chat 对话工作区

- 流式对话和 Markdown 渲染。
- 会话、最近记录、项目和工作区管理。
- Personas（角色/人设）管理。
- 支持计划、推理过程、工具调用卡片和审批卡片等结构化消息。
- 支持 Markdown、DOCX、PDF、TXT、CSV 等附件解析。
- 支持快捷键创建新会话和打开设置。

### 2. 多模型与多 Provider

BloomAI 通过统一的 LLM 抽象管理文本、图像和视频模型。当前内置 Provider 包括：

- Anthropic
- OpenAI
- Agnes
- DeepSeek
- Ollama
- Google AI
- Together.ai
- Qwen（DashScope）
- 其他 OpenAI-compatible 服务

模型、Provider、Base URL、默认模型和启用状态可以在设置页中管理。使用 Ollama 时，可以直接连接本机的 Ollama 服务，不需要云端 API Key。

### 3. Deep Research 深度研究

- 将复杂问题拆解为研究计划和子问题。
- 执行网页搜索、网页抓取和页面内容提取。
- 展示研究进度、来源、证据、问题树和质量信息。
- 支持研究报告查看和中断运行恢复。
- 研究运行与普通 Chat 会话分离，便于追踪一次研究的完整生命周期。

### 4. AI 画图与文章配图

- Image Studio：生成图片、编辑图片、选择模型和画幅比例。
- 支持参考图、风格、模板和生成结果预览。
- 文章配图工作台：从文章内容提取配图需求，生成和管理插图。
- 支持图像理解（Vision）、OCR、图像生成和图像编辑工具。
- 图片能力取决于已配置的 Provider 和对应模型。

### 5. 内置 Tools 工具系统

当前工具注册表包含 25 个内置工具，覆盖以下类别：

| 类别 | 能力 |
| --- | --- |
| Web | 搜索、抓取网页、提取标题/链接/正文、网页截图 |
| 文件与工作区 | 读取、写入、编辑、应用补丁、文件信息、全文搜索、Grep、Glob |
| 文档 | Markdown、PDF、TXT、CSV、DOCX 内容解析 |
| 多模态 | Vision、OCR、图像生成、图像编辑 |
| 执行 | 受限 Bash、Node.js Runner、Python Runner、Shell |

工具在聊天中以结构化 Tool Call 卡片展示，支持运行中、成功和失败状态，并保留运行记录、统计信息和工具详情。

### 6. 权限与安全边界

- 工具声明自己的权限范围：文件读取、网络、写入、Shell 或沙箱执行。
- 只读和低风险能力可以自动执行；写入和 Shell 等高风险操作需要确认或显式授权。
- JavaScript 技能和 Node Runner 在受限的 VM 沙箱中运行，不能直接使用 require、process 或文件系统。
- 文件路径、URL、输出大小、运行时长和并发量都有边界控制。
- 工具运行默认采用硬超时，避免单个调用长期占用应用。

请不要把 BloomAI 的工具权限授予不可信的 Prompt，也不要在未审查输入的情况下运行删除数据、发布内容或其他高风险自动化操作。

### 7. Skills 技能管理

Skills Admin 当前面向 **Package Runtime**，用于管理可安装、可版本化、可授权和可观察的技能包：

- 技能包目录、导入、版本、安装和生命周期管理。
- 自定义技能 Draft 的校验、预览和发布。
- 技能运行状态、事件、Artifacts 和审计记录查看。
- 能力授权、运行时隔离和失败恢复。

Legacy Skills 不再作为用户可管理的市场、安装或运行功能。仍需处理的旧数据只能通过开发/发布流程中的一次性、离线、只读迁移验证脚本处理，不能作为应用用户功能调用。

### 8. 定时任务

定时任务与 Chat 会话平级，每个任务拥有独立的 Prompt、Cron 表达式、时区和运行历史。

支持：

- 新建、编辑、暂停、恢复和删除任务。
- 按 IANA 时区配置执行时间，例如 Asia/Shanghai。
- “立即执行”一次性触发。
- 查看任务级运行历史和错误信息。

常用 Cron 示例：

| 表达式 | 含义 |
| --- | --- |
| 0 9 * * * | 每天 09:00 |
| 0 9 * * 1-5 | 每个工作日 09:00 |
| 0 9 * * 1 | 每周一 09:00 |
| 0 0 1 * * | 每月 1 日 00:00 |

## 快速开始

### 环境要求

- Node.js >= 22.16.0
- npm
- Windows、macOS 或 Linux
- 至少一个可用的 LLM Provider：云端 API Key 或本地 Ollama

### 1. 获取代码并安装依赖

~~~bash
git clone https://github.com/jiujuan/BloomAI.git
cd BloomAI
npm ci
~~~

### 2. 创建本地配置

服务端当前默认读取项目根目录的 .env 文件。请复制示例文件并填写至少一个模型 Provider：

#### macOS / Linux / Git Bash

~~~bash
cp .env.example .env
~~~

#### Windows PowerShell

~~~powershell
Copy-Item .env.example .env
~~~

编辑 .env，最小配置示例：

~~~dotenv
# 选择一个或多个云端 Provider
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# 本地服务端口与数据目录
BLOOMAI_PORT=3718
DATA_DIR=~/.bloomai
~~~

也可以先不写 API Key，启动后进入 Settings 配置 Provider；但在配置模型前无法正常调用云端模型。

### 3. 启动开发环境

~~~bash
npm run dev
~~~

该命令会启动 Electron 窗口、本地 API 服务和 Vite 开发环境。首次启动时，应用会执行数据库迁移并显示 Onboarding 或 Settings 页面。

### 4. 验证构建

~~~bash
npm run typecheck
npm run build
~~~

构建产物位于：

~~~text
dist/          # Renderer 前端
dist-electron/ # Electron Main / Preload / Server
~~~

## 环境变量

完整示例见 .env.example。常用配置如下：

| 变量 | 作用 |
| --- | --- |
| ANTHROPIC_API_KEY | Anthropic API Key |
| OPENAI_API_KEY | OpenAI API Key |
| AGNES_API_KEY | Agnes API Key |
| DEEPSEEK_API_KEY | DeepSeek API Key |
| GOOGLE_API_KEY | Google AI API Key |
| TOGETHER_API_KEY | Together.ai API Key |
| QWEN_API_KEY | Qwen / DashScope API Key |
| BLOOMAI_PORT | 本地 API 服务端口，默认 3718 |
| DATA_DIR | BloomAI 数据目录，默认 ~/.bloomai |
| DATA_DIR_ATTACHMENT | 附件保存目录 |
| MEMORY_DATA_DIR | Mastra Memory 数据目录 |
| MEMORY_LAST_MESSAGES | 直接放入上下文的最近消息数量 |
| MEMORY_OBSERVATION_MODEL | Observational Memory 使用的模型 |
| ANYSEARCH_API_KEY | AnySearch 可选 API Key |
| ANYSEARCH_SEARCH_URL_API | AnySearch 搜索接口地址 |
| TAVILY_API_KEY | Tavily 搜索回退 Provider 的 API Key |
| WEB_BROWSER_ENABLED | 是否启用本机 Edge/Chrome 浏览器 Provider |
| WEB_BROWSER_CHANNELS | 浏览器通道，例如 msedge,chrome |
| LOCAL_HTTPS_PROXY | 网页访问使用的本地 HTTPS 代理 |

API Key 也可以通过应用 Settings 保存到本地设置中。请勿将包含真实密钥的 .env 提交到 Git。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| npm run dev | 启动 Electron 开发环境 |
| npm run typecheck | 运行 TypeScript 类型检查 |
| npm run build | 构建 Renderer、Electron 和 Server |
| npm test | 执行 Vitest 测试 |
| npm run test:architecture | 检查后端 Route → Service → Repository/Runtime 依赖边界 |
| npm run start:server | 仅启动本地 API 服务 |
| npm run db:migrate | 执行数据库迁移 |
| npm run verify:skills-legacy-migration-offline | 执行一次性、离线、只读 Legacy 数据迁移验证（不是用户功能） |
| npm run lint | 运行项目当前的 lint 占位命令 |

## Windows 打包

先构建应用，再使用 electron-builder 生成 Windows 包：

~~~powershell
npm run build
npx electron-builder --win
~~~

默认输出目录为：

~~~text
release/
~~~

Windows 图标资源位于 public/icons/bloomai.ico，包含多个尺寸，主窗口、系统托盘和安装包配置均使用该资源。

如果 electron-builder 在首次打包时尝试下载 winCodeSign 等工具失败，请检查网络、代理和 GitHub 下载权限；这属于打包依赖下载问题，不代表应用源码或 ICO 文件无效。

## 数据与运行限制

### 定时任务限制

定时任务只在 BloomAI 服务进程运行时执行。退出应用、电脑休眠或进程被终止期间，不保证系统会补跑或准点触发。因此不要把它当作支付、交易、删除数据、生产告警升级等需要系统级可靠性的自动化机制。

### 外部服务

BloomAI 的基础界面和本地数据可以离线运行，但以下能力需要外部服务或本机运行时：

- 云端 LLM、图像或视频模型需要对应 Provider 和凭据。
- 网页搜索、抓取和截图需要网络或浏览器 Provider。
- Ollama 需要本机已安装并运行 Ollama 服务。
- 图片、PDF、DOCX 等能力可能需要对应的模型或解析依赖。

## 项目结构

~~~text
bloomai/
├─ src/
│  ├─ main/         # Electron 主进程、窗口、托盘、IPC、服务进程管理
│  ├─ preload/      # Renderer 与 Main 之间的安全桥接
│  ├─ renderer/     # React UI、页面、状态管理和 API 客户端
│  ├─ server/       # Hono API、数据库、LLM、Tools、Skills、Research、Schedules
│  ├─ shared/       # 前后端共享类型、Schema、常量和多模态协议
│  └─ types/        # 全局 TypeScript 类型
├─ public/icons/    # BloomAI 图标和 Windows ICO 资源
├─ scripts/         # 开发、迁移、验证和构建辅助脚本
├─ docs/            # 架构、功能设计、研究和实现文档
├─ data/             # 本地开发数据目录（按配置和运行状态使用）
├─ electron.vite.config.mts
├─ package.json
└─ README.md
~~~

## 架构概览

~~~mermaid
flowchart LR
  UI[React Renderer] -->|HTTP / IPC| MAIN[Electron Main]
  MAIN --> SERVER[Local Hono Server]
  SERVER --> DB[(Drizzle + SQLite/LibSQL)]
  SERVER --> LLM[LLM Providers]
  SERVER --> TOOLS[Tools Runtime]
  SERVER --> SKILLS[Skills Runtime]
  SERVER --> SCHEDULES[Mastra Schedules]
  TOOLS --> WEB[Web / Browser Providers]
  TOOLS --> FILES[Workspace and Documents]
~~~

后端采用分层结构：HTTP Routes 负责协议适配，Services 负责业务编排，Repositories 负责持久化，Runtime 负责 LLM、Tools、Skills 和任务调度。可运行 npm run test:architecture 检查关键依赖边界。

## 测试与质量检查

提交前建议至少运行：

~~~bash
npm run typecheck
npm test
npm run build
~~~

针对特定模块可以运行：

~~~bash
npm run test:architecture
npm run test:web-tools-browser
npm run verify:web-tools-browser
~~~

部分集成测试依赖浏览器、网络、API Key 或本地 Provider；如果这些依赖没有准备好，测试可能会被跳过、失败或超时。请区分源码回归问题和外部依赖问题。

## 故障排查

### 启动后聊天没有响应

1. 确认至少配置了一个可用 Provider。
2. 在 Settings 中确认模型已启用，且模型属于正确的 modality（text/image/video）。
3. 检查本地 API 服务端口 BLOOMAI_PORT 是否被占用。
4. 查看开发终端中的 server 日志。

### Ollama 无法连接

确认 Ollama 正在运行，并检查 Settings 中的 Base URL，默认是：

~~~text
http://127.0.0.1:11434
~~~

### 网页工具不可用

网页搜索、抓取、截图分别依赖网络 Provider、目标站点可访问性和浏览器配置。可以先启用静态 HTTP Provider；需要动态页面时，再安装 Edge/Chrome 并设置 WEB_BROWSER_ENABLED=true。

### Windows 终端中文乱码

使用 npm run dev，项目内置的开发启动脚本会尝试将 Windows 控制台切换到 UTF-8。若仍有乱码，请确认终端使用 UTF-8 编码。

## 开发文档

- docs/BloomAI-architecture-analysis-v1.md：整体架构分析
- docs/services/：Service 层与后端依赖边界
- docs/tools/：Tools 平台、浏览器工具和发布证据
- docs/skills/：Skills Runtime、技能包和能力策略；Legacy 迁移验证仅限一次性、离线、只读流程
- docs/skills/evidence/README.md：Skills Runtime 与 Skills Admin 验收证据索引
- docs/research/：Deep Research 设计与实现记录
- docs/schedule/：定时任务设计与实现计划
- docs/memory/：Memory 系统说明
- docs/ui/：界面与交互设计

欢迎通过 Issue 或 Pull Request 反馈问题、补充 Provider、改进工具和完善文档。
