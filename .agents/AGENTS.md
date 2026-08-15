# BloomAI 项目上下文

本文件为 BloomAI 仓库的持续上下文。优先遵循现有代码、测试和设计文档；修改保持范围最小，不做无关重构。

## 项目概述

BloomAI 是本地优先的 Electron + React + TypeScript AI 桌面工作台。Electron 主进程负责窗口、IPC 和进程管理；Renderer 提供 React UI；本地 Hono Server 负责 API、数据库、LLM、Tools、Skills、Research、Schedules 和 MCP。

服务端遵循 `Route → Service → Repository/Runtime` 分层。核心原则是本地优先、能力可控、共享类型和契约、对高风险工具和秘密保持安全边界。

## 构建和测试命令

环境要求：Node.js >= 22.16.0，使用 npm。

```powershell
npm ci                    # 安装依赖
npm run dev               # Electron 开发环境
npm run typecheck         # TypeScript 类型检查
npm run build             # 类型检查并构建
npm test                  # Vitest 全量测试
npm run test:architecture # 服务端依赖边界测试
npm run start:server      # 仅启动本地 API Server
npm run db:migrate        # 数据库迁移
```

MCP 测试入口：`npm run test:mcp`；按领域可运行 `test:mcp-spike`、`test:mcp-http`、`test:mcp-security`、`test:mcp-contracts`、`test:mcp-db`、`test:mcp-catalog`、`test:mcp-adapter`、`test:mcp-broker`、`test:mcp-agent` 和 `test:mcp-ui`。

开发阶段优先运行受影响的测试文件；提交前运行类型检查、相关域测试和全量测试。`npm run lint` 当前是占位命令，不能替代类型检查和测试。

## 代码风格指南

- 使用严格 TypeScript；优先复用已有类型、Schema、错误码和服务，避免无必要的 `any`。
- 遵循现有风格：2 空格缩进、单引号、无分号；命名和导入顺序跟随相邻文件。
- 使用路径别名：`@main/*`、`@preload/*`、`@renderer/*`、`@server/*`、`@shared/*`。
- Route 不直接访问 Repository、Runtime 或底层基础设施；业务逻辑放在 Service。
- 安全代码默认 fail-closed；校验输入、路径、URL、权限和秘密，日志不得输出 token/API Key 或完整敏感请求体。
- 先读现有实现和测试再修改；不要修改已有 migration 历史或无关模块。

## 测试说明

- 测试使用 Vitest；当前 `npm test` 为单 worker/fork 执行，完整回归可能较慢。
- 修改后先跑目标测试，再跑对应域测试；最终 Release Gate 才跑一次全量测试。
- 测试失败时先定位第一个失败并单独复现，不要盲目重复全量测试。
- MCP/集成测试可能启动 stdio、HTTP、数据库或浏览器 fixture，必须清理子进程、端口和临时数据；外部 API、网络和 Provider 问题要与源码回归区分。

## 主要项目文件

- `package.json`：脚本、依赖和构建入口。
- `README.md`：快速开始、命令、结构和质量检查。
- `src/main/`：Electron 主进程、窗口、IPC 和进程管理。
- `src/preload/`：Renderer 与 Main 的安全桥接。
- `src/renderer/`：React UI、页面、状态和 API 客户端。
- `src/server/`：Hono API、Services、DB、LLM、Tools、Skills、Research、Schedules、MCP。
- `src/shared/`：前后端共享类型、Schema、常量和协议。
- `scripts/`：开发、迁移、fixture、验证和构建脚本。
- `tests/`：跨模块、集成、安全和 E2E 测试。
- `docs/`、`docs/MCP/`：架构、设计、实施计划、Spike 结果和 Roadmap。
- `tsconfig.json`、`vitest.config.ts`、`electron.vite.config.mts`：TypeScript、测试和 Electron/Vite 配置。
