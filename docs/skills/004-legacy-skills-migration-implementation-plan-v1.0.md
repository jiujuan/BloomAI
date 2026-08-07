# Legacy Skills 兼容层迁移实施计划 v1.0

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `subagent-driven-development`（推荐）或 `executing-plans` 按任务逐项执行。本计划中的步骤使用 checkbox 跟踪；每个任务必须先写测试、再实现、再执行验证。

**Goal:** 在不破坏历史数据、历史消息和可审计性的前提下，冻结并最终移除 Legacy Skill 执行兼容层，使新的 Skill 安装、运行、审批、Artifact、Chat 和 UI 流程全部由 Package Runtime 接管。

**Architecture:** 采用 `freeze -> migrate -> dual-read -> package-only -> remove-runner` 的绞杀式迁移。Legacy 保留为只读目录和历史解析层，不能再创建、安装、修改、删除或执行；`prompt-template` 经过人工确认后转换成 Package Draft，`http-api` 与 `js-function` 不自动转换，只生成阻塞报告和人工迁移任务。Package Runtime 以不可变版本、持久化队列、Run 状态机、Capability Grant 和 Artifact Store 为唯一的新运行入口。

**Tech Stack:** TypeScript、Node.js、Hono、SQLite/Drizzle、Zod、Vitest、Playwright Chromium 离线 Harness、React、Zustand、Mastra。

---

## 0. 文档元数据、事实来源和执行纪律

- 编写日期：2026 年 8 月 7 日。
- 编写方式：GPT-5.6 Luna 对仓库进行了独立复核；主线程根据实际代码、测试入口和现有 Skills Runtime 文档校正文件名与边界。
- 工作目录：`D:\codeproject\JS\bloomai\`。
- 本计划只描述迁移实施，不在编写计划时直接删除代码、不执行数据库迁移、不执行 commit/push。
- 关联基线：
  - `D:\codeproject\JS\bloomai\docs\skills\001-skills-system-refactor-analysis-v1.1.md`
  - `D:\codeproject\JS\bloomai\docs\skills\002-skills-system-refactor-implementation-plan-v1.1.md`
  - `D:\codeproject\JS\bloomai\docs\skills\003-skills-system-refactor-release-runbook-v1.1.md`
  - `D:\codeproject\JS\bloomai\docs\skills\third-party-skills-runtime-architecture.md`
- 执行纪律：每个任务必须包含文件级变更、可重复命令、预期结果、失败处理和独立提交边界；不得用模糊的延期、兜底或泛化测试表述替代实现步骤。
- 工作区纪律：只修改任务列出的文件，不得重置或清理其他未跟踪/已修改文件。

## 1. 迁移决策摘要

### 1.1 目标状态

| 决策 | 结论 | 原因 |
|---|---|---|
| 新 Legacy 创建/安装 | 禁止 | 阻止迁移窗口继续扩大 |
| Legacy 修改/删除 | 普通 API 禁止；维护脚本只做归档 | 保护旧引用、历史消息和 `skill_runs` |
| Legacy 执行 | 先关闭高风险类型，随后全部关闭 | `js-function` 执行数据库 JavaScript，`http-api` 可访问任意 URL，`prompt-template` 绕过统一模型/权限/审计 |
| `prompt-template` | 预览 -> Draft -> 人工校验 -> Package Version | 保留模板语义，不自动发布或启用 |
| `http-api` | 只生成脱敏 manual-review 报告 | endpoint、认证、数据外传和 SSRF 不能安全推断 |
| `js-function` | critical blocked，不自动转换 | 不把任意 JS 搬入新 Runtime |
| 历史表 | 保留 `skills`、`skill_runs` | 兼容、审计和回滚需要 |
| 新运行入口 | 只允许 Package Runtime 和 Chat Skill Launcher | Package Run 支持队列、审批、取消、事件、Artifact 和恢复 |
| Mastra Skill Tool | 移除 Legacy Tool | 同步 Tool 与异步 Package Run 协议冲突 |
| ID | `legacy:<id>`、历史无前缀只读可解析；不再可运行 | 兼容旧消息，阻断隐式执行 |

### 1.2 生命周期

`active -> frozen -> read-only -> migrated/manual_review/blocked -> archived -> runner_removed`

- `active` 仅用于迁移前基线。
- `frozen` 禁止新建、市场安装、修改和删除。
- `read-only` 禁止运行，只允许详情、迁移预览、历史 Run 和历史消息读取。
- `migrated` 已有 Draft 或 Package Version 映射。
- `manual_review` 需要人工重写或 capability 审核。
- `blocked` 存在安全、格式、未知类型或完整性阻塞。
- `archived` Legacy 记录和映射被冻结但仍可查。
- `runner_removed` 同步 runner、旧 API 运行路径和 Legacy Mastra Tool 已从构建图删除。

### 1.3 三种类型策略

| 类型 | 风险 | 自动动作 | 人工动作 | 最终运行时 |
|---|---:|---|---|---|
| `prompt-template` | medium | 提取 `{{name}}`，生成 `SKILL.md`、manifest、兼容元数据和 Draft | 检查变量、模型、输出 schema、`llm.generate` capability | Package `instruction-agent` |
| `http-api` | high | 生成 endpoint、方法、变量、脱敏 headers 和 blockers 报告 | 确认 host/path/method/auth/schema/timeout/SSRF/副作用，再重写受控 adapter | Package + 显式 `network.outbound`，或放弃 |
| `js-function` | critical | 生成源码 hash 和禁止原因 | 重写为 typed capability 或 builtin tool；禁止 eval/vm/Function | Package + typed capability，或放弃 |
| 未知类型 | high | 标记 unsupported | 先定义正式契约并安全评审 | 不得运行 |

## 2. 当前代码基线

### 2.1 Legacy 执行栈

当前 Legacy 是完整兼容栈：

- `D:\codeproject\JS\bloomai\src\server\skills\legacy\index.ts`：导出 runner、registry 和执行上下文。
- `D:\codeproject\JS\bloomai\src\server\skills\legacy\registry.ts`：注册 `js-function`、`http-api`、`prompt-template`。
- `D:\codeproject\JS\bloomai\src\server\skills\legacy\run-skill.ts`：读取 `skills`、写入 `skill_runs`、同步执行。
- `D:\codeproject\JS\bloomai\src\server\skills\legacy\js-function.ts`：`vm.runInNewContext()`，critical。
- `D:\codeproject\JS\bloomai\src\server\skills\legacy\http-api.ts`：直接 `fetch` 配置 URL，high。
- `D:\codeproject\JS\bloomai\src\server\skills\legacy\prompt-template.ts`：固定请求 Anthropic，medium。
- `D:\codeproject\JS\bloomai\src\server\skills\legacy\mastra-tool-id.ts`：生成 `legacy_skill_<id>`。
- 根目录旧 barrel 也属于兼容层，不能遗漏：
  - `D:\codeproject\JS\bloomai\src\server\skills\http-api.ts`
  - `D:\codeproject\JS\bloomai\src\server\skills\js-function.ts`
  - `D:\codeproject\JS\bloomai\src\server\skills\prompt-template.ts`
  - `D:\codeproject\JS\bloomai\src\server\skills\registry.ts`
  - `D:\codeproject\JS\bloomai\src\server\skills\run-skill.ts`
  - `D:\codeproject\JS\bloomai\src\server\skills\types.ts`
  - `D:\codeproject\JS\bloomai\src\server\skills\legacy-regression.test.ts`

### 2.2 应用层、API、ID 和 Mastra

- `D:\codeproject\JS\bloomai\src\server\skills\application\legacy-skill.adapter.ts`：Legacy CRUD、Run、历史 Run 和风险画像。
- `D:\codeproject\JS\bloomai\src\server\services\skill.service.ts`：旧服务入口和 migration preview。
- `D:\codeproject\JS\bloomai\src\server\skills\application\skills-facade.service.ts`：同时路由 legacy/package 两域。
- `D:\codeproject\JS\bloomai\src\shared\skill-references.ts`：当前支持 `legacy:<id>`、`package:<id>` 和无前缀 ID。
- `D:\codeproject\JS\bloomai\src\server\http\routes\skills.ts`：旧列表、市场、安装、CRUD、同步 run、history 和 migration preview。
- `D:\codeproject\JS\bloomai\src\server\mastra\tools.ts`：`buildAgentTools()` 当前合并 `buildLegacySkillTools()`。

### 2.3 Package Runtime 现状

主要边界：

```text
D:\codeproject\JS\bloomai\src\server\skills\runtime\
D:\codeproject\JS\bloomai\src\server\skills\packages\
D:\codeproject\JS\bloomai\src\server\skills\policy\
D:\codeproject\JS\bloomai\src\server\skills\artifacts\
D:\codeproject\JS\bloomai\src\server\skills\application\
D:\codeproject\JS\bloomai\src\server\services\skill-package-runtime.service.ts
D:\codeproject\JS\bloomai\src\server\http\routes\skill-package-runtime.ts
D:\codeproject\JS\bloomai\src\server\http\routes\skill-creator.ts
D:\codeproject\JS\bloomai\src\server\skills\application\chat-skill-launcher.ts
```

已有表：

```text
skill_packages, skill_versions, skill_installations,
skill_runs_v2, skill_run_events, skill_run_commands,
skill_artifacts, skill_capability_grants, skill_run_queue
```

已有 Package API 已覆盖 inspect/import review/install、Version/diff/update/rollback、Installation enable/disable/uninstall、Grant approve/reject/revoke、Run start/list/get/events/stream/commands/cancel、Artifact list/content/export 和 Creator Draft 生命周期。

### 2.4 测试入口

`D:\codeproject\JS\bloomai\package.json` 已有：

```powershell
npm run typecheck:skills
npm run test:skills:unit
npm run test:skills:integration
npm run test:skills:e2e
npm run test:skills:security
npm run test:skills:migration
npm run test:skills:release-gate
```

浏览器基线：`D:\codeproject\JS\bloomai\tests\e2e\skills\skill-runtime.browser.test.ts`，使用 Playwright Chromium 离线 Harness，已覆盖 Package import/review/install/enable/Run/approval/Artifact/export 和 Creator validate/preview/publish。

---

## 3. 目标架构和不变量

### 3.1 逻辑平面

```text
Catalog / UI / Chat
  -> SkillsFacade + Skills Center + ChatSkillLauncher

Legacy Archive Plane              Package Runtime Plane
skills + skill_runs               immutable Version + queue
migration control + history       policy + worker + events
read-only / no runner             grants + artifacts + Chat Run
```

### 3.2 必须保持的不变量

1. `legacy:<id>` 永远不会被 Package resolver 解释；`package:<id>` 永远不会被 Legacy resolver 解释。
2. read-only/disabled 下任何 Legacy 引用都不能进入 runner、Mastra Tool 或 Package queue。
3. `POST /skills/:id/run` 在非 active 模式返回稳定的 `LEGACY_SKILL_RUN_DISABLED`，且不创建 `skill_runs` running 行。
4. Package Run 必须有 `runId`、`skillVersionId`、状态、revision 和事件；Chat 只保存 `data-skill-run` 引用。
5. Package Version immutable；Legacy source 改变不会修改已发布 Version。
6. inspect/preview 不产生 Package、Version、Installation、Run 或 Grant 副作用。
7. 相同 `legacy_skill_id + source_sha256` 的迁移幂等，不重复 Draft。
8. HTTP 配置的 authorization、x-api-key、cookie、token、secret、password 必须脱敏。
9. js-function 不得通过 vm、eval、Function constructor、child process 或旧 barrel 恢复执行。
10. `skills` 和 `skill_runs` 至少在一个观察窗口内只读保留，不通过 delete 清理。

### 3.3 稳定错误码

| 场景 | HTTP | 错误码 |
|---|---:|---|
| Legacy 创建/安装/修改/删除已冻结 | 409 | `LEGACY_SKILL_FROZEN` |
| Legacy 运行已关闭 | 409 | `LEGACY_SKILL_RUN_DISABLED` |
| Package 误走旧同步入口 | 409 | `PACKAGE_SKILL_ASYNC_ONLY` |
| http-api 自动迁移 | 409 | `LEGACY_MIGRATION_MANUAL_REVIEW` |
| js-function 自动迁移 | 409 | `LEGACY_MIGRATION_CRITICAL_BLOCKED` |
| 未知类型 | 422 | `LEGACY_MIGRATION_UNSUPPORTED_TYPE` |
| 历史引用不存在 | 404 | `NOT_FOUND` |
## 4. 迁移文件地图

本节把迁移工作拆成“现有文件改造、必要新增文件、最终删除文件、测试与文档”四类。所有实现必须优先复用现有 Package Runtime 的领域对象、错误映射、鉴权和数据库事务边界；如果仓库中已经存在同职责文件，应在原文件中扩展，而不是再创建第二套并行实现。

### 4.1 现有文件改造清单

| 路径 | 操作 | 实施内容 | 完成证据 |
|---|---|---|---|
| `D:\codeproject\JS\bloomai\src\server\skills\legacy\index.ts` | 改造后冻结 | 仅保留 Legacy 类型、序列化/反序列化和只读查询所需导出；移除对 runner 的公共导出；禁止通过 barrel 恢复执行能力 | `rg "runSkill|execute|js-function|http-api" src/server/skills/legacy/index.ts` 不再出现执行导出 |
| `D:\codeproject\JS\bloomai\src\server\skills\legacy\registry.ts` | 改造 | 改为只读 Archive Registry；保留按旧 ID、`legacy:<id>` 和历史名称查询；新增 `assertLegacyReadOnly()`，禁止 create/update/delete/install | Legacy 写接口返回 `LEGACY_SKILL_FROZEN`；历史查询仍可用 |
| `D:\codeproject\JS\bloomai\src\server\skills\legacy\run-skill.ts` | 最后删除 | 在所有调用者迁移并完成灰度观察后删除；删除前先将旧入口改为显式抛出稳定错误，避免静默 fallback | 删除后全仓库无 import；运行旧接口只能得到 409 |
| `D:\codeproject\JS\bloomai\src\server\skills\legacy\prompt-template.ts` | 改造 | 只保留源数据读取和确定性规范化逻辑；执行部分改为生成 migration preview/package draft，不调用模型、不发网络请求、不落正式 Version | 相同输入和 `source_sha256` 生成相同 preview；preview 无数据库副作用 |
| `D:\codeproject\JS\bloomai\src\server\skills\legacy\http-api.ts` | 改造后封存 | 保留读取、结构解析和 capability 风险扫描；禁止直接请求目标 URL；输出脱敏的 manual-review report | 含 token、cookie、password、api key 的字段在返回值和日志中均为 `[REDACTED]` |
| `D:\codeproject\JS\bloomai\src\server\skills\legacy\js-function.ts` | 最后删除 | 迁移期间只允许分类、哈希和阻断报告；禁止 `vm`、`eval`、`Function`、`child_process` 或动态 import 执行旧函数 | `LEGACY_MIGRATION_CRITICAL_BLOCKED`；安全测试确认无执行路径 |
| `D:\codeproject\JS\bloomai\src\server\skills\legacy\mastra-tool-id.ts` | 最后删除 | 停止生成和注册 `legacy_skill_<id>` 同步 Mastra Tool；先切断注册，再删除常量和映射 | `src/server/mastra/tools.ts` 不再注册 Legacy Tool |
| `D:\codeproject\JS\bloomai\src\server\skills\application\legacy-skill.adapter.ts` | 改造 | 仅实现 Legacy Archive DTO、历史引用解析和迁移状态读取；删除 runner adapter 和执行结果适配 | adapter 不依赖 `run-skill.ts`、`http-api.ts` 或 `js-function.ts` |
| `D:\codeproject\JS\bloomai\src\server\skills\application\skills-facade.service.ts` | 改造 | 将 Legacy 与 Package 的 resolver 明确分叉；列表可显示 `runtimeKind=legacy`，运行只路由 Package | `legacy:<id>` 不会解析为 Package；Package 入口不接受 Legacy ID |
| `D:\codeproject\JS\bloomai\src\server\services\skill.service.ts` | 改造 | `create/install/update/remove/run` 对 Legacy 统一冻结；`get/list/listRuns/migrationPreview` 保持只读或迁移专用语义 | 每个冻结操作都有稳定错误码和无副作用断言 |
| `D:\codeproject\JS\bloomai\src\server\http\routes\skills.ts` | 改造 | 保留 Legacy 读取与历史 runs 查询；冻结 `POST /skills`、`POST /skills/install`、`PATCH /skills/:id`、`DELETE /skills/:id`；`POST /skills/:id/run` 对 Legacy 返回 409 | 路由测试覆盖状态码、错误码和数据库无写入 |
| `D:\codeproject\JS\bloomai\src\server\skills\creator\legacy-to-draft.service.ts` | 改造 | 作为唯一迁移编排器：classify -> normalize -> redact -> preview -> validate -> optional publish；`http-api` 和 `js-function` 不得走 publish | 每次迁移返回明确 `migrationKind`、`decision`、`reasons` 和 `sideEffects` |
| `D:\codeproject\JS\bloomai\src\shared\skill-references.ts` | 改造 | 固化 `legacy:<id>`、`package:<id>` 的互斥解析；无前缀旧 ID 仅在历史读取上下文允许 | resolver 单测覆盖前缀、空值、伪造 ID 和跨平面引用 |
| `D:\codeproject\JS\bloomai\src\server\mastra\tools.ts` | 改造 | 删除 Legacy Tool 注册；只暴露 Package 的异步启动/查询工具，禁止同步执行旧 Skill | 启动 Mastra 后工具清单没有 `legacy_skill_` 前缀 |
| `D:\codeproject\JS\bloomai\src\server\skills\runtime\` | 扩展 | 为迁移发布后的 Package Run 复用现有 queue、worker、event、command、artifact 生命周期；不新增 Legacy runner | migration publish 后只生成 Package Draft/Version，经确认后才能进入 Runtime |
| `D:\codeproject\JS\bloomai\src\server\skills\packages\` | 扩展 | 接收 prompt-template 生成的规范化 Package Draft；校验 manifest、入口、schema、capability 和 immutable version | 非法 draft 无法 install；已发布 Version 内容不可变 |
| `D:\codeproject\JS\bloomai\src\server\skills\policy\` | 扩展 | 增加迁移来源的最小 capability policy；manual-review 结果不能自动授予网络、secret 或 filesystem capability | grant 审批前 Run 不入队或进入 blocked 状态 |
| `D:\codeproject\JS\bloomai\src\server\skills\artifacts\` | 扩展 | 保存迁移报告、preview、脱敏差异和 Package Run Artifact；不得保存明文 secret | artifact 内容检查和导出检查均通过脱敏断言 |
| `D:\codeproject\JS\bloomai\src\server\skills\application\chat-skill-launcher.ts` | 改造 | Chat 只启动 Package Run；Legacy 引用只返回迁移提示和历史结果查询链接，不产生执行 Run | Chat 消息含 `data-skill-run` 时必有 Package `runId` |
| `D:\codeproject\JS\bloomai\src\server\http\routes\skill-package-runtime.ts` | 扩展 | 增加迁移产物到 Package Runtime 的显式边界检查；拒绝 Legacy ID、Legacy draft 和未审批 grant | 所有 Package run 入口测试拒绝 Legacy 引用 |
| `D:\codeproject\JS\bloomai\src\server\http\routes\skill-creator.ts` | 扩展 | 为迁移 draft 接入 owner、revision、validate、preview、publish 权限检查；publish 必须带显式确认字段 | 未 validate、未确认或无 owner 权限时 publish 失败 |
| `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skills.store.ts` | 改造 | 显示 Legacy 为 Archive/只读状态；隐藏安装、编辑、删除、运行按钮；保留迁移入口和历史查看入口 | UI 状态和 API `runtimeKind`、`lifecycle` 一致 |
| `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skill-runtime.store.ts` | 改造 | 仅存 Package run、events、commands、artifacts；拒绝把 Legacy run 映射为 active runtime state | Legacy 运行响应不会写入 active run store |
| `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.tsx` | 改造 | 增加迁移状态、阻断原因、人工审查和 preview 入口；明确显示“Legacy 不可运行” | 浏览器测试可从列表进入 preview 和历史查看 |
| `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillOverviewPanel.tsx` | 改造 | 展示来源、类型、source hash、迁移决策、capability 风险和只读警告 | prompt-template/http-api/js-function 三种 UI 状态可区分 |

### 4.2 建议新增的迁移模块

以下文件用于把迁移规则从 HTTP、UI 和旧 runner 中隔离出来。新增模块必须是纯函数优先、显式输入输出、可独立测试；不得在 classifier/normalizer 中触发网络、模型、队列或安装副作用。

| 路径 | 职责 | 关键导出 |
|---|---|---|
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration.types.ts` | 迁移输入、决策、报告、审计和 side-effect 类型 | `LegacyMigrationInput`, `MigrationDecision`, `MigrationReport`, `MigrationSideEffects` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration-classifier.ts` | 按 `prompt-template`、`http-api`、`js-function`、unknown 分类 | `classifyLegacySkill()` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\source-normalizer.ts` | 规范化 title、description、input/output schema、entrypoint 和 source hash | `normalizeLegacySource()`, `computeSourceSha256()` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\secret-redactor.ts` | 对 URL、headers、body、env、日志和报告统一脱敏 | `redactSecrets()`, `assertNoSecretLeak()` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\prompt-template-migrator.ts` | 将安全的 prompt-template 映射为 Package Draft | `buildPromptTemplatePackageDraft()` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\manual-review-report.ts` | 生成 http-api/js-function/unknown 的人工审查报告 | `buildManualReviewReport()` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration-preview.service.ts` | 编排 inspect/preview，保证幂等和零副作用 | `inspectLegacySkill()`, `previewLegacyMigration()` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration-control.service.ts` | 编排 validate/publish/abort、revision、owner 和审计 | `validateMigration()`, `publishMigration()` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration.repository.ts` | 读写迁移映射、报告、审计和唯一性约束 | `findBySourceHash()`, `saveMigrationRecord()` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration.schemas.ts` | HTTP body/query 的 Zod schema | `migrationPreviewSchema`, `migrationPublishSchema` |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration-errors.ts` | 稳定错误码和服务错误构造器 | `LegacyMigrationError`, error constants |
| `D:\codeproject\JS\bloomai\src\server\http\routes\skill-migration.ts` | 迁移 inspect/preview/validate/publish/history HTTP API | `skillMigrationRoutes` |
| `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\legacy-migration.store.ts` | 迁移 preview、人工审查、发布确认状态 | `useLegacyMigrationStore` |
| `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\LegacyMigrationPanel.tsx` | 显示报告、风险、diff、确认和历史映射 | `LegacyMigrationPanel` |

如果当前路由装配点不允许新增 `skill-migration.ts`，则将相同 handler 合并到 `D:\codeproject\JS\bloomai\src\server\http\routes\skills.ts`，但领域服务和 schema 仍必须保持独立。

### 4.3 数据库和脚本文件地图

| 路径 | 操作 | 规则 |
|---|---|---|
| `D:\codeproject\JS\bloomai\scripts\migrations\` | 新增迁移脚本 | 为 migration record、source hash 唯一索引、审计状态和旧数据只读约束提供可重复执行的 schema migration |
| `D:\codeproject\JS\bloomai\src\server\db\` | 扩展 schema/repository | 复用已有 `skill_packages`、`skill_versions`、`skill_installations`、`skill_runs_v2`、`skill_run_events`、`skill_run_commands`、`skill_artifacts`、`skill_capability_grants`、`skill_run_queue`；不得复制一套 Legacy 运行表 |
| `D:\codeproject\JS\bloomai\src\server\db\migration.test.ts` 或同目录迁移测试 | 新增测试 | 验证旧 `skills`、`skill_runs` 数据可读、source hash 幂等、重复迁移不重复建 draft、迁移失败事务回滚 |
| `D:\codeproject\JS\bloomai\scripts\verify-legacy-skills-migration.ts` | 新增验收脚本 | 离线扫描 Legacy 引用、执行只读/阻断检查、输出机器可读 JSON 结果和退出码 |

建议 migration record 至少包含：`id`、`legacySkillId`、`legacyType`、`sourceSha256`、`decision`、`status`、`packageId`、`packageVersionId`、`reportArtifactId`、`createdBy`、`createdAt`、`publishedAt`、`revision`。唯一约束为 `legacySkillId + sourceSha256`；来源变更时生成新的 preview，不覆盖旧报告。

### 4.4 测试、fixture 和文档文件地图

| 路径 | 操作 | 覆盖范围 |
|---|---|---|
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration-classifier.test.ts` | 新增 | 类型分类、unknown、大小写和恶意伪装类型 |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\source-normalizer.test.ts` | 新增 | 确定性规范化、hash、字段缺失和 schema 映射 |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\secret-redactor.test.ts` | 新增 | header/query/body/env/log/artifact 脱敏 |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\prompt-template-migrator.test.ts` | 新增 | 安全转换、draft manifest、禁止执行和幂等 |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\manual-review-report.test.ts` | 新增 | http-api/js-function/unknown 报告与阻断原因 |
| `D:\codeproject\JS\bloomai\src\server\skills\migration\migration-control.service.test.ts` | 新增 | validate/publish/abort、权限、revision、事务和副作用 |
| `D:\codeproject\JS\bloomai\src\server\skills\legacy\compatibility.test.ts` | 改造 | Legacy read-only、旧 ID 可读、新运行入口阻断、Mastra Tool 断开 |
| `D:\codeproject\JS\bloomai\src\server\http\routes\skill-migration.test.ts` | 新增 | HTTP 状态码、错误码、body schema、权限和缓存/幂等 |
| `D:\codeproject\JS\bloomai\tests\integration\skill-runtime\legacy-migration.integration.test.ts` | 新增 | 真实 repository + route + Package Draft/Version + queue 边界 |
| `D:\codeproject\JS\bloomai\tests\security\legacy-skill-migration.security.test.ts` | 新增 | SSRF、secret 泄露、js-function 执行、路径穿越、越权和 replay |
| `D:\codeproject\JS\bloomai\tests\e2e\skills\legacy-skills-migration.browser.test.ts` | 新增 | Skills Center 全流程、只读 UI、preview、manual review、publish、Chat 和历史查询 |
| `D:\codeproject\JS\bloomai\tests\e2e\skills\fixtures\legacy-skills.json` | 新增 | prompt-template、http-api、js-function、unknown、旧引用和坏数据 fixture |
| `D:\codeproject\JS\bloomai\tests\e2e\skills\fixtures\package-manifest.json` | 新增 | publish 后可安装和运行的最小 Package fixture |
| `D:\codeproject\JS\bloomai\docs\skills\004-legacy-skills-migration-implementation-plan-v1.0.md` | 当前文件 | 任务、测试、验收、回滚和最终 E2E 的唯一执行清单 |

### 4.5 最终删除清单与删除顺序

删除必须是迁移最后一步，且每个删除前都要通过全仓库引用扫描。推荐顺序如下：

1. 停止 Legacy Tool 注册：`D:\codeproject\JS\bloomai\src\server\mastra\tools.ts`。
2. 停止 Legacy run route 的实际执行，保留稳定 409：`D:\codeproject\JS\bloomai\src\server\http\routes\skills.ts`。
3. 删除 runner 依赖调用：`D:\codeproject\JS\bloomai\src\server\skills\application\legacy-skill.adapter.ts`、`D:\codeproject\JS\bloomai\src\server\services\skill.service.ts`。
4. 删除 `D:\codeproject\JS\bloomai\src\server\skills\legacy\run-skill.ts`。
5. 删除 `D:\codeproject\JS\bloomai\src\server\skills\legacy\js-function.ts` 和 `D:\codeproject\JS\bloomai\src\server\skills\legacy\mastra-tool-id.ts`。
6. 删除只为执行链服务的类型、fixture、测试和 barrel export；保留 Archive 读取类型及历史数据 schema。
7. 执行 `rg` 和 TypeScript 编译确认没有幽灵依赖。

禁止直接先删文件再修调用者；否则无法区分“迁移后的显式阻断”和“运行时找不到模块”的偶发故障。

### 4.6 根目录 Legacy 兼容模块和运行服务节点

首轮扫描不能只检查 `src/server/skills/legacy/`，因为仓库当前还存在一组根目录兼容模块。它们必须分别判定为“迁移读取保留”或“执行链删除”，不能因目录名称不同而遗漏。

| 路径 | 目标处理 | 具体动作 |
|---|---|---|
| `D:\codeproject\JS\bloomai\src\server\skills\http-api.ts` | 删除执行导出或改为 manual-review re-export | 不能继续导出直接 fetch handler；若迁移模块接管后无读取调用则删除 |
| `D:\codeproject\JS\bloomai\src\server\skills\js-function.ts` | 删除执行导出 | 不能导出 VM、eval、Function 或旧执行上下文 |
| `D:\codeproject\JS\bloomai\src\server\skills\prompt-template.ts` | 迁移读取兼容或删除旧执行导出 | 只允许导出规范化/报告能力，不允许直接调用模型 |
| `D:\codeproject\JS\bloomai\src\server\skills\registry.ts` | 合并到 Archive Registry 或删除旧注册入口 | 不得保留可注册/可安装/可运行 Legacy 的别名 |
| `D:\codeproject\JS\bloomai\src\server\skills\run-skill.ts` | 删除 | 删除前执行全仓库 import 扫描，删除后执行 typecheck 和静态扫描 |
| `D:\codeproject\JS\bloomai\src\server\skills\types.ts` | 拆分保留 | 只保留 Archive DTO/历史运行 DTO；执行上下文和任意函数类型迁移到阻断报告或删除 |
| `D:\codeproject\JS\bloomai\src\server\skills\legacy-regression.test.ts` | 改造 | 改为验证只读、错误码、无副作用和跨平面拒绝；不能继续把旧 runner 当作成功基线 |
| `D:\codeproject\JS\bloomai\src\server\skills\creator\skill-draft.service.ts` | 复用 | 迁移 publish 只能通过现有 Draft/Version 生命周期，不能另造直接写 Version 的旁路 |
| `D:\codeproject\JS\bloomai\src\server\services\skill-package-runtime.service.ts` | 复用并加边界检查 | 明确拒绝 Legacy reference，保持 Package Run 的 queue/event/artifact 生命周期 |
| `D:\codeproject\JS\bloomai\src\server\config\` 与 route registry | 统一接入 | 迁移 route、feature flag、审计和错误 mapper 必须在实际 server 装配点注册 |

最终 `rg` 扫描结果应能区分三类命中：Archive 读取允许、迁移阻断报告允许、可达执行路径禁止。只有前两类可保留。

---

## 5. 目标 API、ID、Chat 和 Mastra 协议

### 5.1 生命周期状态

Legacy Skill 的目标状态集合固定为：`legacy_archive`、`migration_previewed`、`manual_review_required`、`migration_published`、`migration_blocked`。状态只能按下表前进，不能从 Package 状态回写 Legacy 状态。

```text
legacy_archive
  -> migration_previewed
  -> migration_published        (仅 prompt-template 且人工确认)
  -> manual_review_required     (http-api)
  -> migration_blocked          (js-function / unknown / 安全失败)
```

`migration_published` 表示已经生成并发布到 Package 平面的 Version，不表示旧 Skill 恢复可运行。旧 Skill 本身仍是 `legacy_archive`，历史引用只读。

### 5.2 引用解析协议

| 输入 | 允许的上下文 | 解析结果 |
|---|---|---|
| `legacy:<legacyId>` | Archive 查询、历史 runs、迁移 preview | Legacy ID |
| `package:<packageId>` | Package inspect/install/run/chat | Package ID |
| 无前缀旧 ID | 仅历史读取和兼容显示 | 先查 Legacy Archive；不得自动进入 Package run |
| `legacy:<id>` 传给 Package Run | 禁止 | 409 `LEGACY_SKILL_RUN_DISABLED` |
| `package:<id>` 传给 Legacy update/delete | 禁止 | 404 或领域层类型错误，不得跨平面修改 |

所有 API response 中应同时提供 `reference`、`runtimeKind`、`lifecycle` 和 `readOnly`，避免前端根据 ID 猜测状态。

### 5.3 Legacy 读取和迁移 API

以下路径以现有 Skills 路由挂载前缀为准，假定资源前缀为 `/skills`；若服务实际挂载 `/api/skills`，只替换统一前缀，不改变资源语义。

| 方法和路径 | 用途 | 成功结果 | 关键失败 |
|---|---|---|---|
| `GET /skills/overview?runtimeKind=legacy` | 查询 Legacy Archive 列表 | 分页列表，含 `runtimeKind=legacy`、`readOnly=true` | 参数非法 400 |
| `GET /skills/:id` | 读取单个 Legacy | 历史元数据、来源、类型、hash、迁移状态 | 不存在 404 |
| `GET /skills/:id/runs` | 查询历史 Legacy runs | 只读历史记录，不能触发执行 | 资源不存在 404 |
| `GET /skills/:id/migration-preview` | 兼容旧 preview 读取入口 | 返回确定性 preview 或人工审查报告 | http-api 409 `LEGACY_MIGRATION_MANUAL_REVIEW`；js-function 409 `LEGACY_MIGRATION_CRITICAL_BLOCKED` |
| `POST /skills/:id/migration/inspect` | 生成无副作用检查结果 | 分类、风险、source hash、side effects | 不支持类型 422 |
| `POST /skills/:id/migration/preview` | 生成 migration preview | prompt-template 的 Package Draft 预览，其他类型的报告 | 输入错误 400；敏感字段 409 |
| `POST /skills/:id/migration/validate` | 校验 preview/draft | `valid=true/false`、errors、warnings、requiredCapabilities | 未找到 preview 404；revision 冲突 409 |
| `POST /skills/:id/migration/publish` | 人工确认后发布 Package Version | `packageId`、`skillVersionId`、映射、审计记录 | 未确认/未 validate/阻断类型 409 |
| `GET /skills/:id/migration-history` | 查询迁移历史 | 按 source hash/revision 返回只读记录 | 不存在 404 |
| `POST /skills/:id/run` | 旧运行入口 | Legacy 永远 409；Package 不应使用此同步入口 | `LEGACY_SKILL_RUN_DISABLED` 或 `PACKAGE_SKILL_ASYNC_ONLY` |
| `PATCH /skills/:id`、`DELETE /skills/:id` | 旧修改/删除入口 | Legacy 永远冻结 | 409 `LEGACY_SKILL_FROZEN` |

迁移 publish 请求必须包含：`previewId`、`expectedRevision`、`confirm=true`、`acknowledgedWarnings[]` 和当前 owner/tenant 上下文。服务端重新读取并校验 preview，不能信任前端提交的完整 draft。

### 5.4 Package 运行协议

迁移发布后的唯一运行链路为：

```text
Package reference
  -> inspect Version
  -> install/enable
  -> capability grant
  -> POST /skill-package-runtime/runs
  -> queue/worker
  -> events/artifacts
  -> Chat data-skill-run reference
```

约束如下：

- `POST /skill-package-runtime/runs` 只接受 `package:<id>` 或内部 `skillVersionId`，不接受 `legacy:<id>`。
- Run 创建必须产生 `runId`、`skillVersionId`、初始 `revision` 和审计事件；缺 grant 时只能为 blocked/pending，不得绕过 policy。
- Chat 只保存 `runId`、`skillVersionId`、状态和摘要引用，不保存完整 secret、prompt 原文或可执行旧函数。
- Event stream、command、cancel、artifact export 继续复用 Package Runtime，不重新实现 Legacy 兼容分支。
- Legacy 历史 run 可展示 `legacyRunId`，但不得被转换成可 cancel、可 resume 的 Package Run。

### 5.5 Mastra 协议

- 启动时只注册 Package 异步工具和只读历史查询工具。
- `legacy_skill_<id>` 不再生成、不再注册、不再出现在工具 schema 中。
- 如果模型请求 Legacy 引用，工具层返回结构化迁移提示：`runtimeKind=legacy`、`readOnly=true`、`migrationAction=preview`，而不是执行旧 Skill。
- 所有工具错误必须经过统一 `mapErrorToHttpResponse`/领域错误映射，不能把旧 runner 异常原样暴露给模型或 UI。

---

## 6. 分阶段实施任务

实施采用 `freeze -> migrate -> package-only -> remove-runner` 四阶段。每个阶段完成后必须通过阶段门禁，禁止跨阶段混合删除和功能开发。

### 阶段 0：基线冻结与可观测性（M0）

目标：先让 Legacy 的行为可观测、可审计、可阻断，暂不删除实现。

- [ ] **M0-01 建立基线清单**：扫描 `skills`、`skill_runs`、Legacy registry、Mastra Tool 注册、前后端引用、旧 ID 格式和运行入口。
  - 命令：`rg -n "legacy|run-skill|legacy_skill_|skills/:id/run|resolveLegacySkillId|resolvePackageSkillId" D:\codeproject\JS\bloomai\src D:\codeproject\JS\bloomai\tests`
  - 预期：生成受控清单；每个命中点归类为读取、迁移、执行、UI 或测试。
- [ ] **M0-02 固化运行配置**：在 `D:\codeproject\JS\bloomai\src\server\skills\config\skill-runtime.config.ts` 增加 Legacy lifecycle/read-only 开关，默认值为冻结状态；Package Runtime 开关保持原有默认值。
  - 预期：配置读取可被单测覆盖，生产默认不依赖环境变量临时拼接。
- [ ] **M0-03 添加稳定错误码**：扩展 `D:\codeproject\JS\bloomai\src\server\services\errors.ts` 和 `D:\codeproject\JS\bloomai\src\server\http\error-mapper.ts`。
  - 预期：Legacy 冻结、Legacy 运行关闭、Package 异步入口、人工审查和 critical blocked 都有稳定 HTTP 映射。
- [ ] **M0-04 增加审计字段**：在 migration repository/schema 中记录 actor、tenant/owner、source hash、decision、revision、side effects 和时间。
  - 预期：任何 preview/publish/blocked 请求都可按 `legacySkillId` 和 `sourceSha256` 追溯。
- [ ] **M0-05 建立基线测试快照**：先运行既有技能测试，不修改现有无关文件。
  - 命令：`npm run typecheck:skills; npm run test:skills:unit; npm run test:skills:integration; npm run test:skills:security; npm run test:skills:migration; npm run test:skills:e2e`
  - 预期：记录基线通过/失败及失败测试名称；基线失败必须在实施日志中单列，不能伪装成迁移回归。

阶段门禁 M0：Legacy 列表、历史 runs 和旧引用仍可读；执行链路有明确调用图；错误码和审计字段测试通过。

### 阶段 1：建立只读 Archive Plane（M1）

目标：先切断 Legacy 的写入和运行入口，但保留历史数据和迁移读取能力。

- [ ] **M1-01 改造 Legacy Registry**：修改 `D:\codeproject\JS\bloomai\src\server\skills\legacy\registry.ts`，把写操作集中到 `assertLegacyReadOnly()`；所有旧写 API 统一抛 `LEGACY_SKILL_FROZEN`。
- [ ] **M1-02 改造 Service/Facade**：修改 `D:\codeproject\JS\bloomai\src\server\services\skill.service.ts`、`D:\codeproject\JS\bloomai\src\server\skills\application\skills-facade.service.ts` 和 `D:\codeproject\JS\bloomai\src\server\skills\application\legacy-skill.adapter.ts`，明确 Archive 查询与 Package 运行的分叉。
- [ ] **M1-03 关闭旧 run**：修改 `D:\codeproject\JS\bloomai\src\server\http\routes\skills.ts`；`POST /skills/:id/run` 对 Legacy 只返回 409，不创建 running 行、不入队、不调用 worker。
- [ ] **M1-04 删除 Mastra 注册**：修改 `D:\codeproject\JS\bloomai\src\server\mastra\tools.ts`，先停止 Legacy Tool 的发现和注册，保留结构化迁移提示。
- [ ] **M1-05 固化引用解析**：修改 `D:\codeproject\JS\bloomai\src\shared\skill-references.ts`，补充跨平面拒绝和无前缀历史读取例外。
- [ ] **M1-06 更新前端只读态**：修改 `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skills.store.ts`、`D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.tsx`、`D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillOverviewPanel.tsx`。
  - 预期：Legacy 卡片可查看、可复制引用、可打开历史/迁移报告；编辑、安装、删除、运行按钮不可用并有原因提示。
- [ ] **M1-07 更新兼容性测试**：改造 `D:\codeproject\JS\bloomai\src\server\skills\legacy\compatibility.test.ts`，新增 DB side-effect spy 和 Mastra tool list 断言。

阶段门禁 M1：所有 Legacy 写/运行入口均显式阻断；历史读取通过；Package Run 不接受 Legacy；UI 不展示误导性的运行按钮。

### 阶段 2：实现迁移分析和安全转换（M2）

目标：把 Legacy source 转成可审查的 migration report；只有 prompt-template 可生成可发布的 Package Draft。

- [ ] **M2-01 实现 classifier**：新增 `migration-classifier.ts`，类型判定只使用明确的 `type`/`kind` 字段和白名单；缺失、大小写异常、伪造字段进入 unknown。
- [ ] **M2-02 实现 normalizer/hash**：新增 `source-normalizer.ts`，固定字段排序、换行、默认值和 schema 序列化；使用 SHA-256 生成 `sourceSha256`。
- [ ] **M2-03 实现脱敏器**：新增 `secret-redactor.ts`；覆盖 HTTP headers、URL query、JSON body、环境变量、异常、日志和 artifact；采用键名规则与高熵值规则双重识别。
- [ ] **M2-04 实现 prompt-template 转换**：新增 `prompt-template-migrator.ts`，将模板、变量 schema、输出 schema 和描述映射到 Package manifest；不能把旧执行器、动态代码或隐含网络调用带入 draft。
- [ ] **M2-05 实现 http-api manual review**：改造 `http-api.ts` 并新增 `manual-review-report.ts`；提取 endpoint/method/headers/body/auth/capability 风险，但不请求 endpoint；任何认证信息只保留存在性和类型摘要。
- [ ] **M2-06 阻断 js-function**：改造 `js-function.ts`；只生成 critical blocked 报告，报告中列出需要重写为 typed capability 的接口，不尝试 AST 自动翻译或沙箱执行。
- [ ] **M2-07 实现 preview service**：新增 `migration-preview.service.ts`，保证 inspect/preview 是纯读/幂等操作；同一 `legacySkillId + sourceSha256` 返回同一 migration record。
- [ ] **M2-08 接入 Creator Draft**：修改 `D:\codeproject\JS\bloomai\src\server\skills\creator\legacy-to-draft.service.ts`、`skill-draft.schema.ts`、`skill-creator.ts`，使 preview 产生 Draft Candidate 而非直接发布。
- [ ] **M2-09 增加迁移 API**：新增 `D:\codeproject\JS\bloomai\src\server\http\routes\skill-migration.ts` 并接入 server route registry；所有请求做 owner/tenant、body size、revision 和 rate limit 检查。
- [ ] **M2-10 建立 fixture**：新增 `D:\codeproject\JS\bloomai\tests\e2e\skills\fixtures\legacy-skills.json`，至少包含安全 prompt、带 Authorization 的 HTTP API、动态 js-function、未知类型、损坏 schema 和重复 source。

阶段门禁 M2：prompt-template preview 可确定性生成；http-api 只能人工审查；js-function/unknown 必须阻断；没有网络、模型、队列和正式 Version 副作用。

### 阶段 3：人工确认后发布到 Package Plane（M3）

目标：把已审查的 prompt-template Draft 以正常 Package 生命周期发布，且不复活 Legacy runner。

- [ ] **M3-01 完善 validate**：在 `migration-control.service.ts` 中重新加载 source 和 preview，验证 schema、entrypoint、manifest、required capabilities、owner 和 revision；不信任客户端完整 payload。
- [ ] **M3-02 增加显式确认**：publish 必须满足 `confirm=true`、warnings 已确认、`decision=auto_convertible`、当前 preview 未过期、source hash 未变化。
- [ ] **M3-03 使用 Package Creator 发布**：调用现有 `D:\codeproject\JS\bloomai\src\server\skills\creator\skill-draft.service.ts` 及 Package repository；在同一事务中写 migration mapping、Package Version 和审计记录。
- [ ] **M3-04 保持 Version immutable**：发布后 Legacy source 变更只生成新 preview/新 Draft，不修改已发布 `skillVersionId`；版本差异由现有 Package diff API 展示。
- [ ] **M3-05 处理 capability grant**：迁移发布不得隐式 approve 网络、secret、filesystem；grant 必须由现有 policy/approval 流程独立完成。
- [ ] **M3-06 接入 Chat**：修改 `chat-skill-launcher.ts` 和相关 Chat tool，使 Package 运行返回 durable `runId`，Legacy 请求返回迁移建议且不创建 Run。
- [ ] **M3-07 UI 展示映射**：在 `LegacyMigrationPanel.tsx` 和 `SkillOverviewPanel.tsx` 展示 `legacy:<id> -> package:<id>@<version>`，同时保留旧 ID 历史查询链接。
- [ ] **M3-08 迁移失败事务测试**：注入 Version、mapping、artifact 任一写入失败，验证所有本次写入回滚；旧 Archive 数据不能被删除或修改。

阶段门禁 M3：至少一个 prompt-template fixture 完成 preview -> validate -> 人工确认 -> Package publish -> install -> grant -> run -> event -> artifact -> Chat 引用全链路；http-api/js-function 不可 publish。

### 阶段 4：Package-only 灰度和观察窗口（M4）

目标：证明生产流量已经只使用 Package Runtime，并为删除旧程序代码建立证据。

- [ ] **M4-01 开启 Package-only 路由**：Legacy run route 统一返回稳定 409；所有新建运行只进入 Package queue。
- [ ] **M4-02 只读观察窗口**：至少覆盖一个完整发布/使用观察窗口；统计 Legacy run 尝试数、迁移 preview 数、publish 数、blocked 数、Package run 成功率、capability denied 数和 secret-redaction 告警。
- [ ] **M4-03 对账历史数据**：按 `legacySkillId + sourceSha256` 对账 migration mapping、Package Version、report artifact 和审计日志；发现重复 mapping 或孤立 Version 时停止删除。
- [ ] **M4-04 执行依赖扫描**：确认生产 bundle、测试、脚本和动态 import 不再依赖 runner；旧 ID 只出现在 Archive/resolver/迁移测试允许范围。
- [ ] **M4-05 运行 release gate**：通过 `npm run test:skills:release-gate` 和迁移验收脚本后，才进入删除阶段。

阶段门禁 M4：观察窗口无 Legacy 实际执行；Package-only 运行链路稳定；无高危安全告警；历史数据对账通过；负责人签署删除批准。

### 阶段 5：删除 Legacy Runner（M5）

目标：删除不可再用的兼容执行代码，让架构边界由编译器和文件结构共同保证。

- [ ] **M5-01 删除 `run-skill.ts`**：先确认全仓库无 import，再删除文件和仅供其使用的类型。
- [ ] **M5-02 删除 `js-function.ts` 执行实现**：保留迁移阻断类型/测试需要的最小数据结构；若无读取需求则整体删除。
- [ ] **M5-03 删除 `mastra-tool-id.ts`**：确认没有生成、注册和历史运行依赖。
- [ ] **M5-04 删除 `http-api.ts` 执行方法**：只保留 manual-review extractor；若已有迁移模块完成接管，则删除旧文件并更新导入。
- [ ] **M5-05 收紧 Legacy barrel**：`index.ts` 只导出 Archive/迁移读取类型，禁止旧实现通过深层路径或 barrel 复活。
- [ ] **M5-06 清理文档和脚本引用**：更新注释、README、启动日志、测试 fixture 和构建入口；不得清理与本迁移无关的工作区文件。
- [ ] **M5-07 删除后全量验证**：运行 typecheck、unit、integration、security、migration、e2e 和静态扫描；任何失败都回到 M4 处理，不直接绕过。

阶段门禁 M5：代码、构建产物和 Mastra 工具清单都不存在 Legacy runner；Archive 读取、Package Runtime、迁移报告和最终 E2E 全部通过。

---
## 7. 测试策略和具体验收用例

### 7.1 测试分层原则

测试必须同时证明两件事：第一，安全的 `prompt-template` 能通过人工确认进入 Package Runtime；第二，Legacy 兼容层不会以任何隐式路径继续执行。测试不能只断言“接口返回成功”，还必须断言数据库、队列、worker、Mastra Tool、网络请求和 artifact 的副作用是否符合预期。

所有迁移测试使用离线 fixture 和 fake clock；除非专门的网络隔离测试，不允许真实调用外部 URL、模型 API、secret provider 或文件系统工作区之外的路径。测试运行应保持单 worker，避免共享本地数据库和临时目录产生非确定性。

### 7.2 单元测试计划

#### UT-01 类型分类与未知类型

文件：`D:\codeproject\JS\bloomai\src\server\skills\migration\migration-classifier.test.ts`

- [ ] `type=prompt-template` 返回 `auto_convertible`。
- [ ] `type=http-api` 返回 `manual_review`，原因包含网络 capability 风险。
- [ ] `type=js-function` 返回 `critical_blocked`，原因包含 arbitrary code execution 风险。
- [ ] 缺失 `type`、大小写不规范、对象伪造 `type` 或未知字符串返回 `unsupported`。
- [ ] 分类函数不访问网络、不读写 DB、不调用模型，spy 断言副作用计数为 0。
- [ ] 分类输出只包含白名单字段，输入中的额外可执行字段不会被原样带到 Package draft。

#### UT-02 source normalizer 和 source hash

文件：`D:\codeproject\JS\bloomai\src\server\skills\migration\source-normalizer.test.ts`

- [ ] 属性顺序、空白、换行和默认值规范化后，相同语义输入得到相同 canonical JSON。
- [ ] source hash 使用 SHA-256，输出长度和字符集固定。
- [ ] title/description 缺失时使用稳定默认值，不从模型生成文案。
- [ ] 输入过大、嵌套深度过深、数组元素过多时返回可识别的 validation error，不导致栈溢出。
- [ ] schema 中的 executable template、function source、动态 import 字段被拒绝或标记风险。
- [ ] source hash 变化时不会复用旧 preview；hash 不变时重复 preview 幂等。

#### UT-03 secret redaction

文件：`D:\codeproject\JS\bloomai\src\server\skills\migration\secret-redactor.test.ts`

- [ ] `Authorization`、`Proxy-Authorization`、`Cookie`、`Set-Cookie`、`x-api-key`、`api-key`、`token`、`secret`、`password`、`private-key` 等键统一脱敏。
- [ ] URL query 中 `access_token`、`sig`、`signature`、`key`、`credential` 脱敏。
- [ ] JSON body、环境变量、异常文本和日志字符串中的 Bearer/basic/token 片段脱敏。
- [ ] 已知 secret 的精确值和高熵值不会出现在 `MigrationReport`、`artifact`、错误 body 和日志中。
- [ ] 脱敏保持结构可读，method、host、path、header 名称和 token 类型摘要可以保留。
- [ ] 不因大小写、连字符、下划线或 Unicode 大小写变体绕过规则。

#### UT-04 prompt-template Package Draft

文件：`D:\codeproject\JS\bloomai\src\server\skills\migration\prompt-template-migrator.test.ts`

- [ ] 生成的 manifest 有固定 `schemaVersion`、入口类型、input/output schema 和 source metadata。
- [ ] 生成 draft 不创建 Package、Version、Installation、Grant、Run、Queue 或 Artifact 正式记录。
- [ ] draft 中不含旧 Legacy ID 作为可执行 entrypoint；只保存 `migrationSource.legacySkillId` 和 hash。
- [ ] 模板变量映射保持类型和 required/optional 语义；无法表达的字段进入 warnings，不静默丢弃。
- [ ] 旧模板包含 URL、工具调用、脚本或函数片段时进入 capability warning 或 blocked，而不是自动转换。
- [ ] 相同 source hash 的 draft 内容稳定、排序稳定、diff 稳定。

#### UT-05 HTTP API manual review

文件：`D:\codeproject\JS\bloomai\src\server\skills\migration\manual-review-report.test.ts` 与 `http-api.ts` 相关测试

- [ ] 只读取 URL、method、非敏感 header 名称、body schema 和 capability 需求摘要。
- [ ] 不创建 `fetch`/`undici` 请求；测试用 spy 断言请求次数为 0。
- [ ] 非 HTTP/HTTPS、内网 IP、localhost、file/data/javascript scheme、重定向链进入高风险/阻断报告。
- [ ] 认证配置只输出 `authPresent=true`、认证类型和修复建议，不输出值。
- [ ] 报告有人工动作列表：endpoint allowlist、timeout、egress policy、secret reference、response schema、错误重试策略。

#### UT-06 js-function critical block

文件：`D:\codeproject\JS\bloomai\src\server\skills\migration\manual-review-report.test.ts` 与 `js-function.ts` 相关测试

- [ ] 任何 function source 都返回 `LEGACY_MIGRATION_CRITICAL_BLOCKED`。
- [ ] 输入字符串含 `eval`、`Function`、`vm`、`require`、`import()`、`child_process`、`fs`、网络模块时仍是 blocked，而不是尝试分析后放行。
- [ ] 迁移流程没有创建 VM、Worker、子进程或动态模块实例。
- [ ] 报告列出重写方向：typed input/output、显式 capability、可审计 Package handler；不执行旧函数获取“样例结果”。

#### UT-07 ID、错误和 side-effect guard

文件：`D:\codeproject\JS\bloomai\src\shared\skill-references.test.ts`、`D:\codeproject\JS\bloomai\src\server\skills\legacy\compatibility.test.ts`

- [ ] `legacy:<id>`、`package:<id>`、无前缀 ID 的解析互斥且符合上下文规则。
- [ ] Legacy create/install/update/remove/run 均返回预期错误码。
- [ ] Legacy run 失败前后，`skills`、`skill_runs`、Package 表、queue 和 artifacts 记录数相同。
- [ ] Package run 不能接受 Legacy reference；同步旧 run 入口不能创建 Package run。
- [ ] 历史 runs 的读取不会暴露可执行 payload 或明文敏感字段。

#### UT-08 migration control

文件：`D:\codeproject\JS\bloomai\src\server\skills\migration\migration-control.service.test.ts`

- [ ] validate 会重新读取 source/preview，客户端篡改 draft 后校验失败。
- [ ] `expectedRevision` 不匹配返回冲突；并发 publish 最多一个成功。
- [ ] publish 前必须经过 validate、warning acknowledgement、owner 权限和 source hash 检查。
- [ ] http-api、js-function、unknown 的 publish 均被阻止。
- [ ] publish 失败时 mapping、Version、artifact 和审计写入全部回滚。
- [ ] 已发布 Version 的再次 publish 生成新 revision 或明确幂等响应，不能覆盖 immutable Version。

### 7.3 冒烟测试计划

冒烟测试用于每次本地开发、CI 预检和发布候选包，目标是 3 分钟内发现路由、数据库、构建和运行入口的致命问题。建议实现为 `D:\codeproject\JS\bloomai\scripts\verify-legacy-skills-migration.ts`，并在 `package.json` 增加 `test:skills:migration:smoke` 脚本。

#### Smoke-01 静态和类型冒烟

```powershell
npm run typecheck:skills
rg -n "legacy_skill_|run-skill|eval\(|new Function|child_process|vm\." D:\codeproject\JS\bloomai\src\server\mastra D:\codeproject\JS\bloomai\src\server\skills
```

预期：TypeScript 通过；阻断模式下不会出现 Legacy Tool 注册或旧执行构造器的有效调用。若命中仅为测试 fixture、错误文案或迁移报告规则，必须有明确 allowlist 注释和对应测试。

#### Smoke-02 Legacy Archive 读取

```powershell
npm run start:server
```

在隔离测试数据库中执行：

```text
GET /skills/overview?runtimeKind=legacy
GET /skills/legacy:fixture-prompt
GET /skills/legacy:fixture-prompt/runs
GET /skills/legacy:fixture-prompt/migration-preview
```

预期：列表、详情、历史 runs 和 preview 可读；返回 `readOnly=true`；不存在的历史 ID 为 404；不会创建新 run 或 queue item。

#### Smoke-03 Legacy 写/运行阻断

```text
POST   /skills/legacy:fixture-prompt/run       -> 409 LEGACY_SKILL_RUN_DISABLED
PATCH  /skills/legacy:fixture-prompt           -> 409 LEGACY_SKILL_FROZEN
DELETE /skills/legacy:fixture-prompt           -> 409 LEGACY_SKILL_FROZEN
POST   /skills/install                         -> 409 LEGACY_SKILL_FROZEN
```

预期：所有响应 body 都有稳定 `code`、可读 `message`、`requestId`；数据库表、队列和 worker 调用计数不变。

#### Smoke-04 安全 preview

```text
POST /skills/legacy:fixture-prompt/migration/inspect
POST /skills/legacy:fixture-prompt/migration/preview
POST /skills/legacy:fixture-http/migration/preview
POST /skills/legacy:fixture-js/migration/preview
```

预期：prompt-template 得到 deterministic draft preview；http-api 得到 manual review；js-function 得到 critical blocked；三条路径都不访问外部网络。

#### Smoke-05 Package-only 运行入口

使用既有 Package fixture：

```text
POST /skill-package-runtime/runs       -> 202，返回 runId
GET  /skill-package-runtime/runs/:id  -> 能读取状态/revision
GET  /skill-package-runtime/runs/:id/events -> 能读取事件
```

预期：Package Run 走 queue/worker/event/artifact；把 `legacy:fixture-prompt` 传给同一入口时返回 409，不创建任何 Package Run。

### 7.4 集成测试计划

#### IT-01 Route -> Service -> Repository

文件：`D:\codeproject\JS\bloomai\tests\integration\skill-runtime\legacy-migration.integration.test.ts`

- [ ] 使用真实测试 DB、真实 Hono route 和实际 error mapper，不用只验证 mock service。
- [ ] inspect/preview/validate/publish 的 request context、owner、tenant、revision 正确传递。
- [ ] 迁移 record、report artifact、Package Draft/Version 的关联可通过 repository 查询。
- [ ] 重复 preview 不重复创建正式资源；重复 publish 返回幂等结果或 revision conflict。

#### IT-02 数据库事务和幂等

- [ ] 迁移开始前快照旧 `skills`、`skill_runs`；结束后旧行内容、数量和主键不变。
- [ ] prompt-template publish 成功时 mapping、Package Version、审计和 report artifact 一致提交。
- [ ] 在每一个写入点注入异常，验证事务回滚且没有孤立 queue、grant、artifact 或 Version。
- [ ] 两个并发 publish 只允许一个提交；另一个得到稳定冲突/幂等响应。
- [ ] source hash 相同但 display title 不同不会生成第二个 Version；source hash 变化会生成新 revision。

#### IT-03 Package Runtime 边界

- [ ] 由迁移 publish 生成的 Package 能被现有 inspect/import review/install API 读取。
- [ ] Installation enable/disable、Grant approve/reject/revoke、Run start/list/get/events/stream/commands/cancel、Artifact list/content/export 均不读取 Legacy runner。
- [ ] grant 未批准时不调用外部 capability；批准后只授予 manifest 声明的最小 capability。
- [ ] Run 事件包含 migration provenance，但不含旧函数源码、token 或 cookie。

#### IT-04 Chat 和 Mastra

- [ ] Chat 传 `legacy:<id>` 时返回只读迁移建议，不能创建 Chat Run。
- [ ] Chat 传 `package:<id>` 时创建 durable Package Run，消息包含 `data-skill-run` 引用。
- [ ] Mastra 工具清单无 `legacy_skill_`；工具调用旧 ID 得到结构化 blocked response。
- [ ] worker 重启、重复事件和客户端重试不会让 Legacy 被重新执行，也不会生成重复 Package Run。

#### IT-05 前后端合同

- [ ] Skills Center 列表、详情、迁移 preview、人工审查、发布确认和历史 runs 使用同一 `runtimeKind/lifecycle/readOnly` 字段。
- [ ] 409/422/404 的错误码在 UI 显示为可理解的动作建议，而不是通用“运行失败”。
- [ ] UI 刷新、返回、重复点击和离线/超时状态不会误把 preview 显示成已发布或把 blocked 显示成可运行。

### 7.5 安全测试计划

文件：`D:\codeproject\JS\bloomai\tests\security\legacy-skill-migration.security.test.ts`

#### SEC-01 SSRF 和网络 capability

- [ ] migration preview 不发请求；使用 fetch/undici spy 和网络 socket deny 验证。
- [ ] `http://127.0.0.1`、`localhost`、`0.0.0.0`、RFC1918 地址、IPv6 loopback、云 metadata 地址、DNS rebinding 形式均标记高风险或阻断。
- [ ] `file:`, `data:`, `javascript:`, `gopher:`、混合大小写和 URL 编码形式不被当作可执行 HTTP endpoint。
- [ ] 重定向、非标准端口、超长 URL、重复 query 和 CRLF header 注入进入审查报告。
- [ ] 自动迁移永远不授予 network capability；人工批准也必须走 Package policy grant。

#### SEC-02 secret 泄露

- [ ] 伪造 Authorization、cookie、OAuth code、JWT、API key、SSH private key、数据库连接串和高熵随机串。
- [ ] 检查 HTTP response、错误 response、日志、迁移 artifact、Package manifest、审计事件、UI preview 和导出文件均不含 secret。
- [ ] `sourceSha256`、report artifact ID 和 capability 摘要可以保留，但不能通过 hash/preview 反推出原 secret。
- [ ] redaction 失败时整个迁移操作 fail closed，返回稳定安全错误，不继续 publish。

#### SEC-03 任意代码执行

- [ ] js-function fixture 含 `eval`、`new Function`、`vm.runInNewContext`、`require('child_process')`、动态 import、文件写入和网络调用探针。
- [ ] 运行 preview/validate/publish 时探针文件不存在、端口未监听、子进程数不增加、VM 未创建。
- [ ] 构建产物和 server bundle 不包含旧 js-function runner 的可达 import。
- [ ] 通过别名、Unicode、字符串拼接、压缩源码和嵌套字段也不能绕过 critical block。

#### SEC-04 权限、租户和重放

- [ ] owner A 不能 inspect/preview/publish owner B 的 Legacy Skill 或 Draft。
- [ ] tenant A 的 migration mapping、artifact、Package Version 不可被 tenant B 通过 ID 或旧 ID 读取。
- [ ] publish 请求带过期 revision、重复 nonce、重放 requestId、篡改 source hash 时失败且不写入。
- [ ] 只有有权审批 capability 的角色可以处理 grant；迁移服务不能自授予。

#### SEC-05 资源边界和拒绝服务

- [ ] 限制 body size、模板长度、JSON 深度、数组数量、header 数量、URL 长度和报告 artifact 大小。
- [ ] 原型污染键 `__proto__`、`constructor`、`prototype` 被拒绝或安全解析。
- [ ] 恶意循环引用、超深对象、超大 Unicode、重复键不会导致崩溃或无限耗时。
- [ ] 失败 preview 不留下大文件、queue item、临时 secret 或未清理的连接。

### 7.6 最终 Skills E2E 测试

文件：`D:\codeproject\JS\bloomai\tests\e2e\skills\legacy-skills-migration.browser.test.ts`。测试继续使用现有 Playwright Chromium 离线 Harness；不依赖真实模型、外部网络或真实 secret。

#### E2E-01 Legacy 列表和只读详情

- [ ] 打开 Skills Center，能看到 prompt-template、http-api、js-function 和 unknown fixture。
- [ ] 每张 Legacy 卡片显示 Archive/只读标签、类型、source hash、迁移状态和历史 runs 数。
- [ ] 安装、编辑、删除、运行按钮不可用；点击后显示冻结原因和稳定错误码。
- [ ] 打开详情、历史 runs 和旧引用不会改变数据库或 queue。

#### E2E-02 prompt-template 迁移 preview

- [ ] 从 Legacy 详情进入迁移面板。
- [ ] 点击 Inspect，显示 source hash、规范化字段、warnings、required capabilities 和 side effects=`none`。
- [ ] 点击 Preview，显示 Package Draft manifest/diff、输入输出 schema 和 provenance。
- [ ] 刷新页面或重复点击 Preview，preview ID/source hash/revision 保持幂等；UI 不显示“已发布”。
- [ ] 断言 network log 无外部 endpoint 请求，日志/页面不出现 fixture secret。

#### E2E-03 http-api 人工审查

- [ ] 打开 http-api fixture，页面显示 Manual review required。
- [ ] 展示 method/host/path、认证类型摘要、capability 风险和人工检查清单。
- [ ] Authorization、cookie、x-api-key 等值以 `[REDACTED]` 或存在性摘要显示。
- [ ] Publish 按钮不可用；界面明确要求重写为 typed Package capability 后再发布。
- [ ] 浏览器网络面板没有对 fixture endpoint 的请求。

#### E2E-04 js-function critical block

- [ ] 打开 js-function fixture，页面显示 Critical blocked。
- [ ] 展示禁止原因和重写建议，不展示或执行完整函数源码。
- [ ] Inspect/Preview 可以生成阻断报告，但 Publish 不可用。
- [ ] 测试探针确认无文件、网络、子进程或 VM 副作用。

#### E2E-05 prompt-template 人工确认发布

- [ ] 在 preview 中查看 warnings 和 capability 列表。
- [ ] 未勾选 warning acknowledgement 时 Publish 被拒绝。
- [ ] 勾选确认并提交后，UI 显示 Package ID、Version ID、migration mapping 和审计时间。
- [ ] 重新打开 Legacy 详情仍显示只读；Package 详情显示 immutable Version 和来源 Legacy ID。
- [ ] 修改 Legacy fixture source hash 后重新 preview，旧 Version 不变，新增 revision/diff 可见。

#### E2E-06 Package 安装、授权和运行

- [ ] 从迁移结果进入 Package review，检查 manifest、capability 和 source provenance。
- [ ] Install/enable 成功后，未批准 grant 时 Run 处于 blocked/pending，不发起 capability。
- [ ] 完成最小 grant approval 后，启动 Package Run 返回 durable `runId`，状态通过 event stream 更新。
- [ ] 页面显示事件、命令、取消和 artifact；导出内容不含旧 secret。
- [ ] 关闭/刷新浏览器后仍可通过 `runId` 恢复状态，不把 Legacy ID 当作 active run。

#### E2E-07 Chat 端到端

- [ ] 在 Chat 中引用 `legacy:<id>`，助手返回迁移/历史查看建议，不创建 Run。
- [ ] 在 Chat 中引用已发布 `package:<id>`，创建 Package Run；消息中存在 `data-skill-run`。
- [ ] 运行期间刷新 Chat，run 状态、事件和 artifact 仍可恢复。
- [ ] 尝试通过旧 Mastra Tool 名称调用 Legacy，得到结构化阻断，不触发执行。

#### E2E-08 异常、重试和回滚

- [ ] 模拟 preview 超时、DB 错误、revision 冲突、grant 拒绝、worker 重启和 artifact 写入失败。
- [ ] UI 显示可重试/需人工处理/已阻断的准确状态；不显示成功假象。
- [ ] 重试不会重复创建 migration mapping、Package Version、Run 或 Artifact。
- [ ] 回滚开关开启后，Legacy 仍只读、已发布 Package Version 仍可读取，只有新 publish 被暂停；禁止恢复旧 runner。

#### E2E-09 最终技能发布门禁

发布候选必须按以下顺序执行：

```powershell
npm run typecheck:skills
npm run test:skills:unit
npm run test:skills:integration
npm run test:skills:security
npm run test:skills:migration
npm run test:skills:e2e
npm run test:skills:release-gate
npx tsx scripts/verify-legacy-skills-migration.ts
```

预期：所有命令退出码为 0；最终脚本输出 JSON，至少包含 `legacyReadOnly=true`、`legacyRunBlocked=true`、`promptTemplatePublished=true`、`httpApiManualReview=true`、`jsFunctionBlocked=true`、`packageE2E=true`、`secretLeak=false`、`externalNetworkCalls=0` 和 `orphanedRecords=0`。任何字段为 false 都不能进入发布。

---
## 8. 发布、回滚和运行手册

### 8.1 发布前检查

发布前必须在干净的测试数据库、隔离的本地网络和固定 Node 版本下执行。Windows PowerShell 命令使用仓库根目录 `D:\codeproject\JS\bloomai` 运行。

- [ ] 确认工作区只包含本任务允许的迁移改动和既有无关改动；不执行 `git reset --hard`、`git clean` 或批量删除。
- [ ] 确认 Node 版本满足 `>=22.16.0`，依赖锁文件没有被迁移任务无关地更新。
- [ ] 执行数据库备份/快照，保存 `skills`、`skill_runs`、Package Runtime 表和 migration record 的行数、最大 ID、checksum。
- [ ] 执行 `npm run typecheck:skills`，确认无 Legacy runner 的未解析 import。
- [ ] 执行全部 Skills release gate 和迁移验证脚本。
- [ ] 检查配置：`legacyWrites=false`、`legacyRuns=false`、`migrationPreview=true`、`migrationPublish` 仅对授权 owner 开启、`externalNetwork=false`。
- [ ] 确认 worker、queue、event、artifact、Chat 和 Mastra 启动日志均显示 Package-only 运行策略。
- [ ] 确认监控/日志中已配置以下事件：`legacy_run_blocked`、`migration_previewed`、`migration_manual_review`、`migration_critical_blocked`、`migration_published`、`package_run_started`、`migration_secret_redaction_failed`、`migration_transaction_rolled_back`。

### 8.2 分批发布顺序

1. **只读代码发布**：先发布 M1，关闭 Legacy 写和 run，保留查询与报告；不打开 publish。
2. **分析能力发布**：发布 M2，允许 inspect/preview；默认只在管理员/开发租户开放。
3. **人工确认发布**：发布 M3，只开放 `prompt-template`，每个 publish 请求需要 owner 和显式确认。
4. **Package-only 灰度**：发布 M4，所有新运行只走 Package queue；观察窗口内不删除旧 runner。
5. **删除代码发布**：完成 M5 后发布，构建图中删除 runner、旧同步 Mastra Tool 和执行 barrel。

每一步发布后执行 Smoke-02、Smoke-03 和 Smoke-05；M2/M3 额外执行 E2E-02 至 E2E-06；M5 额外执行静态依赖扫描和全量 release gate。

### 8.3 运行期处置手册

#### 情形 A：发现 Legacy run 请求

1. 查询 `legacy_run_blocked` 指标和 requestId。
2. 确认响应为 409 `LEGACY_SKILL_RUN_DISABLED`，且 `skill_runs`、queue、worker 调用数没有增加。
3. 将请求方引导到迁移 preview 或历史 runs 查询；不通过临时开关恢复执行。
4. 如果请求量异常增长，暂停 migration publish，并检查 UI、Chat、Mastra 是否仍在生成旧引用。

#### 情形 B：发现 secret 泄露疑似

1. 立即关闭 migration preview/publish 功能开关，保留 Archive 读取和 Package 既有运行。
2. 以 requestId、migration record、artifactId 和 source hash 定位泄露边界；不在工单或日志中复制 secret。
3. 轮换受影响凭据，标记相关 artifact/报告不可导出，执行 redaction regression test。
4. 修复并完成 SEC-02、E2E-02/E2E-03 后再恢复 preview；未经安全负责人确认不得恢复 publish。

#### 情形 C：Package publish 事务或数据对账失败

1. 关闭新 publish，保留旧 Package Version 和 Legacy Archive 只读。
2. 检查 migration mapping、Version、report artifact 和审计记录是否存在孤立项。
3. 从数据库快照恢复**迁移新增记录**或执行针对 migration record 的补偿脚本；不得删除旧 `skills`、旧 `skill_runs`。
4. 重跑 IT-02，确认失败事务不会留下 queue、grant、installation 或 active run。
5. 通过 release gate 后再恢复 publish。

### 8.4 回滚层级

| 层级 | 触发条件 | 动作 | 不允许的动作 |
|---|---|---|---|
| R0 功能开关回滚 | preview/publish 逻辑异常但服务健康 | `migrationPreview=false` 或 `migrationPublish=false`；Legacy 仍只读、Package 已有 Run 继续 | 不得开启 Legacy run |
| R1 路由回滚 | 迁移路由错误、权限错误、数据异常 | 停止新迁移 route，保留 `GET` Archive 和 409 run 阻断；Package Runtime 独立运行 | 不得把请求 fallback 到旧 runner |
| R2 代码版本回滚 | 新代码导致 Package Runtime 基线回归 | 回到上一个已验证 Package-only 版本；若该版本含旧 runner，必须同时通过配置/路由永久禁用执行 | 不得为了回滚数据而恢复任意 JS/http 执行 |
| R3 数据补偿 | mapping/Version/artifact 写入不完整 | 使用事务补偿或从迁移前快照恢复本次新增记录；保留旧历史数据 | 不得清空整个 `skills`/`skill_runs` 表 |
| R4 安全事件处置 | secret 泄露、SSRF、代码执行疑似 | 关闭迁移功能、轮换凭据、隔离 artifact、保留审计证据、修复后重新跑安全门禁 | 不得通过临时白名单绕过安全测试 |

M5 删除 runner 后不接受“恢复旧 Legacy runner”作为正常回滚方案。此时只能回滚到已经证明 Legacy run 被阻断的构建，或采用前向修复；任何需要重新带入 runner 的紧急构建都必须重新经过安全评审、独立审批和全量 E2E，不能作为默认 runbook。

### 8.5 数据保留和恢复

- `skills`、`skill_runs`、历史消息、旧 ID 和 migration mapping 在观察窗口及合规要求期限内只读保留。
- Package Version、Installation、Run、Event、Artifact 按现有 Package retention policy 管理；迁移 provenance 不得被清理成无法追溯的孤立记录。
- 迁移报告可以标记 archived，但不能以删除报告来掩盖失败或安全告警。
- 恢复时先恢复 schema/索引，再恢复数据；恢复完成后执行 row count、checksum、foreign key、引用 resolver 和 release gate。

---

## 9. 验收标准

验收必须由开发、测试、安全和产品/运营各自确认；只通过单元测试不能视为迁移完成。下表中的“证据”必须可从测试报告、命令输出、审计查询或浏览器录像/截图中复现。

### 9.1 功能验收

| 编号 | 验收条件 | 通过标准 | 证据 |
|---|---|---|---|
| AC-F01 | Legacy Archive 可读 | 列表、详情、历史 runs、旧 ID 和历史消息可查询；分页/404 正确 | `compatibility.test.ts`、Smoke-02、E2E-01 |
| AC-F02 | Legacy 写入冻结 | create/install/update/delete 对 Legacy 返回 409 `LEGACY_SKILL_FROZEN`，不写 DB | route integration、Smoke-03 |
| AC-F03 | Legacy 运行关闭 | 所有 Legacy run 入口返回 409 `LEGACY_SKILL_RUN_DISABLED`，不入队、不调用 worker | side-effect spy、SEC-03、E2E-01 |
| AC-F04 | prompt-template 可迁移 | inspect/preview/validate 成功；内容确定性、幂等；仅人工确认可 publish | UT-04、IT-01/02、E2E-02/E2E-05 |
| AC-F05 | http-api 不自动执行 | 生成脱敏 manual-review 报告，不能 publish，零外部请求 | UT-05、SEC-01/02、E2E-03 |
| AC-F06 | js-function 不自动执行 | 返回 critical blocked；无 VM/eval/Function/子进程/网络副作用 | UT-06、SEC-03、E2E-04 |
| AC-F07 | Package 是唯一新运行入口 | 已发布 Package 能 install/enable/grant/run/events/artifacts；Legacy ref 被拒绝 | IT-03、Smoke-05、E2E-06 |
| AC-F08 | Chat 协议正确 | Legacy 只给迁移/历史建议；Package 生成 durable run 和 `data-skill-run` | IT-04、E2E-07 |
| AC-F09 | Mastra 兼容层移除 | 工具清单无 `legacy_skill_`；旧工具名结构化阻断 | Mastra startup assertion、E2E-07 |

### 9.2 数据和一致性验收

- [ ] 迁移前后 `skills` 与 `skill_runs` 历史行数、主键和核心字段 checksum 一致；允许增加只读迁移审计字段，但不允许修改历史语义。
- [ ] 每个成功 publish 的 migration record 都能关联一个 `packageId`、`skillVersionId` 和 report artifact；没有 orphan mapping。
- [ ] 每个 blocked/manual-review 类型都有 report、decision、reason 和 actor；没有无原因的“失败”。
- [ ] 同一 `legacySkillId + sourceSha256` 重复 preview/publish 不产生重复正式资源。
- [ ] source hash 变化时旧 Package Version immutable，且新的 migration revision 可查询。
- [ ] 事务故障、并发 publish、重试和 worker 重启不会产生重复 Run、queue item、grant 或 artifact。

### 9.3 安全验收

- [ ] `secretLeak=false`：测试输入中的所有 secret 不出现在 HTTP response、日志、artifact、manifest、UI、审计和导出文件。
- [ ] `externalNetworkCalls=0`：inspect/preview/validate/publish 的自动流程不访问外部 endpoint；Package 运行的网络能力只能在 grant 后执行。
- [ ] `jsFunctionExecutionCount=0`：迁移过程中没有 VM、eval、Function、child process、动态代码执行。
- [ ] SSRF、本地地址、metadata 地址、非 HTTP scheme、重定向和 DNS rebinding 测试全部通过。
- [ ] owner/tenant/revision/replay/CSRF/权限测试全部通过；未授权用户不能查看或发布其他主体的迁移。
- [ ] body、模板、URL、header、JSON 深度和 artifact 尺寸边界测试全部通过，服务不会 OOM 或无限耗时。

### 9.4 UI 和可运维性验收

- [ ] Legacy 页面始终显示只读/不可运行原因，不能出现误导性“Run”按钮。
- [ ] 三类 Legacy 的状态、动作和错误提示有明确差异；用户可以知道下一步是 preview、人工审查、重写还是仅查看历史。
- [ ] Package 迁移结果可回到来源 Legacy、Package Version、Run、Event 和 Artifact；链路可追踪。
- [ ] 所有阻断事件有 requestId、migrationId 或 runId，日志中不含敏感输入。
- [ ] 通过健康检查、启动、停止、worker 重启和浏览器刷新场景；不需要手工删除临时文件才能恢复。

### 9.5 发布门禁验收

以下条件必须同时满足：

```text
unit = pass
integration = pass
security = pass
migration-db = pass
e2e = pass
release-gate = pass
legacy_run_count = 0
external_network_calls_during_migration = 0
secret_leak_count = 0
orphaned_migration_records = 0
package_runtime_regression = 0
```

任一条件不满足，状态只能是 `migration_blocked`，不能标记为完成，不能删除 runner。

---

## 10. 边界和约束

### 10.1 本次迁移包含的范围

- Legacy Skill 的只读 Archive、历史引用、历史 runs 和迁移 provenance。
- `prompt-template` 的确定性 preview、Package Draft、人工 validate/confirm/publish。
- `http-api` 的脱敏分析和 manual-review 报告。
- `js-function` 的 critical block 和 typed capability 重写指引。
- Legacy HTTP/API、Mastra、Chat、Skills Center UI、Package Runtime 边界。
- 数据库迁移记录、审计、幂等、事务、回滚和完整测试门禁。

### 10.2 明确不包含的范围

- 不把 `http-api` 自动转换为可以直接发网络请求的 Package。
- 不把任意 `js-function` 自动转换到新的 JavaScript 沙箱、VM、Worker 或 eval 路径。
- 不恢复 Legacy 同步 runner、同步 Mastra Tool 或 `POST /skills/:id/run` 的执行语义。
- 不删除 `skills`、`skill_runs`、历史消息、旧 ID、审计和可追溯 provenance。
- 不在 migration preview 中调用真实模型、真实 endpoint、真实 secret provider 或真实用户账号。
- 不借本任务修改与迁移无关的 MCP、UI 设计、安装器、图标、其他文档或未跟踪文件。
- 本计划只写入 `D:\codeproject\JS\bloomai\docs\skills\004-legacy-skills-migration-implementation-plan-v1.0.md`；不在计划编写阶段执行 `.superpowers` 删除、commit 或 push。

### 10.3 技术约束

- Node.js 必须满足 `D:\codeproject\JS\bloomai\package.json` 的 `>=22.16.0`；TypeScript 编译目标、Hono、Drizzle、Zod、Vitest、Playwright 和 React 版本沿用仓库现有依赖。
- 测试默认使用本地隔离 DB、单 worker、固定时钟、离线 Browser Harness；不以网络可用性作为测试通过条件。
- 所有新增 HTTP body、query、manifest、migration report 都必须有 Zod/领域 schema；禁止 `any` 绕过边界后直接写 DB 或启动 Run。
- 所有迁移写入必须在明确的事务边界内，所有副作用必须在 response/审计中可识别；preview 默认 zero side effect。
- 所有文件路径必须使用仓库绝对路径记录；实现时不得改变数据库中已有旧 ID 的大小写或编码语义。
- 所有旧引用必须可解析但不可执行；所有新 Package 引用必须显式带 Package 语义或经过严格 resolver。
- 任何网络 capability、secret、filesystem、process、browser automation capability 都不得从 Legacy 配置隐式继承。
- 所有错误都必须是稳定领域错误或经过统一 mapper 的 HTTP 错误；不能把 stack trace、原始请求 header 或函数源码返回给客户端。

### 10.4 兼容性约束

- 历史消息中的无前缀旧 ID 继续可展示和查询，但在 Chat/Run 上下文中必须先归一化为 `legacy:<id>` 并阻断执行。
- 旧 API 客户端收到 409 后，应能通过错误码判断“已迁移/已冻结”，不能依赖 message 文案做分支。
- 迁移报告 schema 必须向后兼容读取；新字段采用可选字段，旧报告缺失字段时使用安全默认值。
- Package Version 的 provenance 要包含 Legacy source hash，保证审计方能从 Package 追溯到原记录，但不复制敏感原文。

### 10.5 工作区和版本控制约束

- 只允许修改任务清单列出的文件；禁止 reset、clean、rebase、强制 checkout 或覆盖用户已有改动。
- 计划阶段不执行代码删除、数据库迁移、commit、push；实施阶段的 commit 应按 M0-M5 分成可回滚小提交。
- 若必须修改共享路由注册、schema 或错误 mapper，先记录影响文件和测试范围，再改动；不要用大范围格式化掩盖真正变更。
- 删除文件前必须提交引用扫描结果；删除后必须提交 typecheck 和 release gate 结果。

---

## 11. 风险、依赖和退出条件

### 11.1 风险矩阵

| 风险 | 概率/影响 | 触发信号 | 缓解措施 | 退出条件 |
|---|---|---|---|---|
| Legacy ID 仍从 Chat/Mastra 进入运行 | 中/高 | 出现旧 run 请求、同步 tool 调用或 active run | 统一 resolver、路由 409、工具清单断言、观测窗口统计 | 连续观察窗口无实际 Legacy 执行 |
| http-api preview 发生真实网络请求 | 中/高 | socket/fetch spy 非零、外部服务日志有请求 | preview 纯函数、网络 deny、SEC-01 和 E2E 网络断言 | 所有迁移自动流程 `externalNetworkCalls=0` |
| secret 写入报告/日志/artifact | 中/极高 | redaction test 失败或告警 | 双层 redaction、fail closed、artifact 扫描、凭据轮换手册 | SEC-02 全通过且无开放告警 |
| js-function 通过旁路执行 | 低/极高 | VM、子进程、文件、端口探针被触发 | critical block、删除 runner/barrel、bundle 静态扫描 | `jsFunctionExecutionCount=0` |
| prompt-template 语义丢失 | 中/中 | 变量/输出 schema diff 不一致 | deterministic normalizer、人工 preview、warnings 必须确认 | Golden fixture diff 经 owner 签署 |
| 重复迁移产生多版本 | 中/高 | 相同 hash 出现多个 mapping/Version | DB unique constraint、revision、幂等 publish、并发测试 | orphan/duplicate 对账为 0 |
| 历史数据被误删/修改 | 低/极高 | checksum/row count 变化、旧消息断链 | Archive read-only、备份、事务和回滚脚本 | checksum 与引用查询一致 |
| Package Runtime 回归 | 中/高 | 既有 Package E2E 或 release gate 失败 | 复用现有 Runtime、不复制 runner、每阶段运行全量 gate | Package regression 为 0 |
| UI 显示错误状态 | 中/中 | Legacy 出现 Run、blocked 显示成功、刷新丢状态 | 统一 lifecycle DTO、浏览器 E2E、状态机 reducer | E2E-01 至 E2E-09 全通过 |
| 迁移任务造成工作区冲突 | 中/中 | 无关文件被修改或被清理 | 文件白名单、独立提交、禁止 reset/clean | 工作区差异可解释且无无关删除 |

### 11.2 外部和内部依赖

- 现有 Package Runtime 表、repository、queue/worker、grant、event、artifact、Chat launcher 和 route registry 必须可在测试环境启动。
- `D:\codeproject\JS\bloomai\src\server\db\` 的迁移 runner 必须支持可重复执行、事务失败回滚和测试数据库重建。
- Skills Center 的浏览器 Harness 必须支持离线 fixture、网络拦截、文件探针和数据库状态查询。
- 发布环境必须有迁移开关、审计日志、requestId、指标和 artifact 扫描能力；没有这些能力时只能停留在 preview，不得进入 publish 或删除 runner。
- 负责人工审查的角色必须能够确认 prompt schema、capability、网络 endpoint、secret reference 和输出兼容性；没有 owner 审查时 publish 不可用。

### 11.3 必须停止实施的条件

出现以下任一情况立即停止当前阶段，状态标记为 `migration_blocked`，保留已完成的只读和审计能力：

- Legacy 实际执行次数大于 0，或 Package Runtime 入口接受了 Legacy reference。
- 自动迁移产生外部网络请求、secret 泄露、任意代码执行或未授权 capability grant。
- 历史 `skills`/`skill_runs` 数据 checksum 变化且无法解释，或出现孤立 migration mapping/Version/Artifact。
- 同一 source hash 产生重复正式 Version，或并发 publish 能绕过 revision/owner 检查。
- Package Runtime 既有 release gate、worker 恢复、Artifact 导出或 Chat durable run 出现回归。
- 任何测试依赖真实外部服务、临时人工改库或“先忽略失败再发布”。
- 工作区发生与本任务无关的批量删除、重置或未授权文件修改。

---

## 12. Definition of Done

迁移只有在下列所有 checkbox 都完成后才算完成；“代码已经删除”本身不是完成条件。

### 12.1 设计和实现

- [ ] Legacy 生命周期、三种类型策略、ID resolver、错误码和权限边界已实现并有测试。
- [ ] Archive Plane 可读，Legacy 写和运行完全冻结；旧历史数据、消息和引用保持可追溯。
- [ ] prompt-template 具备 deterministic inspect/preview、Draft、validate、人工确认和 Package publish。
- [ ] http-api 只生成脱敏 manual-review 报告，不能自动联网或 publish。
- [ ] js-function 和 unknown 类型安全阻断，不能进入任何执行器。
- [ ] Package Runtime、Chat、UI 和 Mastra 都没有 Legacy 执行分支。
- [ ] migration mapping、source hash、revision、审计、报告和 Package provenance 完整可查。

### 12.2 测试和安全

- [ ] `npm run typecheck:skills` 通过。
- [ ] `npm run test:skills:unit` 通过。
- [ ] `npm run test:skills:integration` 通过。
- [ ] `npm run test:skills:security` 通过。
- [ ] `npm run test:skills:migration` 通过。
- [ ] `npm run test:skills:e2e` 通过。
- [ ] `npm run test:skills:release-gate` 通过。
- [ ] `npx tsx scripts/verify-legacy-skills-migration.ts` 输出全部强制字段为通过。
- [ ] SSRF、secret leak、arbitrary code execution、越权、replay、DoS 边界均有负向测试且通过。
- [ ] 至少一个 prompt-template fixture 完成完整 Package E2E；http-api/js-function fixture 完成 manual-review/blocked E2E。

### 12.3 数据和发布

- [ ] 旧 `skills`、`skill_runs`、历史消息和旧 ID 的 row count/checksum/引用关系已对账。
- [ ] migration record 与 Package Version/Artifact/审计关系无孤立项、无重复项。
- [ ] 发布前快照、回滚开关、补偿脚本和处置联系人已验证。
- [ ] 观察窗口内 Legacy 实际执行为 0，旧 run 请求均为稳定 409。
- [ ] Package-only 运行统计、失败率、事件恢复和 Artifact 导出无回归。
- [ ] M5 删除清单中的 runner、旧同步 Mastra Tool 和执行 barrel 已从构建图移除。
- [ ] 删除后全仓库 `rg`、typecheck、release gate 和最终 E2E 通过。

### 12.4 文档和交接

- [ ] 迁移文件地图、任务 checkbox、命令、预期结果、回滚和边界已写入本文件。
- [ ] 运行手册包含 Legacy run、secret 泄露、事务失败和 Package 回归的处置步骤。
- [ ] 迁移报告字段、错误码、审计事件和指标名称已交给维护者。
- [ ] 未完成/被阻断的 Legacy Skill 有可查询的原因、owner、下一步动作和历史记录。
- [ ] 实施提交按阶段可回滚，提交说明能对应 M0-M5 任务编号。

---

## 13. 最终实施顺序和执行清单

以下顺序是实施时的单一执行顺序，不允许跳过阶段门禁：

1. [ ] 读取本计划和现有 Skills Runtime 代码；建立 M0 基线清单，不改动无关文件。
2. [ ] 添加错误码、feature flag、审计字段、迁移 schema/repository 和只读 side-effect guard。
3. [ ] 先写 M0/M1 单元和集成测试，再冻结 Legacy registry、service、route、Chat 和 Mastra。
4. [ ] 通过 `npm run typecheck:skills`、unit、integration、security；确认旧历史查询和 Package Runtime 都没有回归。
5. [ ] 实现 classifier、normalizer、redactor、prompt-template migrator、manual-review report 和 preview service。
6. [ ] 为四类 fixture 写 UT-01 至 UT-08 和 Smoke-04；确认 preview 零副作用、HTTP 零请求、JS 零执行。
7. [ ] 接入 migration route、Creator Draft 和前端迁移面板；完成 E2E-01 至 E2E-04。
8. [ ] 实现 validate/publish、source hash 幂等、revision/owner 权限、事务回滚和 Package provenance。
9. [ ] 完成 E2E-05/E2E-06：prompt-template 人工确认后发布、安装、授权、运行、事件和 artifact。
10. [ ] 接入 Chat 和 Mastra Package-only 协议，完成 IT-04、E2E-07。
11. [ ] 开启 Package-only 灰度，执行观察窗口、指标统计、历史数据对账和依赖扫描。
12. [ ] 通过 `npm run test:skills:release-gate` 和 `npx tsx scripts/verify-legacy-skills-migration.ts`；由负责人批准 M5。
13. [ ] 按 M5 顺序删除 `run-skill.ts`、Legacy js-function 执行实现、旧 http-api 执行方法、`legacy_skill_<id>` Tool 生成器和执行 barrel。
14. [ ] 删除后重复静态扫描、类型检查、所有 Skills 测试和最终 Skills E2E；确认没有 fallback import、幽灵 route、旧同步 Tool 或可执行 Legacy reference。
15. [ ] 记录最终 migration metrics、数据对账、测试报告、回滚状态和未迁移清单；将 Legacy Archive 交给维护者按只读策略长期保留。

最终结束条件：

```text
Legacy = read-only archive
Legacy run = permanently blocked
prompt-template = reviewed Package migration available
http-api = manual review only
js-function = critical blocked
Package Runtime = sole new execution plane
Chat = durable Package run only
Mastra = no legacy synchronous tool
historical data = retained and auditable
security gates = all pass
final Skills E2E = all pass
```

---

## 附录 A：实施阶段与推荐提交边界

为便于审查和回滚，推荐每个阶段至少一个独立提交，提交内容不跨越删除边界：

| 提交边界 | 内容 | 必须通过 |
|---|---|---|
| `skills/migration-m0-baseline` | 错误码、配置、审计、schema、基线测试 | typecheck + unit |
| `skills/migration-m1-archive-only` | Legacy 冻结、历史读取、run 409、Mastra/UI 只读 | unit + integration + smoke |
| `skills/migration-m2-preview` | classifier、normalizer、redaction、preview、manual review | unit + security + migration |
| `skills/migration-m3-package-publish` | validate、人工确认、Package publish、Chat/Package provenance | integration + E2E-02 至 E2E-07 |
| `skills/migration-m4-package-only` | 灰度开关、指标、对账、删除前门禁 | release gate + observation report |
| `skills/migration-m5-remove-runner` | 删除 Legacy runner、旧 Tool、执行 barrel 和相关测试 fixture | 全量 release gate + final E2E |

提交边界只是一种建议的审查方式；实施者不得为了凑提交而修改与迁移无关的文件，也不得在没有测试证据时合并删除阶段。

## 附录 B：最终静态扫描清单

在 M5 后执行以下扫描并保存输出：

```powershell
rg -n "legacy_skill_|run-skill|legacy/.*js-function|legacy/.*http-api|vm\.runInNewContext|eval\(|new Function|child_process" D:\codeproject\JS\bloomai\src D:\codeproject\JS\bloomai\tests
rg -n "legacy:<|runtimeKind.?legacy|LEGACY_SKILL_RUN_DISABLED|LEGACY_SKILL_FROZEN|LEGACY_MIGRATION_MANUAL_REVIEW|LEGACY_MIGRATION_CRITICAL_BLOCKED" D:\codeproject\JS\bloomai\src D:\codeproject\JS\bloomai\tests
npm run typecheck:skills
npm run test:skills:release-gate
npx tsx scripts/verify-legacy-skills-migration.ts
```

第一条扫描只允许命中 Archive 类型定义、阻断报告、负向安全测试和本计划明确的历史兼容读取点；不允许命中可达执行 import。第二条扫描应能证明阻断错误码和只读语义仍然存在。最终验证输出必须归档到发布记录中，作为删除 Legacy runner 的不可替代证据。