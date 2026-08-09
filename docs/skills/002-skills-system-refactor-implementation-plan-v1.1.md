# BloomAI Skills 系统逐文件重构实施任务计划

> 文档编号：002  
> 版本：v1.1  
> 状态：Draft，供后续编码 task 拆分、排期与验收使用  
> 基于：docs/skills/001-skills-system-refactor-analysis-v1.1.md  
> 适用仓库：D:/codeproject/JS/bloomai  
>
> 后端单页面工作台方案页面UI：docs/skills/ui/skill-management-console-v1.1.html
>
> 编写日期：2026-08-05

---

## 0. 使用说明与执行规则

本文不是功能概念说明，而是面向工程实施的逐文件任务计划。每个任务均以当前仓库代码为基线，明确新增、修改、重构、弃用或保持不变的文件，并给出函数、API、数据、测试、证据和完成条件。

### 0.1 标签定义

- [EXISTING]：文件或能力已经存在，本任务只补强、修复或接线。
- [NEW]：需要新增文件、表、API 或模块。
- [REFACTOR]：保留外部行为，但改变内部职责、依赖方向或数据流。
- [DEPRECATE]：停止新增使用，保留兼容读取或兼容调用。
- [KEEP]：本阶段不改动，只补充契约测试或文档。

### 0.2 执行原则

1. 不直接用 Mastra Skills 替换 BloomAI Skills Control Plane。BloomAI 继续拥有导入、安装、版本、权限、审计、运行、Artifact 和管理 UI 的业务事实；Mastra 负责 Agent Runtime、Workspace、Skill Discovery 和动态加载。
2. Package Skill 与 Legacy Skill 必须分开执行。Package Skill 不进入现有同步的 legacy tool surface，不通过旧的 POST /skills/:id/run 触发。
3. 所有能力执行必须经过 Capability Broker。Chat、Image Studio、Article Illustration、Instruction Agent、Mastra Tool 不得直接调用工具实现或供应商 SDK。
4. Skill 声明的 requested capabilities 不是授权结果。安装、运行、session、once、persistent grant 必须独立持久化并可撤销。
5. SkillVersion 不可变。更新通过新版本快照和 installation pointer 完成；禁止原地覆盖已运行版本的 manifest、packagePath 或 manifestHash。
6. Run 必须可恢复、可取消、可重放审计。所有异步执行都先落库，再入队，再由 Worker 消费。
7. 首期只支持 SKILL.md、references、只读 assets、web、附件读取、图片生成、Artifact。暂不开放 Python、Shell、自动安装依赖、MCP、容器、子 Agent、任意 workspace 写入。
8. npx skills 首期只导入外部已经生成的目录，不在 BloomAI 服务端默认执行任意 npx。
9. 所有新 API 使用 Zod 输入校验、统一错误格式、分页、幂等键和资源归属校验。
10. 每一个任务完成后必须留下可复查证据：测试输出、数据库迁移记录、HTTP 响应、UI 截图或审计记录至少一项；P0/P1 任务需要至少两类证据。

### 0.3 执行方式

- 每个任务对应一个独立 commit，commit 标题使用任务编号，例如 SKL-P1-001。
- 同一阶段中，只有写入范围互不重叠的任务才并行实施。
- API 先更新共享类型和契约测试，再改前端或 Worker。
- 表结构先新增 migration 和 migration test，再改 repository。
- 不在同一个任务中同时改变 Legacy API 语义、Package Runtime 状态机和 UI 信息架构；它们要分成可回滚的任务。

---

## 1. 目标、范围和非目标

### 1.1 重构目标

建立如下完整闭环：

~~~text
导入源 -> inspect -> 安全审查和 capability review -> immutable SkillPackage/SkillVersion
      -> Installation enabled -> POST /skill-runs 持久化 Run -> queue/Worker
      -> Instruction Agent + Mastra Workspace/Resolver -> Capability Broker
      -> Run Event / Artifact / Audit -> succeeded | waiting_* | failed | cancelled
      -> Skills Center / Chat / Image Studio 展示
~~~

### 1.2 本期范围

- Legacy Skill 兼容：js-function、http-api、prompt-template。
- Package Skill：本地目录、ZIP、GitHub Archive；npx 产物目录作为 local-directory 导入。
- SKILL.md frontmatter、references、只读 assets、文件列表、manifest hash、source snapshot。
- Package Runtime 的持久化 Run、事件、命令、取消、崩溃恢复、Artifact。
- capability request/grant/revoke、once/session/persistent、scope 子集校验、审批状态。
- Mastra Workspace 生命周期和 Dynamic Skills Resolver；不把 Mastra 作为安装和权限事实来源。
- Skills Center、Package Detail、Run Detail、Skills Creator 单页工作台。
- Chat、Image Studio、Article Illustration 三个调用面。

### 1.3 非目标

- 不实现任意第三方包的 Node 依赖安装。
- 不把 npx skills 的命令执行放进 HTTP 请求线程。
- 不允许 Package Skill 直接执行 shell、Python、任意 JS、MCP 或子 Agent。
- 不删除现有 Legacy 数据表和 API；删除前必须经过兼容期。
- 不把用户传入的绝对路径直接交给 Mastra Workspace。

---

## 2. 当前代码基线与文件架构

### 2.1 当前后端 Skills 文件树

~~~text
src/server/skills/
├─ types.ts、run-skill.ts、registry.ts、http-api.ts、js-function.ts、prompt-template.ts
├─ legacy/
│  ├─ compatibility.test.ts、http-api.ts、index.ts、js-function.ts
│  ├─ mastra-tool-id.ts、prompt-template.ts、registry.ts、run-skill.ts
├─ packages/
│  ├─ feature-flag.ts、manifest-resolver.ts、package-installer.ts、package-reader.ts
│  └─ 对应测试文件
├─ runtime/
│  ├─ index.ts、skill-run-coordinator.ts、skill-run-events.ts
│  └─ 对应测试文件
├─ policy/
│  ├─ index.ts、capability-policy.ts、capability-broker.ts
│  └─ 对应测试文件
├─ artifacts/
│  ├─ index.ts、artifact-store.ts、artifact-store.test.ts
├─ adapters/
│  ├─ index.ts、instruction-agent-adapter.ts、image-studio-capability-adapter.ts
│  └─ 对应测试文件
└─ article-illustrations/
   ├─ article-illustration.service.ts、article-source.ts、illustration-planner.ts
   └─ 对应测试文件
~~~

### 2.2 当前服务、路由、仓库和 Mastra 文件

~~~text
src/server/services/skill.service.ts
src/server/services/skill-package-runtime.service.ts
src/server/http/routes/skills.ts
src/server/http/routes/skill-package-runtime.ts
src/server/db/repositories/skill.repo.ts
src/server/db/repositories/skill-package.repo.ts
src/server/db/migrations.ts
src/server/db/client.ts
src/server/index.ts
src/server/mastra/index.ts
src/server/mastra/chat-agent.ts
src/server/mastra/tools.ts
src/server/mastra/workspace/project-workspace.factory.ts
src/server/mastra/workspace/project-workspace.policy.ts
~~~

### 2.3 当前前端文件

~~~text
src/renderer/App.tsx
src/renderer/api/index.ts
src/renderer/pages/Skills/index.tsx
src/renderer/pages/Skills/skills.store.ts
src/renderer/pages/Skills/skill-runtime.types.ts
src/renderer/pages/Skills/skill-runtime.store.ts
src/renderer/pages/Skills/SkillEditor.tsx
src/renderer/pages/Skills/PackageInstallDialog.tsx
src/renderer/pages/Skills/PackageDetailDrawer.tsx
src/renderer/pages/Skills/RunDetailDrawer.tsx
src/renderer/pages/Chat/ChatPanelMastra.tsx
src/renderer/pages/ImageStudio/index.tsx
src/renderer/pages/ImageStudio/ImageChatPanel.tsx
src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.tsx
~~~

### 2.4 当前数据库基线

已有 schema_migrations、runSqlMigrations 和 001～006 Skills Runtime migration，但 runBootstrapSql 仍在启动流程中创建一部分旧表和旧字段。重构不能假设数据库是全新安装，必须验证新库、旧库、迁移中断后重启、重复执行和 Windows 文件锁场景。

核心表：skill_packages、skill_versions、skill_installations、skill_runs_v2、skill_run_events、skill_run_commands、skill_artifacts、skill_capability_grants，以及 Legacy 的 skills、skill_runs。

---

## 3. 目标程序架构和依赖方向

### 3.1 三层架构

~~~text
BloomAI Skills Control Plane
  Import / Inspect / Install / Version / Grant / Audit / UI
                     |
Mastra Skills Runtime Layer
  Workspace / skill / skill_search / skill_read / Resolver / Agent
                     |
BloomAI Capability and Execution Layer
  web / attachment / image / artifact / legacy tool adapter
~~~

### 3.2 建议目标目录

~~~text
src/server/skills/
├─ application/
│  ├─ skill-catalog.service.ts、skill-import.service.ts
│  ├─ skill-installation.service.ts、skill-version.service.ts
│  ├─ skill-run.service.ts、skill-grant.service.ts
│  ├─ skill-creator.service.ts、skill-audit.service.ts
├─ domain/
│  ├─ skill-package.ts、skill-version.ts、skill-installation.ts
│  ├─ skill-run.ts、skill-capability.ts、skill-artifact.ts、ports.ts
├─ importers/
│  ├─ source-types.ts、local-directory-importer.ts、zip-importer.ts
│  ├─ github-importer.ts、npx-artifact-importer.ts、import-security.ts
├─ runtime/
│  ├─ skill-run-coordinator.ts、skill-run-events.ts、skill-run-queue.ts
│  ├─ skill-run-worker.ts、skill-run-executor.ts、skill-run-recovery.ts
├─ mastra/
│  ├─ skill-source.ts、skill-resolver.ts、skill-tools.ts
├─ policy/、artifacts/、adapters/、legacy/
└─ index.ts
~~~

### 3.3 依赖规则

- HTTP Route 只能依赖 Application Service 和 DTO schema，不能直接依赖 repository、文件系统或供应商 SDK。
- Application Service 可以依赖 Domain、Repository Port、Importer Port、Policy、Artifact Port 和 Queue Port。
- Worker 可以依赖 Application/Domain/Adapter，但不能依赖 Hono Context 或 renderer 类型。
- Mastra Adapter 只能通过 Capability Broker 执行能力，不能直接调用底层工具实现。
- Renderer 只能调用 API client/store；不得自行拼装状态机或写入本地 Skill package path。
- Repository 是唯一负责数据库读写的模块；没有业务层直写 SQL 的例外。

### 3.4 关键运行链路

1. POST /api/v1/skill-runs 校验输入、解析 immutable SkillVersion、检查 installation enabled，创建 created Run。
2. Run Coordinator 推进到 validating，写入 input.summarized 事件。
3. Queue 写入 run id 和唯一 idempotency key，HTTP 请求立即返回 Run 摘要。
4. Worker 获取 lease，加载 SkillVersion、manifest、reader、workspace 和 context，调用 InstructionAgentAdapter。
5. Agent 需要能力时通过 Capability Broker；未授权则产生 approval.required 和 waiting_approval。
6. Worker 持续写事件和 Artifact，最终以 revision 乐观锁写入 terminal status。
7. Worker 崩溃、lease 过期或服务重启时，Recovery 将可恢复 Run 标记为 interrupted，再按策略 resume 或等待用户。

---

## 4. 数据模型、不变量和状态机

### 4.1 领域对象

| 对象 | 事实来源 | 是否可变 | 说明 |
|---|---|---:|---|
| SkillPackage | Control Plane | 部分可变 | 逻辑包身份、名称、来源和描述 |
| SkillVersion | Control Plane | 不可变 | manifest、文件快照、runtime、hash、source commit |
| SkillInstallation | Control Plane | 可变 | 当前版本、enabled、状态、更新时间 |
| SkillRun | Runtime | 运行中可变 | 固定 skillVersionId、输入、context、状态、revision |
| SkillRunEvent | Runtime | 追加写入 | seq 单调递增，事件 payload 脱敏 |
| SkillCapabilityGrant | Control Plane | 可撤销 | requested 与 granted 分离，带 scope 和生命周期 |
| SkillArtifact | Capability/Runtime | 不可变内容 | run ownership、sha256、mime、大小和保留策略 |
| SkillDraft | Creator | 草稿可变 | 未发布前可修改，发布后生成 SkillVersion |
| AuditEvent | Control Plane | 追加写入 | 导入、授权、运行、导出、删除等安全证据 |

### 4.2 必须保持的不变量

1. SkillRun.skillVersionId 指向 immutable 版本；运行中不能跟随 installation current pointer 变化。
2. enabled=false 的 installation 不能创建新 Run，但不影响已启动 Run 的审计读取和取消。
3. 同一 Run 的 run_id + seq 唯一；事件必须按 seq 排序读取。
4. 同一 Run 的 run_id + idempotency_key 唯一；重复命令返回第一次结果，不重复执行。
5. grant 的 scope 必须是 requested scope 的子集；revoked/expired/consumed 的 grant 不能执行。
6. Artifact.runId 必须与当前用户或调用 surface 的 ownership context 匹配。
7. GitHub source 必须记录解析后的 commit SHA；ref 不能作为可复现版本唯一依据。
8. packagePath 只能在应用 Skills data root 下；导出目录必须经过允许目录检查。
9. Package Skill 的 manifest requested capability 不能自动变成 persistent grant。
10. Legacy Skill 的旧表和旧 API 不得写入 Package Runtime 的 skill_runs_v2。

### 4.3 Run 状态机

~~~text
created -> validating -> running
                       ├-> waiting_input -> running
                       ├-> waiting_approval -> running
                       ├-> completed
                       ├-> completed_with_errors
                       ├-> failed
                       ├-> cancelled
                       └-> interrupted -> validating | cancelled
~~~

created、validating、running、waiting_*、interrupted 是非终态；completed、completed_with_errors、failed、cancelled 是终态。所有 transition 必须带 expectedRevision，所有用户 command 必须带 idempotencyKey。

---

## 5. API 兼容策略

### 5.1 Legacy API 保持

当前 src/server/http/routes/skills.ts 继续提供：

- GET /api/v1/skills
- GET /api/v1/skills/market
- POST /api/v1/skills/install
- POST /api/v1/skills
- GET /api/v1/skills/:id
- PATCH /api/v1/skills/:id
- DELETE /api/v1/skills/:id
- POST /api/v1/skills/:id/run
- GET /api/v1/skills/:id/runs

旧接口只处理 Legacy Skill，保留 js-function、http-api、prompt-template。Package Skill 不通过这些接口执行。

### 5.2 Package Runtime API

现有接口继续保留并补强：

- POST /api/v1/skill-packages/inspect
- POST /api/v1/skill-packages/install
- GET /api/v1/skill-packages
- GET /api/v1/skill-packages/:id
- PATCH /api/v1/skill-installations/:id
- DELETE /api/v1/skill-installations/:id
- DELETE /api/v1/skill-capability-grants/:id
- POST /api/v1/skill-runs
- GET /api/v1/skill-runs
- GET /api/v1/skill-runs/:id
- GET /api/v1/skill-runs/:id/events?afterSeq=
- POST /api/v1/skill-runs/:id/commands
- POST /api/v1/skill-runs/:id/cancel
- GET /api/v1/skill-runs/:id/artifacts
- GET /api/v1/skill-artifacts/:id/content?runId=
- POST /api/v1/skill-artifacts/:id/export

计划新增或补齐：import review、版本列表/diff、update、rollback、grant approve/reject、SSE/afterSeq、artifact metadata、Creator draft/validate/preview/publish API。

---

## 6. 实施阶段、依赖关系和并行关系

~~~text
P0 基线/迁移/Flag
  ├─ P1 Worker/Run/Event
  │   └─ P2 Broker/Grant
  ├─ P3 Import/Reader/Installer
  └─ P4 Domain/Mastra/Legacy
       └─ P5 Version/Update/Delete/Creator Domain
            └─ P6 Artifact/Image/Chat
                 └─ P7 API/UI/Creator Workbench
                      └─ P8 Security/Observability/Release/E2E
~~~

可以并行的主线：P0-001、P0-002、P0-003 可并行；P1 事件协议和状态机测试可先于 Worker；P3 Importer 与 P2 Policy 可并行；P7 前端可以使用 mock service 开发，但合并前必须接入真实 API 和 E2E。

---

## 7. 文件级实施任务清单

每个任务均包含实现目标、文件、函数/API、数据、边界、测试、证据、Done when 和回滚策略。


### SKL-P0-001：统一 Skills Runtime 功能开关与运行配置

- 优先级：P0；类型：基础设施/配置；前置：无；可并行：SKL-P0-002、SKL-P0-003。
- 实现目标：把 Package Skill Runtime、Worker、Capability Broker、Creator、GitHub/npx 导入从散落的环境变量和硬编码常量统一收敛为可校验的运行配置，并允许在开发、测试、生产环境逐项启停。
- 功能范围：
  1. 定义 runtimeEnabled、packageExecutionEnabled、importEnabled、githubImportEnabled、npxImportEnabled、creatorEnabled、workerConcurrency、leaseTimeoutMs、maxAttempts、eventRetentionDays、artifactRetentionDays、packageDataRoot、exportRoot 等配置。
  2. 启动时做类型、范围、路径和互斥校验；对于关闭的能力，API 返回可识别的 FEATURE_DISABLED，而不是静默 404。
  3. 将现有 PackageInstaller、Capability Broker、SkillRunCoordinator、ArtifactStore、HTTP routes 和 renderer feature gating 读取同一份配置快照。
- 改动文件：
  - [NEW] src/server/skills/config/skill-runtime.config.ts：SkillRuntimeConfig、loadSkillRuntimeConfig、assertSkillRuntimeConfig、getSkillRuntimeConfig。
  - [NEW] src/server/skills/config/skill-runtime.config.test.ts：环境变量和路径校验。
  - [MODIFY] src/server/index.ts：启动阶段加载配置并注入 composition root。
  - [MODIFY] src/server/skills/packages/package-installer.ts：使用 packageDataRoot 和导入开关，删除重复的根目录常量。
  - [MODIFY] src/server/skills/artifacts/artifact-store.ts：使用 artifact root/export root。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts：统一功能关闭错误。
  - [MODIFY] src/renderer/api/index.ts、src/renderer/pages/Skills/index.tsx：读取 server capability summary，控制按钮和提示。
- 函数/API：
  - SkillRuntimeConfig、loadSkillRuntimeConfig(env, fsAdapter)、assertSkillRuntimeConfig(config)。
  - 新增 GET /api/v1/skill-runtime/capabilities，返回功能开关、限制值、协议版本；不得返回密钥、绝对内部路径或数据库连接信息。
- 数据变更：无需新增表；可在配置摘要中增加 runtime_config_version。配置变更不写入业务表，审计需要时由后续运维事件记录。
- 边界和约束：
  - 默认安全关闭：packageExecution、githubImport、npxImport、creatorPublish 在未显式开启时为 false。
  - workerConcurrency、大小和数量上限必须是正整数且不能超过服务端硬上限。
  - packageDataRoot 和 exportRoot 必须为绝对路径，不能位于应用源码目录和数据库文件目录内；禁止通过配置绕过路径检查。
  - 不能让 renderer 自己决定安全开关；服务端始终重新校验。
- 测试和验证：配置单测覆盖缺失值、非法布尔值、负数、相对路径、目录重叠、生产环境不安全默认值；HTTP 集成测试覆盖功能关闭时的错误码；启动测试验证配置被传递到所有依赖。
- 验收证据：
  - 测试报告显示配置校验全通过。
  - GET capabilities 的响应样例和脱敏快照。
  - 启动日志只输出配置摘要，不输出 secret/token。
  - 使用临时 data root 的安装、Artifact 写入和导出测试。
- Done when：所有 Skills Runtime 入口只依赖 SkillRuntimeConfig；改变一项环境配置即可控制对应功能；非法配置在启动前失败；renderer 不再维护与服务端不一致的安全开关。
- 风险和回滚：配置键名变更会影响部署；保留旧键一个版本周期并记录 warning。若新配置导致启动失败，可回退到上一版本配置文件和上一 migration，不回退运行中的 immutable Run 数据。

### SKL-P0-002：固化迁移执行器、旧库兼容和 Schema 校验

- 优先级：P0；类型：数据库/兼容性；前置：无；可并行：SKL-P0-001、SKL-P0-003。
- 实现目标：将 Skills Runtime 所需的表、索引、约束和状态字段全部纳入 numbered SQL migrations，消除 runBootstrapSql 对新 runtime schema 的隐式创建，同时保持旧 Legacy Skill 数据可读。
- 功能范围：
  1. 审计 scripts/migrations/001-skill-runtime-core.sql 至 006-skill-run-commands.sql 与 src/server/db/schema.ts 的差异。
  2. 新增一个或多个有序 migration，包含 queue、import review、draft、audit、version snapshot/diff 所需结构；每个 migration 可重复执行且由 schema_migrations 记录。
  3. 让 runMigrations() 的顺序为 initDb → runSqlMigrations → 最小兼容 bootstrap/seed；禁止 bootstrap 创建新的 Package Runtime 业务表。
  4. 增加启动后的 schema contract check，发现列、索引或约束不匹配时阻止运行 Worker/API。
- 改动文件：
  - [MODIFY] src/server/db/migrations.ts：迁移发现、排序、版本记录、事务、失败重试和 schema contract check。
  - [MODIFY] src/server/db/client.ts：拆分 runBootstrapSql，保留旧表兼容和 seed，移除 runtime 新表的重复 DDL。
  - [MODIFY] src/server/db/schema.ts：补齐新增表/字段/索引的 Drizzle 定义和类型。
  - [NEW] scripts/migrations/007-skill-runtime-queue-and-control-plane.sql：queue、import review、audit 基础表。
  - [NEW] scripts/migrations/008-skill-version-drafts-and-snapshots.sql：draft、snapshot、diff 所需表。
  - [NEW] src/server/db/schema-contract.ts、src/server/db/schema-contract.test.ts：结构校验。
  - [NEW] src/server/db/migrations.test.ts：空库、旧库、重复执行和中途失败测试。
- 函数/API：
  - runSqlMigrations(database)、runMigrations()、runBootstrapSql()、assertSchemaContract(database)。
  - [NEW] getAppliedMigrationVersions()、getExpectedSchemaContract()。
  - 不新增面向用户的 HTTP API；迁移错误必须映射为启动错误并带 migration id。
- 数据变更：
  - skill_run_queue：id、run_id、status、available_at、lease_owner、lease_until、attempt、last_error、created_at、updated_at。
  - skill_import_reviews：id、source、source_sha/ref、inspection_json、status、reviewer、decision、created_at、updated_at。
  - skill_audit_events：actor、action、resource_type、resource_id、payload_json、created_at。
  - skill_drafts、skill_version_snapshots、skill_version_diffs 等控制面表，具体列必须在 migration 与 schema.ts 双向一致。
  - 所有新增 id 使用应用层生成的稳定字符串；时间使用 UTC 毫秒/ISO 统一约定。
- 边界和约束：
  - 不删除旧 skills、skill_runs 表；Legacy API 继续读取旧表。
  - 不使用无版本的 CREATE TABLE IF NOT EXISTS 掩盖结构不一致；migration 中的表存在但列不全必须失败。
  - SQLite 迁移要处理 ALTER TABLE 限制，必要时使用临时表并在同一事务中完成。
  - 生产环境不允许自动降级或回退 migration。
- 测试和验证：新建空库执行全量 migration；复制当前旧库执行增量 migration；连续执行两次；故意删除列/索引验证 contract check 失败；迁移中断后重启验证可恢复且不重复写数据。
- 验收证据：migration 日志、schema_migrations 行、sqlite_master/pragma index_list 快照、Drizzle 类型检查、旧 API 回归测试。
- Done when：所有新增 Runtime 表只由 numbered migration 创建；空库和旧库都能启动；schema contract check 能发现漂移；Legacy 数据和 API 不回归。
- 风险和回滚：迁移失败时保留备份并停止服务；仅允许执行配套 down/forward-fix migration，不手工删除 production 表。新表可先处于未使用状态，应用回滚不影响旧表。

### SKL-P0-003：冻结 Repository Port 和旧 Legacy/Package 数据边界

- 优先级：P0；类型：领域边界/重构基础；前置：无；可并行：SKL-P0-001、SKL-P0-002。
- 实现目标：把当前 service 直接依赖全局 repository 的做法改为明确的 Port/Adapter，定义 Legacy Skill、Package Skill、Run、Event、Grant、Artifact 的读写边界，避免后续 Worker、HTTP、UI 共享不可控的全局状态。
- 功能范围：
  1. 定义 SkillPackageRepository、SkillRunRepository、SkillRunEventRepository、CapabilityGrantRepository、ArtifactRepository、AuditRepository、Clock、IdGenerator 等接口。
  2. 规定 Package Runtime 只能读写 skill_packages、skill_versions、skill_installations、skill_runs_v2、skill_run_events、skill_run_commands、skill_capability_grants、skill_artifacts 等表。
  3. 规定 Legacy Skill 继续使用 skill.repo.ts 对旧 skills、skill_runs 读写；不得由 Package Runtime 直接调用 Legacy repo 的 startRun/completeRun。
  4. 所有 service、adapter、worker 通过构造参数注入依赖，保留默认 composition root 只用于生产启动。
- 改动文件：
  - [NEW] src/server/skills/application/ports.ts：所有 Port 类型和 repository contract。
  - [NEW] src/server/skills/application/errors.ts：稳定错误码和领域错误。
  - [NEW] src/server/skills/application/test-doubles.ts：fake repository、fake clock、fake queue。
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts：实现 Package ports，补充事务和分页返回类型。
  - [MODIFY] src/server/db/repositories/skill.repo.ts：明确 Legacy adapter，不再被 Package service 隐式复用。
  - [MODIFY] src/server/services/skill-package-runtime.service.ts：仅依赖 ports。
  - [MODIFY] src/server/skills/runtime/skill-run-coordinator.ts、capability-broker.ts、artifact-store.ts：改为构造注入。
- 函数/API：
  - PackageSkillRepository.getRunnableVersion、createInstallation、createRun、applyRunChange、listRunsByStatus、appendEvent、getCommandResult 等接口。
  - SkillRunRepository.compareAndSet、claimNextRun、releaseLease、markInterrupted 等接口。
  - 不暴露数据库 row 作为 HTTP DTO；Application 层完成 mapping。
- 数据变更：不新增表；必要时为 repository 增加 transaction callback 约定和 revision/updated_at 索引。
- 边界和约束：
  - Port 只描述业务语义，不能泄漏 Drizzle/SQLite 类型。
  - 读模型与写模型可以不同，但必须明确返回 immutable snapshot 或 mutable aggregate。
  - 所有写方法要声明幂等键、expectedRevision 或事务要求。
  - 默认依赖仅在应用入口组装；测试不能依赖 globalThis 的数据库状态。
- 测试和验证：contract test 对 SQLite adapter 和 fake adapter 双跑；验证重复 command、revision 冲突、分页边界、删除 ownership；静态搜索确保 runtime service 不直接 import 全局 skillPackageRepo。
- 验收证据：Port contract 文档、依赖图、测试覆盖报告、grep 结果和一个完全使用 fake ports 的 coordinator 单测。
- Done when：Application/Domain 代码可在无真实数据库的情况下测试；Legacy 与 Package 的表和 repo 边界在代码和测试中都可证明。
- 风险和回滚：注入改造可能引起大量 import 变动；先保留 createXxxService 的默认依赖工厂，逐调用方迁移，完成后再禁止全局 import。

### SKL-P0-004：建立持久化 Queue、Worker 组合根和启动/关闭契约

- 优先级：P0；类型：Runtime/可靠性；前置：SKL-P0-001、SKL-P0-002、SKL-P0-003；可并行：queue adapter 与 Worker 单测可并行。
- 实现目标：建立可崩溃恢复的持久化运行队列，使 POST /skill-runs 只负责创建 Run 和排队，真正执行由 Worker 消费，不在 HTTP 请求线程中同步完成。
- 功能范围：
  1. createRun 成功后同事务写入 queue item，避免 Run 已创建但没有任务的双写窗口。
  2. Worker 以 lease 方式 claim；lease 过期可被其他 worker 重新领取；失败根据可重试错误退避，达到 maxAttempts 后标记 failed。
  3. 进程启动顺序为 db/migration → config → repositories → coordinator/event store → capability broker → executor → queue → worker → HTTP server；关闭顺序反向 drain、停止接新任务、释放 lease。
  4. 同一个 runId 同时只有一个 active lease；Worker 不处理已终态 Run。
- 改动文件：
  - [NEW] src/server/skills/runtime/skill-run-queue.ts：PersistentSkillRunQueue、enqueue、claim、heartbeat、ack、retry、fail。
  - [NEW] src/server/skills/runtime/skill-run-worker.ts：SkillRunWorker、start、stop、drain、runOne、handleFailure。
  - [NEW] src/server/skills/runtime/skill-runtime.composition-root.ts：createSkillRuntime。
  - [MODIFY] src/server/server.ts 或实际 HTTP 启动文件：使用 composition root（若文件不存在，以实际 server bootstrap 文件为准）。
  - [MODIFY] src/server/index.ts：接入 runMigrations、runtime start/stop，保留 markInterruptedRuns 作为恢复步骤的一部分。
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts、src/server/db/schema.ts、scripts/migrations/007-skill-runtime-queue-and-control-plane.sql。
  - [NEW] src/server/skills/runtime/skill-run-queue.test.ts、skill-run-worker.test.ts、skill-runtime.composition-root.test.ts。
- 函数/API：
  - PersistentSkillRunQueue.enqueue(runId, availableAt)、claimNext(workerId, leaseMs)、heartbeat(queueId, workerId, leaseMs)、ack(queueId, workerId)、retry(queueId, workerId, error, delayMs)、fail(queueId, workerId, error)。
  - SkillRunWorker.start()、stop({ drain, timeoutMs })、runOne()。
  - POST /api/v1/skill-runs 返回 created + runId，不能等待执行结果。
- 数据变更：使用 skill_run_queue 及必要索引：status/available_at、lease_until、run_id unique active lease。queue 状态至少包括 queued、leased、retry_wait、done、dead。
- 边界和约束：
  - lease owner 使用随机 worker id；不能用用户可控值。
  - 任务 payload 不复制完整输入和 secret，只存 runId；真实输入保存在 Run 的受控字段或 Artifact 中。
  - 幂等依靠 run state/revision/command，不依靠“至少一次”假设。
  - stop(drain=false) 必须停止 claim，并使当前 lease 可恢复；不能粗暴将运行中 Run 设为 completed。
- 测试和验证：并发 claim、lease 过期重领、Worker 崩溃模拟、retry backoff、max attempts、优雅关闭、空队列轮询、Run 已取消/终态跳过测试；使用 fake clock 消除等待。
- 验收证据：Worker 日志/指标、queue 表状态变化快照、杀进程后重启恢复测试、端到端创建 Run 后由 Worker 完成的事件链。
- Done when：任何已持久化且未完成的 Run 在进程重启后可继续或明确失败；HTTP 请求不执行长任务；Worker 可启动、停止、排空且无并发重复执行。
- 风险和回滚：先通过 feature flag 让 Worker shadow/disabled，保留原有同步路径作为临时回退；一旦开启生产 Worker，必须关闭同步执行避免双跑。

### SKL-P1-001：把 Run Coordinator 变成可注入、可持久化的状态机

- 优先级：P0；类型：核心 Runtime；前置：SKL-P0-003、SKL-P0-004；可并行：SKL-P1-002。
- 实现目标：将现有 SkillRunCoordinator 从“直接 repo + 内存事件”重构为以持久化 Run aggregate、revision 和状态转换表为中心的应用服务。
- 功能范围：
  1. 保留 created、validating、running、waiting_input、waiting_approval、completed、completed_with_errors、failed、cancelled、interrupted 状态。
  2. startRun 在同一事务创建 Run、初始 event、queue item；transition 使用 expectedRevision 做 compare-and-set。
  3. dispatchCommand 对 resume、approve、reject、cancel、retry 等命令统一验证 idempotencyKey 并写 command result。
  4. resumeRun 只允许从 interrupted/waiting 状态进入合法目标状态；终态不可被“恢复”。
- 改动文件：
  - [MODIFY] src/server/skills/runtime/skill-run-coordinator.ts：SkillRunCoordinator 构造函数、startRun、getRun、subscribeEvents、transition、dispatchCommand、resumeRun、markInterruptedRuns、applyCommandTransition、applyCommandChange。
  - [MODIFY] src/server/skills/application/ports.ts、skill-package.repo.ts：事务和 CAS port。
  - [NEW] src/server/skills/runtime/skill-run-state-machine.ts：状态、允许转换、transition reason、terminal checks。
  - [NEW] src/server/skills/runtime/skill-run-coordinator.test.ts：状态机和并发测试。
  - [MODIFY] src/server/services/skill-package-runtime.service.ts：调用新的 coordinator contract。
- 函数/API：
  - transition(runId, targetStatus, { expectedRevision, reason, metadata })。
  - dispatchCommand(runId, { type, idempotencyKey, expectedRevision, ... })。
  - GET /skill-runs/:id 返回 revision、status、currentStep、requiredAction、timestamps。
- 数据变更：skill_runs_v2 增加/确认 started_at、finished_at、current_step、required_action、error_code、revision、cancel_requested_at、worker_id；skill_run_commands 保存首次响应和 consumed_at。
- 边界和约束：
  - 任何状态变化只能通过 coordinator；Worker、API、Broker 不得直接 update status。
  - 同一 Run 的 revision 严格单调递增；CAS 失败返回 REVISION_CONFLICT，不自动覆盖用户最新状态。
  - event 与状态更新必须同事务，除非采用 outbox 且有明确补偿。
  - 输入和错误消息脱敏，不将 prompt 中的 secret 写入 state 或 event。
- 测试和验证：完整 transition matrix、CAS 并发、重复 command、非法状态、终态 cancel、cancel requested race、事务回滚测试；property test 随机生成合法/非法转换。
- 验收证据：状态转换矩阵快照、DB revision 变化、重复命令返回同一 result、错误码断言、重启恢复测试。
- Done when：Coordinator 是所有 Run 状态写入的唯一入口；状态和事件可从 DB 完整重放；并发用户不会互相覆盖。
- 风险和回滚：可先保留旧 subscribeEvents 读取 adapter；若新状态机发现旧数据非法，使用迁移脚本将旧 running 标记 interrupted，不直接删除。

### SKL-P1-002：固定 Run Event 协议、seq、schema version 和脱敏策略

- 优先级：P0；类型：协议/可观测性；前置：SKL-P0-003；可并行：SKL-P1-001、P1-003。
- 实现目标：把 skill-run-events.ts 中的 schema、8KB payload 限制、敏感字段和 base64 拒绝规则固化为可演进的事件协议。
- 功能范围：
  1. event type、schemaVersion、runId、seq、occurredAt、producer、payload 结构统一。
  2. appendEvent 在同一 run 内生成严格递增 seq；listEvents(runId, afterSeq, limit) 支持断点续传。
  3. sanitizePayload 对 authorization、api_key、token、secret、password、headers、cookies 等递归脱敏；禁止大段 base64/data URI。
  4. 为 package.loaded、package.file_loaded、step.started、step.completed、capability.requested、capability.approval_required、capability.completed、artifact.created、run.* 等事件提供 registry。
- 改动文件：
  - [MODIFY] src/server/skills/runtime/skill-run-events.ts：schema、normalizeSkillRunEvent、sanitizePayload、payload size check。
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts：appendEvent、listEvents 的 seq/CAS 实现。
  - [MODIFY] src/server/db/schema.ts、scripts/migrations/002-skill-runtime-events.sql：唯一键和索引确认。
  - [NEW] src/server/skills/runtime/skill-run-event-registry.ts：事件类型和 schema version。
  - [NEW] src/server/skills/runtime/skill-run-events.test.ts：脱敏、大小、排序、断点测试。
- 函数/API：
  - normalizeSkillRunEvent({ type, payload, producer })。
  - appendEvent({ runId, type, payload, producer })、listEvents({ runId, afterSeq, limit })。
  - GET /api/v1/skill-runs/:id/events?afterSeq=&limit= 返回 nextAfterSeq。
  - GET /api/v1/skill-runs/:id/events/stream 提供 SSE；断线用 afterSeq 恢复，不保证每个事件只投递一次。
- 数据变更：skill_run_events 增加/确认 schema_version、producer、occurred_at、seq；(run_id, seq) unique；payload_json 只存清洗后内容。
- 边界和约束：
  - 事件是审计事实，不作为可变状态唯一来源；状态快照仍由 Run row 提供。
  - 单事件 payload 超限返回 EVENT_PAYLOAD_TOO_LARGE；不能静默截断 JSON。
  - SSE 连接必须校验 run ownership；不能通过 event stream 读取其他用户 Run。
  - schema version 只能向前兼容；破坏性变更新增 event type/version。
- 测试和验证：敏感字段递归测试、循环对象/非法 JSON、超限、seq 并发、afterSeq、SSE 断线恢复、权限隔离、旧事件读取测试。
- 验收证据：事件 JSON schema、脱敏快照、SSE curl/浏览器录屏、afterSeq 重连证明、DB 唯一索引验证。
- Done when：任何 Run 都可用 HTTP/SSE 观察；事件可分页和断点恢复；脱敏和大小限制由服务端强制执行；协议版本可演进。
- 风险和回滚：SSE 先作为可选 endpoint，不影响 afterSeq API；若实时推送故障，UI 回退轮询，事件仍持久化。

### SKL-P1-003：实现 Instruction Agent 执行器和 Worker 的实际接线

- 优先级：P0；类型：执行层；前置：SKL-P1-001、SKL-P1-002、SKL-P0-004；可并行：P2 policy contract。
- 实现目标：让 Worker 能够解析已安装 Package 的 manifest、读取指令文件和 references/assets，并通过 InstructionAgentAdapter 产出可持久化的 Run 结果，而不是只创建空 Run。
- 功能范围：
  1. Worker 根据 run.skillVersionId 解析 package snapshot，构造 ExecutionContext。
  2. InstructionAgentAdapter.run、startRunning、cancel、recordFileLoaded、recordEvent 接入 Coordinator 和 EventStore。
  3. 仅允许首期能力：SKILL.md 指令、references 只读读取、assets 只读读取、web 查询（经 capability broker）、附件读取、image.generate、Artifact 写入；Python、Shell、MCP、容器、子 Agent 和任意 workspace 写入均拒绝。
  4. 执行结果必须区分 completed、completed_with_errors、waiting_approval、waiting_input、failed、cancelled；预算异常映射为稳定 error_code。
- 改动文件：
  - [MODIFY] src/server/skills/adapters/instruction-agent-adapter.ts：manifest parse、budget、run loop、event、cancel。
  - [MODIFY] src/server/skills/runtime/skill-run-worker.ts：resolve version、调用 adapter、状态收敛、retry policy。
  - [NEW] src/server/skills/runtime/skill-execution-context.ts：run-scoped context、input/output limits、read manifests。
  - [MODIFY] src/server/skills/packages/package-reader.ts、manifest-resolver.ts：提供 reader/manifest snapshot。
  - [NEW] src/server/skills/adapters/instruction-agent-adapter.test.ts、skill-run-worker.integration.test.ts。
- 函数/API：
  - InstructionAgentAdapter.run(runId)、InstructionAgentExecutor.run(context)、SkillRunWorker.runOne。
  - 内部 capability request 统一调用 executeCapability；禁止 adapter 直接调用 tools 表或具体工具实现。
- 数据变更：skill_runs_v2 保存 execution_mode、step_count、token_usage、last_heartbeat_at、result_summary、error_code；artifact 由 ArtifactStore 生成 metadata。
- 边界和约束：
  - 每次运行绑定 immutable skillVersionId；安装 current version 改变不影响运行。
  - maxSteps、maxTokens、maxDurationMs、maxLoadedFiles、maxFileBytes 必须强制；超限不可通过 prompt 绕过。
  - 读取路径必须位于 package snapshot root，禁止 symlink escape；任何写入只能进入 ArtifactStore。
  - 包内文档不是可信代码；不要执行文件中的 JS/Python/Shell。
- 测试和验证：最小 SKILL.md 成功运行、references/asset 读取、路径穿越、symlink、超步数/Token/时间、无效 manifest、capability error、cancel race、Worker retry/terminal convergence。
- 验收证据：一条 Run 的事件链、生成 Artifact 元数据、失败时 error_code 和脱敏日志、拒绝 Shell/Python/MCP 的 API/事件断言。
- Done when：从 POST /skill-runs 到 Worker 执行和终态收敛形成真实闭环；首期支持范围可运行，非支持范围始终明确拒绝。
- 风险和回滚：先只允许内置测试 Package 和 dry-run；生产启用前通过限制配置降低 budget，发现执行器问题可关闭 packageExecution 保留导入/查看。

### SKL-P1-004：补齐启动恢复、取消和中断语义

- 优先级：P0；类型：可靠性；前置：SKL-P1-001、SKL-P1-003；可并行：P1-002。
- 实现目标：定义进程崩溃、机器重启、用户取消、Worker stop、网络断开后的唯一语义，避免 Run 永远卡在 running 或重复执行副作用。
- 功能范围：
  1. 启动扫描 running/validating/leased Run，按 heartbeat/lease 判断是否 interrupted。
  2. interrupted Run 可被安全 resume；不可重入的 capability 在重新执行前必须检查 command/grant/artifact 记录。
  3. cancel 先写 cancel_requested，再由 adapter/worker 观察并进入 cancelled；强制超时后由 coordinator 收敛。
  4. 统一用户可见 reason：user_cancelled、worker_shutdown、lease_expired、process_crash、budget_exceeded。
- 改动文件：
  - [MODIFY] src/server/index.ts：启动恢复和关闭 hooks。
  - [MODIFY] src/server/skills/runtime/skill-run-coordinator.ts：markInterruptedRuns、cancel semantics。
  - [MODIFY] src/server/skills/runtime/skill-run-worker.ts、skill-run-queue.ts：heartbeat、lease expiry、stop/drain。
  - [MODIFY] src/server/skills/adapters/instruction-agent-adapter.ts：cancel signal/checkpoint。
  - [NEW] src/server/skills/runtime/skill-run-recovery.test.ts。
- 函数/API：
  - POST /skill-runs/:id/cancel，POST /skill-runs/:id/commands(type=resume/retry)；响应包含 revision 和 accepted 状态。
  - markInterruptedRuns(now)、requestCancel(runId, expectedRevision, idempotencyKey)、recoverLeases(now)。
- 数据变更：保存 interrupted_at、cancel_requested_at、cancel_reason、heartbeat_at、last_checkpoint_json；队列 lease fields 可恢复。
- 边界和约束：
  - 取消是幂等的；已 completed 的 Run 返回 unchanged，不重启。
  - 被取消的 Run 不能因为队列 retry 自动重新执行。
  - 恢复只从明确 checkpoint 或安全重跑点开始；不假设外部能力是 exactly-once。
- 测试和验证：kill/restart simulation、lease expiry、cancel during tool call、cancel during waiting_approval、duplicate cancel/resume、terminal state recovery、shutdown drain。
- 验收证据：恢复前后 DB 快照、同一个 runId 的 event seq 证明、取消 API 返回和 Worker 日志、重复取消不会产生第二次执行。
- Done when：崩溃、重启、取消场景都能在规定时间内到达可解释状态；不会遗留无 lease 的 running Run；恢复不绕过授权和幂等检查。
- 风险和回滚：恢复逻辑先以 dry-run 报告方式上线，确认旧数据分布后再自动 mark interrupted；取消失败只能标记 cancellation_pending，不伪造成功。


### SKL-P2-001：建立 requested capability、grant 和审批 Application Service

- 优先级：P0；类型：安全/授权；前置：SKL-P0-003、SKL-P1-001；可并行：SKL-P3-001。
- 实现目标：把 Package Skill 请求能力、系统授予能力、人工审批和运行时消费拆成不同概念，防止 manifest 声明后自动获得权限。
- 功能范围：
  1. 解析 manifest 的 requested capabilities，转换为标准 CapabilityRequest。
  2. 对每个 Run/SkillVersion 计算 requested、available、grantable、forbidden、approval_required。
  3. 提供 grant 创建、审批、拒绝、撤销、过期、消费和审计流程；grant scope 必须是 requested scope 的子集。
  4. 审批支持 run-scoped、session-scoped 和 permanent（首期可只实现 run/session），默认 deny。
- 改动文件：
  - [NEW] src/server/skills/application/capability-grant.service.ts：CapabilityGrantService、requestCapabilities、createGrant、approveGrant、rejectGrant、revokeGrant、consumeGrant。
  - [MODIFY] src/server/skills/policy/capability-policy.ts：CapabilityScope、allowed capability matrix、forbidden set。
  - [MODIFY] src/server/skills/policy/capability-broker.ts：调用 grant service，不直接决定审批持久化。
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts：createCapabilityGrant、findActiveCapabilityGrant、consumeCapabilityGrant、revokeCapabilityGrant。
  - [NEW] src/server/skills/application/capability-grant.service.test.ts、capability-policy.test.ts。
  - [MODIFY] src/server/db/schema.ts、scripts/migrations/004-skill-capability-grants.sql、005-skill-capability-grant-state.sql。
- 函数/API：
  - CapabilityGrantService.request(runId, requested)、approve(grantId, actor, scope)、reject(grantId, actor, reason)、revoke(grantId, actor)、consume(grantId)。
  - POST /api/v1/skill-capability-grants/:id/approve、POST /api/v1/skill-capability-grants/:id/reject、POST /api/v1/skill-capability-grants/:id/revoke。
  - GET /api/v1/skill-runs/:id/capabilities 返回 requested/granted/pending/denied 状态。
- 数据变更：skill_capability_grants 增加 requested_scope_json、granted_scope_json、status、grant_mode、approved_by、approved_at、expires_at、max_calls、calls_used、revoked_at、revoke_reason、run_id/session_id。
- 边界和约束：
  - package-runtime 不能请求 shell、python、mcp、container、arbitrary_workspace_write 等首期禁止能力。
  - granted scope 不能扩大 requested scope；maxCalls 只能收紧，allowedModels 只能是 requested 的子集。
  - grant 不能跨用户、跨 run 复用；过期和 revoked 立即失效。
  - 审批接口必须校验 actor 权限并写审计，不在 renderer 直接改变 grant 状态。
- 测试和验证：requested 与 granted 子集、默认 deny、审批/拒绝/撤销/过期、maxCalls 竞争消费、跨 run ownership、重复审批幂等、非法 capability 测试。
- 验收证据：审批前 capability event 为 waiting_approval；批准后仅在 scope 内执行；审计表含 actor/时间/资源；scope 变更快照。
- Done when：所有 Package capability 都经过统一 grant service；审批 API 可用；没有 manifest 自动升级为授权的路径；grant 状态和 Run waiting_approval 一致。
- 风险和回滚：先只开启 image.generate 和 web.search 的可选审批；新 grant service 失败时默认拒绝并保留旧 capability execution 不可用，不降级为无授权执行。

### SKL-P2-002：把 Capability Broker 固化为唯一执行入口

- 优先级：P0；类型：安全/执行边界；前置：SKL-P2-001、SKL-P1-003；可并行：SKL-P2-003。
- 实现目标：所有 Package Skill 外部能力调用都必须通过 Capability Broker，完成能力映射、可用性检查、权限/预算/超时/审计和结果归一化。
- 功能范围：
  1. 保留 executeCapability 和 executeLegacyToolCapability 的双路径，但明确 caller=package-runtime 与 legacy 的不同 policy。
  2. 使用 PACKAGE_CAPABILITY_TO_TOOL 映射 capability 到已登记工具；禁止 package 直接调用工具实现、数据库或 Mastra tool runner。
  3. 统一处理 tool disabled、tool not found、permission required、grant denied、timeout、budget exhausted、unsupported。
  4. image.generate 使用专门 adapter，结果先转为 Artifact/引用，再返回给执行器。
- 改动文件：
  - [MODIFY] src/server/skills/policy/capability-broker.ts：executeCapability、executeLegacyToolCapability、resolveToolId、requirePackageGrant、enforcePackageScope、executePackageImageCapability、auditPackageCall。
  - [MODIFY] src/server/skills/policy/capability-policy.ts：capability → tool contract 和 policy matrix。
  - [MODIFY] src/server/mastra/tools.ts：只暴露受支持的 tool contract，不把 Package Skill 作为同步 tool 直挂。
  - [MODIFY] src/server/skills/adapters/image-studio-capability-adapter.ts：request/response contract。
  - [NEW] src/server/skills/policy/capability-broker.test.ts、capability-broker.integration.test.ts。
- 函数/API：
  - executeCapability(request: CapabilityRequest): Promise<CapabilityResult>。
  - CapabilityRequest 至少包括 caller、runId、capability、input、sessionId、idempotencyKey、requestedTimeoutMs。
  - CapabilityResult 统一包括 status、output、artifactIds、usage、errorCode、retryable。
- 数据变更：skill_run_events 写 capability.requested/started/completed/failed；grant calls_used 原子递增；audit 写能力调用摘要，不写秘密和原始大 payload。
- 边界和约束：
  - caller=package-runtime 必须有 runId；没有 runId 直接拒绝。
  - 外部工具超时不能由用户输入无限延长；各 tool 有 server-side timeout override。
  - 对外部能力的副作用要依赖 idempotencyKey 或明确声明 at-least-once 风险。
  - Capability Broker 不能成为任意通用代码执行器；首期不支持 shell/python。
- 测试和验证：tool disabled/not found、grant missing/expired/revoked、scope mismatch、timeout、retryable error、image call budget、audit redaction、idempotency 测试。
- 验收证据：从 InstructionAgentAdapter 发起的能力调用只能在 Broker 日志/事件中出现；绕过 Broker 的测试失败；安全测试证明禁止能力不进入工具执行层。
- Done when：Package Skill 的所有 capability 调用有统一入口、错误和审计；Legacy 兼容路径仍可用且 policy 不串线。
- 风险和回滚：Broker 接入初期先保留 legacy tool execution 适配器；Package caller 永不回退到 direct tool invocation，出现不支持能力时返回明确错误。

### SKL-P2-003：实现预算、审批和 waiting 状态的统一映射

- 优先级：P0；类型：运行控制；前置：SKL-P1-001、SKL-P2-001、SKL-P2-002；可并行：P3 importer。
- 实现目标：将能力审批、输入等待、预算耗尽、工具超时映射为统一 Run 状态和可恢复 command，避免 UI 只能看到 failed。
- 功能范围：
  1. CapabilityApprovalRequiredError → waiting_approval；需要用户补充信息 → waiting_input；预算耗尽 → failed 或 completed_with_errors，取决于 policy。
  2. 记录 required_action、capability、grantId、prompt schema、expiresAt，供 UI 呈现和 API command 使用。
  3. resume/approve/reject/cancel/retry 命令返回统一的 command result。
  4. UI 可轮询或订阅状态，不重复触发审批或工具执行。
- 改动文件：
  - [MODIFY] src/server/skills/adapters/instruction-agent-adapter.ts：将 capability errors 转成 execution result。
  - [MODIFY] src/server/skills/runtime/skill-run-coordinator.ts：waiting transition 和 command。
  - [MODIFY] src/server/services/skill-package-runtime.service.ts：error mapping。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts：command/approve/reject response。
  - [NEW] src/server/skills/runtime/skill-run-waiting.test.ts。
- 函数/API：
  - mapCapabilityErrorToRunAction(error)、setRequiredAction、clearRequiredAction。
  - GET /skill-runs/:id/next-action；POST /skill-runs/:id/commands 支持 resume、approve、reject、submit_input、cancel、retry。
- 数据变更：skill_runs_v2.required_action_json、waiting_since、waiting_expires_at；command result 存 first response。
- 边界和约束：
  - waiting 状态不占用 worker lease；审批/输入完成后重新 enqueue。
  - expired waiting action 不能继续执行，必须进入 failed/cancelled 或重新创建 action。
  - UI 显示的 prompt schema 只允许安全字段类型，不允许执行任意 JSON Schema 注入。
- 测试和验证：所有 CapabilityError 映射、过期 waiting、重复 command、审批后重新排队、cancel waiting Run、错误码兼容测试。
- 验收证据：浏览器中显示“等待审批/等待输入”并完成后恢复；Run event 中有 waiting_entered/resumed；不产生重复 queue item。
- Done when：任何需要用户动作的 Run 都有可执行的 next-action；用户动作是幂等且可审计；Worker 不忙等。
- 风险和回滚：若 UI 尚未支持 next-action，可保留 API 和事件，Run 仍安全停在 waiting；禁止自动同意来绕过未完成 UI。

### SKL-P3-001：Manifest Resolver 的 schema、frontmatter 和 unsupported 声明闭环

- 优先级：P0；类型：导入/解析；前置：SKL-P0-003；可并行：P2。
- 实现目标：把 SKILL.md/manifest 的格式、版本、能力声明、入口文件、references/assets 目录和不支持声明变成稳定 schema，并让 inspect 与 install 使用同一解析结果。
- 功能范围：
  1. 解析 YAML frontmatter、Markdown body、显式 manifest.json（如果存在）并生成 canonical Manifest。
  2. 校验 name、slug、version、description、license、author、entry、capabilities、files、compatibility、unsupported。
  3. 识别 package 根目录；支持 npx skills 产物中常见目录层级和单 skill 根目录。
  4. 产生 warnings/errors/requiredCapabilities/unsupportedCapabilities 和 canonical hash。
- 改动文件：
  - [MODIFY] src/server/skills/packages/manifest-resolver.ts：resolveManifest、frontmatter parse、canonicalize、validate。
  - [MODIFY] src/server/skills/packages/package-reader.ts：提供 bounded file read。
  - [NEW] src/server/skills/packages/manifest-schema.ts：Zod schema、versioned manifest。
  - [NEW] src/server/skills/packages/manifest-resolver.test.ts、fixtures/packages/*。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts：inspect response 返回 diagnostics。
- 函数/API：
  - resolveManifest(reader, options)、validateManifest(manifest)、canonicalManifestHash(manifest)。
  - POST /skill-packages/inspect 返回 packages[]、diagnostics[]、capabilities、sourceFingerprint、importReviewRequired。
- 数据变更：skill_versions 保存 manifest_json、manifest_hash、requested_capabilities_json、unsupported_json、entry_path、content_sha256。
- 边界和约束：
  - SKILL.md 是说明/指令，不是可执行代码入口；entry 只能指向允许读取的文档/模板，不执行脚本。
  - 必须拒绝 duplicate name/version、绝对 entry、.. 穿越、超长 frontmatter、未知危险字段；未知普通字段可放 extensions，但不能改变 policy。
  - version 使用 SemVer 或明确标记 non-semver；canonical hash 不能依赖文件系统顺序。
- 测试和验证：frontmatter 空值、YAML 类型错误、重复字段、Unicode、超大文件、恶意 entry、缺失 SKILL.md、manifest 版本升级、canonical hash 稳定性测试。
- 验收证据：inspect 对合法/非法 fixture 的 JSON 快照；同一包在 Windows/CI 上 fingerprint 一致；unsupported capability 明确展示。
- Done when：inspect 与 install 对同一输入给出相同 canonical manifest；任何不支持声明在安装前可见；解析不执行 package 中任意代码。
- 风险和回滚：保留当前 resolver 的兼容 fallback 一个版本，但 fallback 只能产生 legacy diagnostics，不能绕过新安全校验。

### SKL-P3-002：安全 Package Reader 和文件预算

- 优先级：P0；类型：安全/文件系统；前置：SKL-P3-001；可并行：P3-004。
- 实现目标：建立只读、边界明确的 package reader，为目录、ZIP、GitHub archive 提供统一文件树和内容读取，不发生路径穿越、symlink escape、资源耗尽。
- 功能范围：
  1. 统一 DirectoryReader、ZipReader、SnapshotReader 接口；列出文件、读取文本、读取字节、统计大小。
  2. 应用 MAX_FILE_COUNT、MAX_FILE_BYTES、MAX_UNPACKED_BYTES、MAX_ARCHIVE_BYTES、MAX_PATH_LENGTH、MAX_DEPTH。
  3. 规范化 Windows/Unix 路径，拒绝绝对路径、盘符路径、NUL、..、重复分隔符绕过和 symlink/hardlink 逃逸。
  4. 只允许 SKILL.md、references、assets 和显式白名单文件类型进入运行 snapshot。
- 改动文件：
  - [MODIFY] src/server/skills/packages/package-reader.ts：reader interface、readBounded、listFiles、safeRelativePath。
  - [MODIFY] src/server/skills/packages/package-installer.ts：用 reader 进行 inspect/install，删除重复 ZIP 解压校验。
  - [NEW] src/server/skills/packages/package-path-policy.ts、package-path-policy.test.ts。
  - [NEW] src/server/skills/packages/package-reader.test.ts、fixtures/malicious/*。
- 函数/API：
  - PackageReader.listFiles()、readText(path, maxBytes)、readBuffer(path, maxBytes)、getFingerprint()、close()。
  - 不新增用户 API；inspect/install 统一返回 FILE_LIMIT_EXCEEDED、PATH_NOT_ALLOWED 等稳定错误。
- 数据变更：skill_version_snapshots 保存 files_manifest_json、total_bytes、file_count、snapshot_root、snapshot_hash。
- 边界和约束：
  - 任何读取动作都在 snapshot root 内；不允许跟随 symlink；不可从 package 访问应用 data root 外路径。
  - 二进制文件默认只记录 metadata；image assets 若不在允许类型内，只能作为 rejected file 展示。
  - 读取流必须有上限，不能先完整读入内存再判断；ZIP entry 的压缩比异常要拒绝。
- 测试和验证：目录/ZIP/归档三种来源、路径穿越、symlink、超预算、压缩炸弹样本、Unicode 文件名、Windows 盘符、流式读取测试。
- 验收证据：恶意 fixture 全部拒绝；reader 统计与 manifest 一致；内存使用和耗时在预算内；snapshot file manifest 可重现。
- Done when：所有 Package import/runtime file IO 经 PackageReader；路径和大小边界有单测/集成测试；没有直接 fs.readFile(packagePath) 的绕过路径。
- 风险和回滚：如果旧包包含不兼容文件，inspect 先显示 rejected files，保留包内容但不执行；不要为兼容性放宽 path policy。

### SKL-P3-003：Package Installer 的 inspect、install、snapshot 和事务边界

- 优先级：P0；类型：导入/持久化；前置：SKL-P3-001、SKL-P3-002、SKL-P0-002；可并行：P3-004、P3-005。
- 实现目标：把 PackageInstaller 从“落盘+局部持久化”升级为可预览、可审核、可回滚的导入事务：inspect 不修改业务状态，install 只提交经过确认的 immutable snapshot。
- 功能范围：
  1. inspect(source) 物化到临时目录，解析全部 package，生成 diagnostics、权限摘要、文件清单和 fingerprint，结束后清理临时目录。
  2. install(source, reviewId/confirmation) 重新校验 source fingerprint，写 package/version/snapshot/installation，并在失败时清理落盘和数据库半成品。
  3. 一个 archive 可包含多个 skill；每个 skill 的 install 结果独立但整个请求要返回 partial failure 细节。
  4. 安装重复内容采用 content hash 去重；同 package/version 不能覆盖 immutable version。
- 改动文件：
  - [MODIFY] src/server/skills/packages/package-installer.ts：inspect、install、persistSkill、materializeSource、readResponseBuffer、extractZip。
  - [MODIFY] src/server/skills/packages/manifest-resolver.ts、package-reader.ts。
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts：createPackage、createVersion、createInstallation transaction。
  - [NEW] src/server/skills/packages/package-install-review.service.ts。
  - [NEW] src/server/skills/packages/package-installer.test.ts、package-install.integration.test.ts。
- 函数/API：
  - PackageInstaller.inspect(source)、install(source, options)、persistSkill(data)。
  - POST /skill-packages/inspect → reviewId；POST /skill-packages/install 支持 reviewId、sourceFingerprint、confirm。
  - GET /skill-import-reviews/:id、POST /skill-import-reviews/:id/approve/reject（若采用统一 grant/review API，必须明确资源类型）。
- 数据变更：skill_import_reviews 保存 inspect 结果和 source fingerprint；skill_packages、skill_versions、skill_installations 增加 source_kind、source_ref、source_sha、snapshot_hash、installed_at、status。
- 边界和约束：
  - 不能仅根据 client 传入的 inspect 结果安装；install 必须在 server 端重算 fingerprint。
  - local-directory 只能导入允许目录；zip/GitHub archive 下载/解压均有硬上限。
  - 安装不自动 npm install、pip install、执行 postinstall，不访问网络以外的显式 GitHub archive 下载。
  - 安装完成前不创建 active installation；失败不留下可运行版本。
- 测试和验证：inspect 无 DB side effect；确认后 install；fingerprint changed 拒绝；重复 install、partial archive、事务失败清理、数据库回滚、目录权限测试。
- 验收证据：inspect/install 的请求响应和 DB snapshot；安装目录 hash 与 version hash 一致；失败场景无 orphan files/rows。
- Done when：本地目录、ZIP、合法 archive 的导入闭环可重复、可审计；inspect 和 install 有明确事务边界；immutable SkillVersion 不被覆盖。
- 风险和回滚：发布时默认 disabled 或只允许本地测试源；安装出错可删除新 installation/version snapshot，但不删除已被其他 Run 引用的版本。

### SKL-P3-004：GitHub Archive 安全导入和 source reproducibility

- 优先级：P1；类型：供应链/导入；前置：SKL-P3-002、SKL-P3-003；可并行：P3-005。
- 实现目标：支持 GitHub repository archive 导入，同时把 ref 解析为 commit SHA，保证安装内容可追溯、可复现并可审计。
- 功能范围：
  1. 解析 owner/repo/ref，调用 GitHub commit endpoint 得到 40 位 commit SHA，再下载对应 archive。
  2. 校验 redirect、content-length、实际响应字节、archive root 前缀和 subdirectory；记录 source URL、ref、commit SHA、archive hash。
  3. 支持 rate limit、404、非 GitHub host、私有仓库未授权、网络超时的稳定错误。
  4. 更新时同一 ref 若解析到新 SHA，生成新 SkillVersion，不改写旧版本。
- 改动文件：
  - [MODIFY] src/server/skills/packages/package-installer.ts：materializeGitHubArchive、commit SHA、archive limits。
  - [NEW] src/server/skills/packages/github-source.ts：parseGitHubSource、resolveCommitSha、downloadArchive。
  - [NEW] src/server/skills/packages/github-source.test.ts、fixtures/github-responses/*。
  - [MODIFY] src/server/skills/config/skill-runtime.config.ts：host allowlist、timeout、max bytes。
- 函数/API：
  - parseGitHubSource(url/ref)、resolveGitHubCommit(source)、downloadGitHubArchive(source, limits)。
  - POST /skill-packages/inspect 的 source.kind=github-archive；响应必须包含 resolvedCommitSha 和 sourceFingerprint。
- 数据变更：source_ref、resolved_commit_sha、archive_sha256、source_url、fetched_at、etag（如果记录）写入 skill_versions/source metadata。
- 边界和约束：
  - 仅允许 github.com 官方 archive/API host，禁止用户指定任意下载 host 或 query 注入。
  - 默认不使用 GitHub token；若未来支持，token 只能来自服务端 secret，绝不入库/事件。
  - ref 不是版本身份；commit SHA + archive hash 才能复现内容。
  - 下载/解压不能绕过 P3-002 reader limits。
- 测试和验证：URL 解析、ref 特殊字符、404/rate limit/redirect、内容长度不符、SHA 不合法、archive root 选择、同 commit fingerprint 稳定性测试。
- 验收证据：安装记录含 commit SHA/archive hash；断网和 API 错误有可读错误码；相同 SHA 的重复 inspect 结果相同。
- Done when：GitHub 导入可以从 ref 得到可验证的 immutable source；升级/回滚不依赖远端当前分支状态；安全边界有测试证据。
- 风险和回滚：GitHub API 不稳定时保留已缓存 snapshot 只读运行；禁止在无法解析 commit SHA 时以 ref 作为可运行版本。

### SKL-P3-005：npx skills 产物导入边界和安全说明

- 优先级：P1；类型：导入/兼容性；前置：SKL-P3-002、SKL-P3-003；可并行：P3-004。
- 实现目标：允许导入 npx skills 产生的目录/ZIP 产物，但不在 BloomAI 内执行 npx、npm install 或 package scripts，把它当作普通静态 Package 输入。
- 功能范围：
  1. 支持用户选择 npx skills 生成的本地目录或 ZIP；识别常见 .skills/skills/<name> 目录布局和单 skill 根目录。
  2. 在 inspect 结果中明确 source=local/npx-artifact、未执行命令、未安装依赖、仅导入静态文件。
  3. 产物中若包含 package.json、scripts、node_modules、.git 等，默认列为 ignored/rejected，不执行也不复制到运行 snapshot。
  4. 提供导入说明和命令示例，但 API 不接受任意 shell command 字符串。
- 改动文件：
  - [MODIFY] src/server/skills/packages/package-installer.ts、package-reader.ts、manifest-resolver.ts。
  - [NEW] src/server/skills/packages/npx-artifact-detector.ts：detectLayout、ignoredFiles。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts：source schema 增加 local-directory/zip metadata。
  - [NEW] src/server/skills/packages/npx-artifact-detector.test.ts。
  - [MODIFY] docs/skills/001-skills-system-refactor-analysis-v1.1.md（若需补充执行边界，以追加说明为原则）。
- 函数/API：
  - detectNpxSkillsArtifact(reader)、selectSkillRoots(reader)、describeIgnoredFiles。
  - 不提供 POST /skills/execute-command；npx 只能在用户自己的终端产生输入目录后再上传/选择。
- 数据变更：source metadata 增加 detected_layout、ignored_paths、execution_disclaimer；不保存 npm token、环境变量或命令行历史。
- 边界和约束：
  - 禁止 BloomAI server 调用 npx、npm、cmd、powershell、shell。
  - node_modules、可执行脚本和安装钩子不进入 snapshot；被引用但不存在的文件在 inspect 阶段 warning/error。
  - local-directory 路径仍需在允许导入根目录内，不能直接任意读取用户磁盘。
- 测试和验证：典型 npx 目录布局、混合多包、node_modules、package scripts、符号链接、错误根目录、命令注入字符串测试。
- 验收证据：UI/inspect 显示 ignored files 和“未执行 npx”声明；静态扫描证明没有 child_process.exec/spawn 的导入路径；安装 snapshot 不包含 node_modules。
- Done when：可以安全导入 npx skills 的静态产物；用户知道 npx 在 BloomAI 外执行；导入不为任意命令执行开后门。
- 风险和回滚：布局兼容失败时让用户通过 subdirectory 明确选择根目录；不放宽文件系统 policy 来“猜”目录。

### SKL-P4-001：统一 Legacy 和 Package Domain Facade

- 优先级：P1；类型：领域服务/兼容性；前置：SKL-P0-003、SKL-P1-003、SKL-P3-003；可并行：P4-002、P4-003。
- 实现目标：提供面向 UI/API 的统一 Skills facade，但在内部保留 Legacy Skill 和 Package Skill 两个不同 domain，避免通过统一 DTO 掩盖执行语义差异。
- 功能范围：
  1. listInstalled、listCatalog、getDetail、enable/disable、uninstall、delete、run、listRuns 等操作根据 reference kind 分流。
  2. 返回 sourceType、version、capabilities、status、supportedActions、runtimeKind，让 UI 可正确展示 legacy/package。
  3. Package Skill 的 run 走 durable queue；Legacy Skill 仍走旧 service，直到迁移完成。
  4. 错误统一为 ServiceError/HTTP error code，但保留 domain detail。
- 改动文件：
  - [NEW] src/server/skills/application/skills-facade.service.ts：list/get/mutate/run。
  - [MODIFY] src/server/services/skill.service.ts：只维护 Legacy adapter。
  - [MODIFY] src/server/services/skill-package-runtime.service.ts：Package facade adapter。
  - [MODIFY] src/server/http/routes/skills.ts、skill-package-runtime.ts：逐步改用 facade。
  - [NEW] src/server/skills/application/skills-facade.service.test.ts。
- 函数/API：
  - SkillsFacade.list(query)、get(reference)、enable(reference)、disable(reference)、uninstall(reference)、startRun(reference, input)。
  - [NEW/兼容] GET /api/v1/skills/overview 返回统一卡片 DTO；现有 Legacy endpoint 行为保持。
- 数据变更：无强制新增表；可增加 source_type/runtime_kind 的计算字段，不复制状态。
- 边界和约束：
  - 统一 facade 不允许把 Package Skill 映射成 Legacy js-function/http-api/prompt-template。
  - 不允许对 Legacy Skill 显示 Package-only 的 grants/events，反之亦然。
  - reference id 必须无歧义；推荐 package:<id>、legacy:<id> 内部形式，但外部兼容旧 id。
- 测试和验证：两种 domain 的 list/get/run/disable/uninstall、错误映射、分页、兼容旧响应测试。
- 验收证据：Skills Overview 同时展示两类 skill；每类 Run 进入各自正确表和执行链；legacy API 回归通过。
- Done when：UI/API 有统一入口但领域边界清晰；迁移过程中不会因 facade 把旧 Skill 误送入新 Worker。
- 风险和回滚：先只新增 overview API，不修改旧 endpoint；出现问题可关闭 facade feature flag，旧路由仍可用。

### SKL-P4-002：Mastra Skill Source、Dynamic Resolver 和 skill tools

- 优先级：P1；类型：Mastra 集成；前置：SKL-P4-001、SKL-P1-003；可并行：P4-003。
- 实现目标：利用 Mastra 作为 Agent/模型运行时，而不是把它当作 Skills Control Plane；Package Skill 通过动态解析在 Run 内注入指令和 capability contract，不在全局同步 buildSkillTools 中无条件挂载。
- 功能范围：
  1. 定义 Mastra SkillSource/InstructionResolver：按 skillVersionId 加载 canonical manifest、SKILL.md、references、assets metadata。
  2. buildSkillTools() 继续只挂 Legacy Skill 和系统内置工具；Package Skill 使用 Run-scoped tools/resolver。
  3. 每次 Run 创建独立上下文，避免一个用户/skill 的 instruction 或 tool state 污染另一个 Run。
  4. Mastra agent 输出映射为 InstructionAgentExecutionResult，任何 capability 调用回 Capability Broker。
- 改动文件：
  - [MODIFY] src/server/mastra/index.ts、chat-agent.ts：增加 runtime resolver 注入点。
  - [MODIFY] src/server/mastra/tools.ts：保留 Legacy surface，加入 capability contract adapter。
  - [NEW] src/server/mastra/skills/mastra-skill-source.ts：loadSkillSource、resolveInstructions、createRunToolSet。
  - [NEW] src/server/mastra/skills/mastra-skill-source.test.ts、mastra-run.integration.test.ts。
  - [MODIFY] src/server/skills/adapters/instruction-agent-adapter.ts。
- 函数/API：
  - MastraSkillSource.load(skillVersionId)、getInstructions()、listReferences()、listAssets()、createToolSet(runContext)。
  - createChatAgent/session path 不直接读取 package files；只通过 source/adapter。
- 数据变更：无；run metadata 可写 mastra_model、agent_name、prompt_version 方便诊断。
- 边界和约束：
  - Mastra 负责 Agent/模型编排，不拥有安装、版本、授权、队列和审计事实。
  - 不允许把不可信 SKILL.md 作为动态 JS/TS 代码 import；只作为文本/结构化输入。
  - Package tools 不能通过全局 singleton 保存 run state。
- 测试和验证：同一 package 并发 Run 隔离、动态 source 缺失、版本切换不影响进行中 Run、tool set 不包含禁用能力、Mastra 错误映射测试。
- 验收证据：Mastra trace/Run event 显示 skillVersionId；buildSkillTools 结果不包含未授权 Package Skill；Package capability 都经过 Broker。
- Done when：Mastra 与 BloomAI Control Plane 的职责边界在代码中清晰；Package Skill 可由 Mastra 执行但不会污染全局 tool surface。
- 风险和回滚：Mastra API 变化时保持 MastraSkillSource adapter；可临时禁用 Package execution，不影响 Legacy chat。

### SKL-P4-003：Workspace 生命周期和项目路径隔离

- 优先级：P1；类型：文件系统/项目隔离；前置：SKL-P0-001、P3-002；可并行：P4-002。
- 实现目标：明确 Skill Package snapshot、Artifact run directory、项目 workspace、用户导出目录的生命周期和读写边界，避免把 Package Runtime 变成任意 workspace 写入器。
- 功能范围：
  1. 复用 ProjectWorkspaceFactory/Policy 建立 project/session scoped workspace，但 Package 首期只拥有受控只读 project context。
  2. Skill Runtime 的输出只进入 ArtifactStore；用户显式 export 后才写入允许的 destinationDir。
  3. 定义 snapshot cleanup、artifact retention、export audit 和临时目录清理。
  4. 对 Windows path、junction、symlink、UNC path 做统一检查。
- 改动文件：
  - [MODIFY] src/server/mastra/workspace/project-workspace.factory.ts、project-workspace.policy.ts。
  - [MODIFY] src/server/skills/packages/package-reader.ts、src/server/skills/artifacts/artifact-store.ts。
  - [NEW] src/server/skills/filesystem/skill-path-policy.ts、skill-path-policy.test.ts。
  - [MODIFY] src/server/skills/config/skill-runtime.config.ts。
- 函数/API：
  - createProjectWorkspace、assertReadableWorkspace、resolveRunDirectory、resolveExportDestination、cleanupRunArtifacts。
  - POST /skill-artifacts/:id/export 必须校验 runId、destinationDir、用户确认和审计理由。
- 数据变更：artifact 和 snapshot 增加 retention_until、exported_at、exported_by；可新增 skill_workspace_audits。
- 边界和约束：
  - Package Skill 首期没有任意 workspace write；写入 workspace 只能作为后续显式 capability 和人工批准功能。
  - destinationDir 必须由用户选择/配置并通过 allowlist；禁止自动导出到源码、桌面或任意系统目录。
  - 清理不能删除用户导出的文件；只清理应用 data root 下的临时和运行目录。
- 测试和验证：Windows path cases、junction/symlink、export ownership、cleanup、retention、并发导出、路径 escape 测试。
- 验收证据：路径 policy 的拒绝样例；导出审计记录；临时目录清理报告；运行期间 package 无 workspace write。
- Done when：所有 Skill 文件读写都有明确 root 和 ownership；Artifacts 是唯一默认写入目标；导出行为可审计、可回滚。
- 风险和回滚：若新路径 policy 影响旧 Image Studio，先为旧功能保留专用 adapter，不放宽 Package policy。

### SKL-P4-004：Legacy Skill 兼容 Adapter 和迁移边界

- 优先级：P1；类型：兼容性/迁移；前置：SKL-P4-001；可并行：P4-002、P4-003。
- 实现目标：在不破坏已有 js-function、http-api、prompt-template 和旧 UI 的前提下，建立清晰迁移出口；不把旧任意 JS 执行能力误认为安全 Package Skill。
- 功能范围：
  1. LegacySkillAdapter 将旧 skill.service 的 list/install/run/update/delete 映射到 facade。
  2. 标记 Legacy capability profile、风险等级、迁移建议和可否转换为 SKILL.md Package。
  3. 对旧运行保留现有 skill_runs 和 API；新 Package 的审计/事件/Artifact 不回写旧表。
  4. 提供只读转换预览：把 prompt-template 描述转换为 draft 建议，但不自动发布。
- 改动文件：
  - [MODIFY] src/server/services/skill.service.ts：收敛为 Legacy adapter。
  - [NEW] src/server/skills/application/legacy-skill.adapter.ts、legacy-skill.adapter.test.ts。
  - [MODIFY] src/server/http/routes/skills.ts、src/renderer/pages/Skills/skills.store.ts。
  - [NEW] src/server/skills/creator/legacy-to-draft.service.ts（与 P5-003 对接）。
- 函数/API：
  - LegacySkillAdapter.list/get/install/update/delete/run。
  - GET /skills/:id/migration-preview 返回风险和 draft preview；不修改旧 Skill。
- 数据变更：Legacy skill 可增加 migration_status/migration_target_version，但不能改变旧运行历史。
- 边界和约束：
  - 不允许把旧 js-function 自动导入为安全 Package；必须人工审查 capability。
  - 旧 API 的错误和响应形状保持兼容；新 facade 只加字段，不删字段。
  - Legacy Skill 的 shell/JS 权限继续按旧 policy 管理，不能借 Package grant 绕过。
- 测试和验证：旧 API contract、旧 UI smoke、迁移 preview、不改变旧表、Legacy 与 Package 并存测试。
- 验收证据：旧 Skills 页面功能不回归；preview 只有草稿数据；两种 runtime 的 DB 写入表清晰可查。
- Done when：Legacy 和 Package 可并行运行，迁移有显式边界；没有“悄悄转换”导致权限扩大。
- 风险和回滚：兼容 adapter 出问题时回退 routes 到原 skill.service；不删除任何 Legacy 表或数据。


### SKL-P5-001：SkillVersion immutable、版本列表、Diff 和更新

- 优先级：P1；类型：版本管理/控制面；前置：SKL-P3-003、SKL-P4-001；可并行：P5-003。
- 实现目标：把 SkillPackage、SkillVersion、SkillInstallation 三者关系固化：Version 不可变，Installation 指向 current version，更新只创建新版本并通过显式切换完成。
- 功能范围：
  1. 版本详情包括 canonical manifest、source metadata、snapshot hash、requested capabilities、files manifest、createdAt、security status。
  2. 支持 list versions、compare versions、preview update、install new version、switch current version。
  3. compare 输出 manifest diff、file added/changed/removed、capability added/removed、source SHA changed、risk summary。
  4. 更新前检查运行中 Run、active grants、compatibility 和 migration note；不自动停止正在运行的旧版本。
- 改动文件：
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts：listVersions、createVersion、setCurrentVersion、version references。
  - [NEW] src/server/skills/application/skill-version.service.ts：list、diff、previewUpdate、update、switchCurrent。
  - [NEW] src/server/skills/application/skill-version.diff.ts、skill-version.diff.test.ts。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts：版本 API。
  - [MODIFY] src/renderer/pages/Skills/PackageDetailDrawer.tsx、skill-runtime.types.ts、skill-runtime.store.ts。
  - [NEW] src/server/skills/application/skill-version.service.test.ts。
- 函数/API：
  - listVersions(packageId)、getVersion(versionId)、diffVersions(fromId, toId)、previewUpdate(packageId, source)、updatePackage(packageId, source)、switchCurrent(installationId, versionId)。
  - GET /skill-packages/:id/versions、GET /skill-versions/:id、GET /skill-versions/:id/diff?toVersionId=。
  - POST /skill-packages/:id/update、POST /skill-installations/:id/switch-version。
- 数据变更：skill_versions 增加 immutable hash/created_at/status；skill_installations 增加 current_version_id、previous_version_id、changed_at；新增 skill_version_diffs 可缓存但必须可重算。
- 边界和约束：
  - 版本内容、manifest、snapshot hash 一旦发布不可 update；修正必须创建新版本。
  - 已被 Run 引用的版本不能物理删除；current pointer 变更需要 expectedRevision/idempotency。
  - diff 只展示摘要和安全 metadata，不把完整私密 prompt 或 token 展示给无权限用户。
- 测试和验证：版本不可变、同 hash 去重、diff deterministic、capability expansion warning、current switch CAS、运行中旧版继续执行、更新失败不改变 current version。
- 验收证据：版本列表/对比界面截图；DB old/new version rows；更新前后 current pointer；旧 Run 仍引用旧 versionId。
- Done when：用户能知道“安装了哪个版本、来源是什么、更新改变了什么”；更新无覆盖和无隐式权限扩大。
- 风险和回滚：更新默认不自动切换 current；用户确认后 switch；若新版本不可运行，保留旧 current 并允许 rollback。

### SKL-P5-002：Rollback、禁用、卸载和删除语义

- 优先级：P1；类型：生命周期/安全；前置：SKL-P5-001、SKL-P1-004；可并行：P5-003。
- 实现目标：定义 disable、uninstall、delete、rollback 的可逆性、引用保护和审计证据，避免 UI 中“删除”造成运行历史或 Artifact 丢失。
- 功能范围：
  1. disable：禁止新 Run，保留已启动 Run 和只读详情；可重新 enable。
  2. uninstall：移除 installation current pointer，保留 package/version/snapshot/Run 记录；可重新安装。
  3. delete：只有无 active installation、无运行中 Run、无不可删除引用并通过确认才允许删除控制面对象；默认 soft delete。
  4. rollback：installation current version 切换到上一个已验证 version，不删除坏版本；记录 rollback reason。
- 改动文件：
  - [NEW] src/server/skills/application/skill-lifecycle.service.ts：enable、disable、uninstall、softDelete、rollback。
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts：lifecycle CAS/reference checks。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts：lifecycle API。
  - [MODIFY] src/renderer/pages/Skills/PackageDetailDrawer.tsx、Skills/index.tsx、skill-runtime.store.ts。
  - [NEW] src/server/skills/application/skill-lifecycle.service.test.ts。
- 函数/API：
  - disableInstallation(id, expectedRevision)、enableInstallation、uninstallInstallation、rollbackInstallation(id, versionId)、requestDeletePackage(id, confirmation)。
  - PATCH /skill-installations/:id、DELETE /skill-installations/:id、POST /skill-installations/:id/rollback、DELETE /skill-packages/:id。
- 数据变更：installation status/disabled_at/uninstalled_at/deleted_at；package deletion audit；保留 Run/Artifact foreign key 语义（软删除优先）。
- 边界和约束：
  - DELETE 不等于物理清理；物理 snapshot cleanup 由 retention job 且无引用时进行。
  - 禁用不取消正在运行的 Run；用户需显式 cancel。
  - rollback 到 disabled/invalid version 要拒绝；版本验证 status 必须为 runnable/verified。
  - 删除/卸载必须校验 ownership/权限和 CSRF/idempotency 语义。
- 测试和验证：disable 新 Run 拒绝、existing Run 可读、uninstall/reinstall、delete blocked by references、rollback CAS、重复操作幂等、软删除不影响审计。
- 验收证据：生命周期状态图、API 响应、审计事件和引用检查结果；UI 确认框明确说明保留内容。
- Done when：每个生命周期操作可解释、可逆或有明确不可逆警告；不会误删 Run、Event、Artifact 证据。
- 风险和回滚：所有删除先 soft delete；物理 cleanup 先做 dry-run 报告，确认无引用后再启用。

### SKL-P5-003：Skills Creator 草稿、验证和发布领域服务

- 优先级：P1；类型：Creator/产品能力；前置：SKL-P3-001、SKL-P3-002、SKL-P5-001；可并行：P5-002。
- 实现目标：实现单页工作台方案中的 Skills Creator：用户可以创建/编辑草稿、查看文件和能力声明、运行校验和预览，但只有显式发布才生成 immutable SkillVersion。
- 功能范围：
  1. Draft 包含 name、slug、description、SKILL.md body、references、assets metadata、capability requests、visibility、author、baseVersionId。
  2. 支持 create/update/save draft、validate、preview、test run（沙盒只读/低预算）、publish、discard。
  3. validate 复用 ManifestResolver/PackageReader/CapabilityPolicy，返回 errors/warnings/security findings/preview summary。
  4. publish 使用 transaction 生成 package/version/snapshot/installation（是否自动 enable 由 UI 选择，默认 disabled），发布后 draft 可继续编辑为新版本但已发布 version 不变。
- 改动文件：
  - [NEW] src/server/skills/creator/skill-draft.service.ts：create、update、validate、preview、publish、discard。
  - [NEW] src/server/skills/creator/skill-draft.schema.ts、skill-draft.service.test.ts。
  - [MODIFY] src/server/skills/packages/manifest-resolver.ts、package-reader.ts、package-installer.ts：复用 canonical pipeline。
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts、src/server/db/schema.ts。
  - [NEW] scripts/migrations/008-skill-version-drafts-and-snapshots.sql 或实际顺序 migration。
  - [NEW] src/server/http/routes/skill-creator.ts。
  - [MODIFY] src/server/http/app.ts/实际 route 注册文件。
- 函数/API：
  - createDraft(input)、getDraft(id)、updateDraft(id, patch, expectedRevision)、validateDraft(id)、previewDraft(id)、publishDraft(id, options)、discardDraft(id)。
  - POST /api/v1/skill-drafts、GET/PATCH/DELETE /api/v1/skill-drafts/:id。
  - POST /api/v1/skill-drafts/:id/validate、POST /api/v1/skill-drafts/:id/preview、POST /api/v1/skill-drafts/:id/publish。
- 数据变更：skill_drafts：id、owner_id、status、revision、content_json、validation_json、base_version_id、published_version_id、created_at、updated_at；draft files 可存 data root，不直接写正式 snapshot。
- 边界和约束：
  - Draft 编辑器不能执行任意脚本；preview/test run 仍经过 Package Runtime policy、queue、budget 和 Artifact ownership。
  - 发布不能带入被拒绝 capability、非法 path 或超过文件预算的内容。
  - 草稿内容和 preview artifact 必须按 owner/session 隔离；不能通过 draft id 访问他人草稿。
  - autosave 使用 revision/CAS，离线/冲突显示，不覆盖他人更改。
- 测试和验证：草稿 CRUD/CAS、Markdown/frontmatter validation、capability add warning、preview 只读、publish immutable version、discard cleanup、ownership、XSS/Markdown sanitization、浏览器编辑器测试。
- 验收证据：Creator 页面操作录像/截图；validate 结果；publish 后 package/version/snapshot DB 证据；再次编辑不会改变已发布 hash。
- Done when：用户无需手工创建目录即可产生合法 SKILL.md Package；验证、预览、发布链路有 API/数据库/前端闭环；发布不会绕过导入安全规则。
- 风险和回滚：Creator 默认只允许本地草稿；发布失败保留草稿和 validation result，不产生半成品 active installation；可关闭 creatorPublish 保留查看/编辑。

### SKL-P6-001：Artifact Store ownership、类型和导出生命周期

- 优先级：P0；类型：产物/数据边界；前置：SKL-P1-003、SKL-P4-003；可并行：P6-002。
- 实现目标：把 Artifact 从运行目录中的文件提升为有类型、hash、ownership、保留期和导出状态的正式领域对象。
- 功能范围：
  1. 支持 markdown、json、prompt、image-reference、directory-manifest 等首期类型；文件名安全、mime/type 固定映射。
  2. writeText、writeImageReference、readContent、exportArtifact、removeRun 全部校验 run ownership 和生命周期。
  3. Artifact metadata 包括 size、sha256、relativePath、mimeType、kind、createdAt、retentionUntil、exportedBy。
  4. list artifacts 支持分页、排序、内容摘要；读取原始内容必须经过 runId ownership。
- 改动文件：
  - [MODIFY] src/server/skills/artifacts/artifact-store.ts：writeText、writeImageReference、readContent、exportArtifact、removeRun、writeBuffer、safeFileName、resolveArtifactFile。
  - [MODIFY] src/server/db/repositories/skill-package.repo.ts、src/server/db/schema.ts、scripts/migrations/003-skill-runtime-artifacts.sql。
  - [NEW] src/server/skills/artifacts/artifact-policy.ts、artifact-store.test.ts、artifact-security.test.ts。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts。
- 函数/API：
  - GET /skill-runs/:id/artifacts、GET /skill-artifacts/:id/content?runId=、POST /skill-artifacts/:id/export。
  - artifactStore.writeText、writeImageReference、readContent、exportArtifact。
- 数据变更：skill_artifacts 增加 artifact_kind、mime_type、size_bytes、sha256、relative_path、retention_until、exported_at、exported_by、metadata_json。
- 边界和约束：
  - artifactId + runId 双重 ownership；不允许仅凭 artifactId 读内容。
  - 文件名必须为单一 basename，禁止绝对路径、分隔符、控制字符；内容和 metadata 有上限。
  - export destination 必须是已授权目录，导出使用临时文件+rename，避免半写文件。
  - 删除 run 不得删除已导出文件；审计保留 export 证据。
- 测试和验证：ownership、path traversal、oversize、hash、mime、atomic export、retention cleanup、重复导出、损坏文件检测。
- 验收证据：Artifact 列表、内容预览、导出文件 hash 与 DB 一致、跨 Run 读取失败、清理报告。
- Done when：所有 Run 输出都能通过 Artifact API 查询和导出；文件系统路径不直接暴露给 renderer；ownership 和 retention 可验证。
- 风险和回滚：旧 image generation 文件暂时通过 reference adapter 读取；不直接移动旧文件，先建立 metadata 映射。

### SKL-P6-002：Image Studio 和 Article Illustration Capability Adapter 接入

- 优先级：P1；类型：能力适配/产品闭环；前置：SKL-P2-002、SKL-P6-001；可并行：P6-003。
- 实现目标：让 Package Skill 的 image.generate 复用现有 Image Studio/Article Illustration 能力，但保持异步 session、grant、Artifact 和 Run 之间的边界。
- 功能范围：
  1. image-studio-capability-adapter 接受规范化 input，校验 model、prompt、size、count、reference image metadata 和 grant scope。
  2. 创建或关联 image session/generation，保存 runId、skillVersionId、grantId，结果写 image-reference Artifact。
  3. article-illustration.service.ts 的 skill mode 使用 Package Run/Grant/Artifact 语义；fallback mode 保持旧路径并明确标记。
  4. Image Studio UI 可以从 Run Detail 打开关联 session，不能绕过 run ownership 下载他人图片。
- 改动文件：
  - [MODIFY] src/server/skills/adapters/image-studio-capability-adapter.ts。
  - [MODIFY] src/server/services/article-illustration.service.ts 或实际路径。
  - [MODIFY] src/server/mastra/tools.ts、src/server/http/routes/skill-package-runtime.ts。
  - [MODIFY] src/renderer/api/index.ts、src/renderer/pages/ImageStudio/index.tsx、ImageChatPanel.tsx、ArticleIllustrationWorkbench.tsx。
  - [NEW] src/server/skills/adapters/image-studio-capability-adapter.test.ts、article-illustration-skill.integration.test.ts。
- 函数/API：
  - executePackageImageCapability(request)、createImageGeneration、linkImageSessionToRun、toImageReferenceArtifact。
  - Eligible image skill API 统一返回 packageId/packageName/skillVersionId/requiredCapabilities/activeImageGrant。
- 数据变更：image_sessions/image_generations 增加 skill_run_id/skill_version_id/grant_id（如已有字段，确认索引和 null 兼容）；Artifact metadata 记录 generation id。
- 边界和约束：
  - image.generate 每次调用都消费 grant budget；失败/重试不能重复扣除或必须记录补偿。
  - 图片 binary 不塞进 Run event；event 只写 generation/artifact references。
  - skill mode 和 fallback mode 必须可观测区分；不能用 fallback 绕过 grant。
- 测试和验证：grant missing/expired、model scope、maxCalls、generation timeout、session linking、fallback compatibility、artifact ownership、UI association。
- 验收证据：一条 Package Run 生成图片并显示 Artifact；Image Studio session 能回溯 run；审计含 capability/grant/generation 关系。
- Done when：Package Skill 可安全调用图片能力；现有 Image Studio/文章插图不回归；图片结果通过 Artifact/关联 session 可展示。
- 风险和回滚：先只接入 image.generate；失败时把 Package Run 标为 capability failed，不切换到无授权 fallback；旧 article fallback 保持独立。

### SKL-P6-003：Chat 调用面接入 Package Skills

- 优先级：P1；类型：对话集成；前置：SKL-P4-002、SKL-P5-001、SKL-P6-001；可并行：P7 前端 API。
- 实现目标：使 Chat 能发现和调用已启用的 Package Skill，同时维持 Chat 的同步交互体验和 Runtime 的异步 durable 事实来源。
- 功能范围：
  1. Chat 只选择可用的 Skill reference/version，不把所有 package 指令常驻拼入 system prompt。
  2. 用户触发 Package Skill 后创建 durable Run，Chat 显示 run card、progress、waiting action、result artifacts。
  3. 支持从 ChatPanelMastra 发送 input、取消、审批、打开 Run Detail；消息中保存 runId/versionId。
  4. package skill 失败不污染普通 chat message；可在同一 session 中继续对话或重试。
- 改动文件：
  - [MODIFY] src/renderer/pages/Chat/ChatPanelMastra.tsx、src/renderer/api/index.ts。
  - [MODIFY] src/server/mastra/chat-agent.ts、mastra/index.ts、http routes。
  - [NEW] src/server/skills/application/chat-skill-launcher.ts、chat-skill-launcher.test.ts。
  - [MODIFY] src/renderer/pages/Skills/skill-runtime.types.ts、skill-runtime.store.ts。
- 函数/API：
  - listChatEligibleSkills(sessionId)、startSkillRunFromChat、attachRunToMessage、handleRunAction。
  - POST /chat/sessions/:id/skill-runs（或沿用 POST /skill-runs，必须保持唯一 canonical endpoint）。
- 数据变更：messages/parts 增加 structured skillRun reference；不把完整 Run event 复制进消息正文。
- 边界和约束：
  - Chat 触发必须经过 installation enabled、version runnable、user ownership、capability policy。
  - UI 不能仅凭 message 中的 skill name 执行，必须使用 server 返回的 runId/versionId。
  - 同一 message 的重复 submit 使用 idempotencyKey。
- 测试和验证：Chat launch、run card update、SSE/poll fallback、cancel/approval、message persistence、普通聊天回归、跨用户 skill visibility。
- 验收证据：聊天中展示 Run 状态和 Artifact；刷新后仍可恢复 Run card；普通聊天路径没有引入 Package Skill 指令。
- Done when：Chat、Skills Center、Run Detail 使用同一 durable Run；Package Skill 既可从管理页运行也可从 Chat 运行。
- 风险和回滚：先只在显式 skill picker 开启 Package Skill，隐藏自动路由；出现问题可禁用 chat launcher，普通 Mastra chat 继续可用。


### SKL-P7-001：补齐 Package Runtime HTTP API、错误、分页和幂等

- 优先级：P0；类型：后端 API；前置：P1、P2、P3、P5、P6 相应服务；可并行：P7-002、P7-003。
- 实现目标：把现有 skill-package-runtime.ts 从“接口已存在”升级为稳定的资源 API：统一 DTO、分页、错误码、ownership、幂等和 SSE/afterSeq 语义。
- 功能范围：
  1. 对 inspect/install、packages、versions、installations、grants、runs、events、commands、artifacts、drafts 提供资源化路由。
  2. 所有 mutation 使用 zod schema、idempotencyKey/expectedRevision（按资源要求）、统一 ServiceError mapping。
  3. 列表接口使用 limit/offset 或 cursor 中一种明确协议，返回 total/nextCursor/hasMore；禁止无上限 list。
  4. SSE 只负责实时推送，afterSeq API 作为可靠补偿；断线、超时和浏览器刷新可恢复。
- 改动文件：
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts：所有现有 route、readValidated、pageMeta、errorResponse。
  - [MODIFY] src/server/http/routes/skills.ts：Legacy 路由边界和 overview。
  - [MODIFY] src/server/services/skill-package-runtime.service.ts：mapRuntimeError/rethrowMappedRuntimeError。
  - [NEW] src/server/http/dtos/skill-runtime.dto.ts、skill-runtime.error.ts。
  - [NEW] src/server/http/routes/skill-creator.ts、skill-runtime.routes.test.ts、skill-runtime.http.integration.test.ts。
  - [MODIFY] 实际 HTTP app/route registration 文件。
- 函数/API：
  - 复核/补齐 POST /skill-packages/inspect、POST /skill-packages/install、GET/PATCH/DELETE packages/installations、GET versions/diff/update/rollback。
  - 复核/补齐 GET/POST skill-runs、GET run/events、GET stream、POST commands/cancel。
  - 补齐 grant approve/reject/revoke、artifact metadata/content/export、draft CRUD/validate/preview/publish。
  - error codes 至少包括 VALIDATION_ERROR、NOT_FOUND、FORBIDDEN、FEATURE_DISABLED、REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、PACKAGE_INSTALL_ERROR、RUN_STATE_ERROR、CAPABILITY_APPROVAL_REQUIRED、CAPABILITY_DENIED、ARTIFACT_NOT_FOUND、RATE_LIMITED。
- 数据变更：无需新表；确保 API 需要的查询索引和 command result 持久化存在。
- 边界和约束：
  - 服务端永远重新做 ownership/policy 检查；不能相信 renderer 传入的 userId/skillVersionId scope。
  - 错误 message 可给用户但不能带内部堆栈、路径、token、SQL；日志可关联 requestId/runId。
  - DELETE/PATCH/POST 对重复请求必须定义 idempotent 或返回 IDEMPOTENCY_CONFLICT。
  - route handler 不直接操作 DB，必须调用 Application service/facade。
- 测试和验证：schema validation、HTTP status/error shape、pagination boundaries、ownership、idempotency、revision conflict、SSE auth、CORS/CSRF（按桌面 app 模式）、rate limit 测试。
- 验收证据：OpenAPI-like endpoint catalog、HTTP contract test snapshots、错误码清单、SSE afterSeq 演示、重复请求响应一致性。
- Done when：前端只依赖稳定 DTO/API；每个写操作的幂等和 revision 语义明确；现有 API 不被隐式改行为；API 可以支撑 Skills Center 和 Creator。
- 风险和回滚：新增 route 先以 v1 additive 方式发布；旧 routes 保留 adapter；发现 DTO 兼容问题时只添加字段并版本化，不破坏旧字段。

### SKL-P7-002：Renderer API、类型和 Zustand Runtime Store 重构

- 优先级：P1；类型：前端数据层；前置：P7-001；可并行：P7-003、P7-004。
- 实现目标：将 renderer 的 API、DTO、状态、SSE/轮询和 mutation feedback 统一，消除 Skills 页面把 legacy store 和 package runtime store 混合管理造成的竞态。
- 功能范围：
  1. api/index.ts 增加 typed methods：inspect/install/list/detail/version/diff/lifecycle/run/events/commands/grants/artifacts/drafts。
  2. skill-runtime.types.ts 统一 DTO、Error、Pagination、RunAction、Capability、Artifact、Draft 类型；禁止 any 扩散。
  3. skill-runtime.store.ts 管理 package query cache、selected package/version/run、event cursor、pending mutation、optimistic state；SSE 断线自动 afterSeq 补偿。
  4. skills.store.ts 只管理 Legacy，或通过 facade selector 明确分流；不得把 package run 放入旧 run list。
- 改动文件：
  - [MODIFY] src/renderer/api/index.ts：apiFetch、runtime API methods、error normalization。
  - [MODIFY] src/renderer/pages/Skills/skill-runtime.types.ts。
  - [MODIFY] src/renderer/pages/Skills/skill-runtime.store.ts。
  - [MODIFY] src/renderer/pages/Skills/skills.store.ts。
  - [NEW] src/renderer/pages/Skills/skill-runtime.api.test.ts、skill-runtime.store.test.ts。
  - [MODIFY] src/renderer/App.tsx：路由/feature capability 初始化。
- 函数/API：
  - api.platform.inspectSkillPackage、installSkillPackage、getSkillPackages、getSkillPackage、getSkillVersions、diffSkillVersions、update/rollback/enable/disable。
  - api.platform.createSkillRun、getSkillRun、listSkillRunEvents、subscribeSkillRunEvents、dispatchSkillRunCommand、listArtifacts、exportArtifact、draft APIs。
  - store actions loadPackages/loadRuns/selectRun/appendEvents/approve/reject/cancel/refreshAfterConflict。
- 数据变更：无；local UI state 可存 event cursor、draft revision、last server timestamp，但不能成为业务事实来源。
- 边界和约束：
  - 所有 mutation 成功后以 server response reconcile；乐观更新失败要回滚并展示 REVISION_CONFLICT。
  - SSE EventSource 不携带敏感 token；桌面 app 认证沿用现有 apiFetch 机制。
  - 大文件/Artifact 内容不放入 Zustand 全量缓存，只存 metadata/preview。
- 测试和验证：API mock、HTTP error normalization、store concurrency、SSE reconnect afterSeq、stale revision、pagination、unmount cleanup、TypeScript strict build。
- 验收证据：浏览器 network log、store dev snapshot、刷新后 state 恢复、断网重连演示、类型检查无新增 any。
- Done when：前端 data layer 能可靠表达 durable Run/Grant/Artifact/Draft；页面不直接拼接 URL 或解读 raw DB row；legacy/package 状态不串线。
- 风险和回滚：先在 runtime 页面使用新 store，旧 Skills 页面保持旧 store；发现问题可单独关闭 Package Center route。

### SKL-P7-003：Skills Center 单页工作台

- 优先级：P1；类型：管理 UI；前置：P7-001、P7-002、P5-002；可并行：P7-004、P7-005。

- 实现目标：根据 docs/skills/ui 的单页工作台方案，提供安装、市场/导入、版本、运行、能力、Artifact 和 Creator 入口的统一后台 Skills 管理界面。

  单页工作台方案页面UI: bloomai/docs/skills/ui/skill-management-console-v1.1.html

- 功能范围：
  1. 左侧导航/过滤：Installed、Available/Import、Runs、Drafts；顶部搜索、来源、runtime、状态筛选。
  2. 主列表展示 legacy/package source type、current version、enabled、risk/capabilities、last run；支持详情抽屉。
  3. Package Detail 展示 manifest、文件树、来源 SHA、版本列表/diff、capabilities/grants、生命周期操作和运行入口。
  4. Run 列表/详情展示状态时间线、event stream、next action、输入摘要、错误、Artifacts、取消/重试/审批。
  5. 单页内打开 Skills Creator；从导入 inspect 结果可跳转 Creator 草稿或直接安装。
  
- 改动文件：
  - [MODIFY] src/renderer/pages/Skills/index.tsx：从 SkillsMarket 拆分/编排页面。
  - [MODIFY] src/renderer/pages/Skills/PackageInstallDialog.tsx、PackageDetailDrawer.tsx、RunDetailDrawer.tsx。
  - [MODIFY] src/renderer/pages/Skills/skills.store.ts、skill-runtime.store.ts、skill-runtime.types.ts。
  - [NEW] src/renderer/pages/Skills/SkillsCenterWorkbench.tsx、SkillsSidebar.tsx、SkillOverviewPanel.tsx、SkillVersionPanel.tsx、SkillCapabilityPanel.tsx、SkillArtifactPanel.tsx。
  - [MODIFY] src/renderer/App.tsx、导航组件实际文件。
  - [NEW] src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx、skills-center.e2e.ts。
  
- 函数/API：
  - Workbench 子组件只通过 store actions；禁止在 UI 直接调用 server repository。
  - onOpenPackage、onOpenRun、onInstall、onDisable、onRollback、onCreateDraft、onOpenCreator 等事件处理。
  
- 数据变更：无；URL/hash 可保存 selectedPackageId/selectedRunId/tab，便于刷新恢复，但不可包含 secret。

- 边界和约束：
  - UI 必须明确区分 Legacy 与 Package，Package-only 动作对 Legacy 隐藏或禁用并说明原因。
  - 危险操作（install external source、publish、delete、export、grant approve）必须有确认和影响摘要。
  - 大文件列表/事件流分页；空态、加载态、错误态、权限拒绝、功能关闭都必须设计。
  - 不允许用颜色单独表达状态；需文字、图标/ARIA 和 screen reader label。
  
- 测试和验证：组件单测、键盘导航、a11y、响应式窗口、错误空态、真实 API mock、浏览器 E2E 覆盖导入→安装→运行→Artifact。

- 验收证据：浏览器截图/录屏、network trace、UI 状态与 API/DB 对应证据、a11y 检查报告。

- Done when：管理员在一个 Skills Center 中完成安装、启停、版本、运行、审批、Artifact 查看和进入 Creator；所有动作都有可解释反馈。

- 风险和回滚：先把单页工作台挂在新 route，保留原 Skills 页面作为 fallback；发布后通过 feature flag 灰度开启。

### SKL-P7-004：Skills Creator 单页编辑器

- 优先级：P1；类型：Creator UI；前置：SKL-P5-003、P7-002、P7-003；可并行：P7-005。
- 实现目标：在单页工作台中落地 Skills Creator，形成“元数据→SKILL.md→references/assets→capabilities→验证→预览→发布”的可视化流程。
- 功能范围：
  1. 左侧草稿树/步骤导航，中心 Markdown 编辑器，右侧 live preview/validation/capability risk。
  2. 支持新建、从已有 version fork、从 Legacy migration preview 创建 draft、autosave、revision conflict。
  3. 文件资产仅允许安全类型和大小；references/assets 可添加/删除/预览 metadata；不可上传可执行安装包绕过 reader。
  4. Validate 结果可定位到 field/file/line；Preview Run 显示 budget、requested capabilities 和预计 Artifact。
  5. Publish 弹窗显示不可变 version、source hash、capability 审批需求、默认 disabled 选项。
- 改动文件：
  - [NEW] src/renderer/pages/Skills/SkillCreatorWorkbench.tsx。
  - [NEW] src/renderer/pages/Skills/SkillCreatorEditor.tsx、SkillCreatorPreview.tsx、SkillCreatorValidationPanel.tsx、SkillCreatorPublishDialog.tsx。
  - [MODIFY] src/renderer/pages/Skills/index.tsx、skill-runtime.store.ts、skill-runtime.types.ts、src/renderer/api/index.ts。
  - [NEW] src/renderer/pages/Skills/SkillCreatorWorkbench.test.tsx、skill-creator.e2e.ts。
- 函数/API：
  - createDraft、saveDraft(expectedRevision)、validateDraft、previewDraft、publishDraft、discardDraft。
  - 编辑器必须通过 typed draft DTO；Markdown renderer 做 sanitize，不执行 HTML/script。
- 数据变更：无额外前端表；draftId/revision 由 server 管理。
- 边界和约束：
  - autosave debounce 不能覆盖服务端新 revision；网络失败要保留本地未提交提示。
  - 预览结果/错误不可自动发布；发布前强制显示 unsupported/required capability。
  - 不允许从浏览器写 server 任意路径；文件上传走受限 API。
- 测试和验证：编辑器输入、autosave、冲突恢复、validation line mapping、Markdown XSS、上传限制、preview/publish flow、键盘/ARIA。
- 验收证据：Creator 浏览器 E2E、draft/revision API 日志、publish 后 hash 和 version row、XSS 测试证明不执行 HTML。
- Done when：用户可在单页工作台内完成一个合法 Skill 的创建和发布；草稿、验证、预览、发布全链路可回放。
- 风险和回滚：先只开放本地草稿和 validate/preview；publish feature flag 关闭时按钮清楚说明，不影响现有导入。

### SKL-P7-005：Run Detail、Approval、Artifact 和功能展示闭环

- 优先级：P1；类型：UI 运行闭环；前置：P2-003、P6-001、P7-001、P7-002；可并行：P7-003、P7-004。
- 实现目标：补齐后台 Skills 管理中所有 Run 相关 UI：实时状态、事件、等待审批、等待输入、错误、Artifact、取消、重试和导出。
- 功能范围：
  1. Run Detail 抽屉/页面显示基本信息、version/source、状态时间线、预算、capability calls、event log、input/output summary。
  2. waiting_approval 展示 requested scope、grant scope、风险、审批/拒绝；waiting_input 展示安全表单。
  3. Artifact 面板显示类型、大小、hash、预览和导出按钮；image-reference 能跳转 Image Studio。
  4. 事件 stream 通过 SSE/afterSeq 合并，重复 event 不重复渲染；Run 完成后仍能刷新读取历史。
- 改动文件：
  - [MODIFY] src/renderer/pages/Skills/RunDetailDrawer.tsx、PackageDetailDrawer.tsx。
  - [NEW] src/renderer/pages/Skills/RunTimeline.tsx、RunEventStream.tsx、RunActionPanel.tsx、ArtifactList.tsx、CapabilityApprovalCard.tsx。
  - [MODIFY] src/renderer/pages/Skills/skill-runtime.store.ts、skill-runtime.types.ts、src/renderer/api/index.ts。
  - [NEW] src/renderer/pages/Skills/run-detail.e2e.ts、run-detail.test.tsx。
- 函数/API：
  - subscribeSkillRunEvents、loadEventsAfter、approveGrant、rejectGrant、submitRunInput、cancelRun、retryRun、exportArtifact。
  - UI command 必须传 server 返回的 expectedRevision 和唯一 idempotencyKey。
- 数据变更：无；本地只保存 lastSeq/selectedArtifactId。
- 边界和约束：
  - 事件 payload 脱敏由服务端负责，UI 仍需避免 innerHTML/危险 Markdown。
  - approval UI 不显示或复制 secret；拒绝 reason 长度/内容受限。
  - Run 已终态时动作按钮按 supportedActions 显示；不能依赖前端自行推断状态转换。
- 测试和验证：SSE duplicate/out-of-order、afterSeq、approval/deny/cancel/retry、Artifact preview/export、权限拒绝、刷新恢复、a11y。
- 验收证据：浏览器端完整操作录屏、事件 seq 和 UI 顺序一致、审批审计、Artifact 导出文件和 DB row 对照。
- Done when：管理员可从 Run Detail 完成所有被服务端声明的 next actions，并看到可验证的运行结果和产物；实时/刷新两种路径一致。
- 风险和回滚：SSE 故障回退轮询/afterSeq；动作不可用时仍展示原因，不隐藏 Run 事实。


### SKL-P8-001：安全加固、输入限制和供应链风险控制

- 优先级：P0；类型：安全/发布门禁；前置：P2、P3、P4、P7-001；可并行：P8-002。
- 实现目标：以“Package 文档不可信、能力默认拒绝、文件边界强制、导入可追溯”为原则完成 Skills Runtime 的安全收口。
- 功能范围：
  1. 输入安全：所有 zod schema、长度/数量/时间/深度限制、Unicode/路径规范化、错误脱敏、rate limit。
  2. 供应链安全：source allowlist、commit SHA、archive hash、manifest hash、rejected files、import review 和审计。
  3. 执行安全：禁止 Shell/Python/MCP/容器/子 Agent/任意 workspace write；Capability Broker 唯一入口；无 grant 默认 deny。
  4. 数据安全：secret 不入 DB/event/artifact；Artifact/Run/Package ownership；日志脱敏；备份和导出不泄漏敏感输入。
  5. 浏览器安全：Markdown/HTML sanitize、文件名和下载 header 安全、CSRF/CORS/Origin 策略、SSE 权限。
- 改动文件：
  - [MODIFY] src/server/skills/config/skill-runtime.config.ts、package-path-policy.ts、package-reader.ts、package-installer.ts。
  - [MODIFY] src/server/skills/policy/capability-policy.ts、capability-broker.ts。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts、skill-creator.ts、skills.ts。
  - [MODIFY] src/server/skills/runtime/skill-run-events.ts、artifact-store.ts。
  - [NEW] src/server/skills/security/skill-security-checklist.ts、security-audit.service.ts。
  - [NEW] tests/security/skills-runtime.security.test.ts、tests/security/skills-supply-chain.test.ts。
- 函数/API：
  - validateExternalSource、assertPackageLimits、sanitizeEventPayload、assertCapabilityAllowed、assertArtifactOwnership、auditSecurityDecision。
  - GET /api/v1/skill-security/status 仅返回管理员可见的检查摘要，不返回攻击细节/secret。
- 数据变更：skill_audit_events 增加 security_decision、policy_version、source_fingerprint、actor；可增加 security_findings_json 到 import review/version。
- 边界和约束：
  - 安全校验必须在 API、Application、低层 adapter 至少各有一层不可绕过的关键检查。
  - 不能以“trusted package”跳过 reader/manifest/capability policy；trusted 只可影响默认 UI 提示，不改变 server enforcement。
  - 生产默认关闭 npx import、GitHub private token、creator publish 和任意外部 URL。
- 测试和验证：SAST/依赖漏洞扫描、路径穿越/Zip Slip、SSRF host allowlist、XSS、secret redaction、权限矩阵、fuzz manifest/zip、拒绝 shell/python/mcp。
- 验收证据：安全测试报告、依赖扫描结果、红队 fixture 清单、审计查询样例、生产配置 diff。
- Done when：P0 安全项全部通过；未授权/不支持能力没有可执行绕过；导入来源和版本可追溯；发布门禁能阻止严重漏洞。
- 风险和回滚：安全策略只允许收紧；若误拦截合法输入，使用显式 allowlist/fixture 修复，不直接关闭 policy。发现严重漏洞立即关闭 Package execution 和 external import。

### SKL-P8-002：可观测性、指标和运维诊断

- 优先级：P1；类型：可观测性/运维；前置：P0-004、P1-002、P1-004、P7-001；可并行：P8-001。
- 实现目标：让每一次 import、grant、Run、capability call、Artifact export 都有可关联的日志、事件、指标和诊断信息。
- 功能范围：
  1. 统一 requestId、runId、skillVersionId、packageId、workerId、grantId、artifactId correlation fields。
  2. 指标：queue depth/lag、lease expired、run duration/status、retry/dead jobs、approval wait time、capability latency/error、artifact bytes、import reject reasons。
  3. 结构化日志分级，默认不记录 prompt/raw input/secret；生产可配置采样。
  4. 管理诊断页提供 runtime health、worker status、migration version、queue backlog、policy version、recent failures。
- 改动文件：
  - [NEW] src/server/skills/observability/skill-runtime.metrics.ts、skill-runtime.logger.ts、skill-runtime.diagnostics.ts。
  - [MODIFY] src/server/skills/runtime/skill-run-worker.ts、skill-run-queue.ts、skill-run-coordinator.ts。
  - [MODIFY] src/server/skills/packages/package-installer.ts、capability-broker.ts、artifact-store.ts。
  - [MODIFY] src/server/http/routes/skill-package-runtime.ts；必要时新增 diagnostics route。
  - [NEW] src/renderer/pages/Skills/SkillRuntimeDiagnostics.tsx、diagnostics.e2e.ts。
- 函数/API：
  - recordRunMetric、recordCapabilityMetric、withSkillCorrelation、getRuntimeDiagnostics。
  - GET /api/v1/skill-runtime/health、GET /api/v1/skill-runtime/diagnostics（管理员）。
- 数据变更：业务审计继续落库；高频 metrics 不强制落业务表，可接现有 telemetry sink。若无 telemetry，使用受限 rolling log，不以 DB 无限增长替代指标系统。
- 边界和约束：
  - metrics labels 不能使用原始 prompt、用户输入、任意 URL 或无限 cardinality 的文件名。
  - diagnostics 不泄露其他用户的 Run 内容；管理员权限和脱敏规则明确。
  - 事件 retention、日志 retention、metrics retention 分开配置。
- 测试和验证：correlation propagation、metric cardinality、secret redaction、worker crash diagnostics、health readiness/liveness、retention 测试。
- 验收证据：一条 Run 的 request→queue→worker→capability→artifact correlation 查询；diagnostics 页面截图；指标 dashboard/JSON 样例。
- Done when：出现卡死、慢、失败、权限拒绝时可以定位到 run/version/worker/原因；诊断不会泄露业务秘密。
- 风险和回滚：若 telemetry sink 不稳定，业务执行不能依赖指标写入；用 best-effort 异步记录，保留关键审计写入。

### SKL-P8-003：全链路测试、浏览器验收和发布门禁

- 优先级：P0；类型：测试/质量；前置：P7 全部、P8-001、P8-002；可并行：P8-004 的文档准备。
- 实现目标：形成从 package fixture、HTTP API、DB migration、Worker、Mastra、Capability、Artifact 到 Skills Center/Creator 浏览器的可重复验证矩阵。
- 功能范围：
  1. Unit：manifest/path/policy/state/event/repository/service/adapter/store。
  2. Integration：SQLite migration、inspect/install、queue/worker、grant/broker、Artifact、Image Studio、Mastra resolver。
  3. Contract：Legacy API、Package Runtime API、SSE/afterSeq、DTO/error code、migration compatibility。
  4. E2E：本地目录/ZIP inspect→install→enable→run→approve→artifact→export；GitHub fixture/mock；npx artifact import；Creator draft→validate→preview→publish；disable/rollback/delete。
  5. Failure injection：进程退出、网络超时、DB transaction failure、lease expiry、duplicate command、budget exhaustion、corrupted archive。
- 改动文件：
  - [NEW] tests/fixtures/skills/*（合法、边界、恶意 Package）。
  - [NEW] tests/integration/skill-runtime/*。
  - [NEW] tests/e2e/skills/*。
  - [MODIFY] package.json、测试配置、CI workflow 实际文件，加入 skills test projects 和 coverage threshold。
  - [NEW] docs/skills/evidence/README.md、evidence templates。
- 函数/API：
  - CI commands：lint、typecheck、unit、integration、e2e、security、migration compatibility；命令名应符合项目 package scripts，不能假设不存在的脚本。
  - 关键 fixture API：createTestPackage、createTestRun、fakeGitHubArchive、advanceClock、killWorker。
- 数据变更：测试每个 case 使用临时 DB/data root；不得复用开发数据库，不得把测试 secret 写入仓库。
- 边界和约束：
  - 测试必须可离线运行；GitHub/LLM/Image 通过 deterministic mock/adapter，不把公网稳定性作为 CI 前提。
  - E2E 不依赖真实用户目录或固定端口；运行后清理临时文件。
  - 任何新增 feature 未纳入测试矩阵不得标记 Done。
- 测试和验证：输出 JUnit/HTML/coverage、migration schema snapshot、browser trace/video、security scan、API contract snapshot；至少包含一条 crash recovery 和一条 ownership negative case。
- 验收证据：CI job links/logs、测试报告、浏览器 trace、DB/文件系统快照、发布门禁清单。
- Done when：所有 P0 测试通过；关键 happy path 和 negative path 可在干净环境重复；测试失败能够阻止合并/发布。
- 风险和回滚：E2E 不稳定时先隔离 flaky test 并修复 root cause，不降低安全/核心覆盖阈值；可按 feature flag 分阶段启用新路径。

### SKL-P8-004：发布、迁移、兼容和回滚 Runbook

- 优先级：P1；类型：发布运维/文档；前置：P0-002、P0-004、P5-002、P8-003；可并行：P8-001、P8-002。
- 实现目标：把 Skills Runtime 从开发功能变成可安全上线的分阶段交付，明确 migration、feature flag、观测、回滚和数据保留责任。
- 功能范围：
  1. 发布阶段：schema-only → inspect-only → install disabled → worker shadow/dry-run → Package run allowlist → general availability。
  2. 每阶段定义 entry criteria、metrics SLO、error budget、rollback trigger、owner。
  3. 记录旧 Legacy API compatibility、Package Runtime API version、manifest schema version、event schema version。
  4. 定义 backup/restore、migration forward-fix、orphan cleanup、Artifact retention、security incident response。
- 改动文件：
  - [NEW] docs/skills/003-skills-system-refactor-release-runbook-v1.1.md（如项目要求本计划单文件，可把内容并入本文附录）。
  - [NEW] docs/skills/evidence/release-checklist.md、rollback-checklist.md。
  - [MODIFY] src/server/skills/config/skill-runtime.config.ts、src/server/index.ts：阶段 flags/health readiness。
  - [MODIFY] CI/CD 实际配置文件：migration/check/backup/health gate。
- 函数/API：
  - getRuntimeHealth、getMigrationStatus、getFeatureGateStatus、runForwardFix、dryRunCleanup。
  - 运行手册必须列出所有 HTTP routes、migration ids、feature flags、日志/指标查询方式。
- 数据变更：发布前备份旧 DB；新表/字段可回滚只通过 forward-fix；Artifact/snapshot retention 与恢复策略记录。
- 边界和约束：
  - 应用版本回滚不能回滚已经执行的 destructive migration；数据库采用向前兼容设计。
  - 不在生产执行未经测试的手工 SQL；任何修复写 migration 并记录审批。
  - 回滚 Package execution 不删除已存在的 Run/Event/Artifact，只停止新 Run/Worker，并保持查询能力。
- 测试和验证：runbook dry-run、从旧版本升级、应用回滚但 DB 保持新 schema、worker stop/restart、备份恢复、feature flag stage test。
- 验收证据：完整发布 checklist、备份校验、health/metrics 截图、rollback 演练记录、owner 签字/审计记录。
- Done when：运维人员可以按文档独立完成发布、暂停、恢复和回滚；数据库、文件、队列、审计证据不会因为应用回滚丢失。
- 风险和回滚：每个阶段都保留上一阶段可运行路径；达到 rollback trigger 立即关闭新 Package run/import，保留只读查看和 Legacy 功能。

---

## 8. API 任务清单与契约要求

以下 API 是实现任务的合并验收清单。实际 path 以项目现有 prefix 为准，但 resource、错误和幂等语义不能在任务之间漂移。

### 8.1 Import / Package / Version

| API | 方法 | 责任任务 | 必须验证 |
|---|---|---|---|
| /api/v1/skill-packages/inspect | POST | P3-001~003 | source schema、size/path、diagnostics、fingerprint、无 DB side effect |
| /api/v1/skill-packages/install | POST | P3-003 | review/fingerprint 重校验、confirmation、事务、幂等 |
| /api/v1/skill-packages | GET | P4-001/P7-001 | pagination、ownership、runtime kind |
| /api/v1/skill-packages/:id/versions | GET | P5-001 | immutable version list、pagination |
| /api/v1/skill-versions/:id/diff | GET | P5-001 | version ownership、redacted diff |
| /api/v1/skill-packages/:id/update | POST | P5-001 | new version、current pointer 不隐式切换 |
| /api/v1/skill-installations/:id | PATCH/DELETE | P5-002 | enable/disable/uninstall、CAS |
| /api/v1/skill-installations/:id/rollback | POST | P5-001/P5-002 | runnable version、CAS、audit |

### 8.2 Run / Event / Command

| API | 方法 | 责任任务 | 必须验证 |
|---|---|---|---|
| /api/v1/skill-runs | POST/GET | P0-004/P1/P7-001 | create+queue transaction、pagination、filter |
| /api/v1/skill-runs/:id | GET | P1/P7-001 | ownership、revision、supportedActions |
| /api/v1/skill-runs/:id/events | GET | P1-002 | afterSeq、limit、脱敏、nextAfterSeq |
| /api/v1/skill-runs/:id/events/stream | GET | P1-002 | SSE、ownership、断线补偿 |
| /api/v1/skill-runs/:id/commands | POST | P1/P2/P7-001 | expectedRevision、idempotencyKey、合法 command |
| /api/v1/skill-runs/:id/cancel | POST | P1-004 | 幂等、cancel_requested、终态行为 |
| /api/v1/skill-runs/:id/capabilities | GET | P2-001 | requested/granted/pending/denied |
| /api/v1/skill-runs/:id/next-action | GET | P2-003 | waiting action、过期、ownership |

### 8.3 Grant / Artifact / Creator

| API | 方法 | 责任任务 | 必须验证 |
|---|---|---|---|
| /api/v1/skill-capability-grants/:id/approve | POST | P2-001 | actor、scope subset、audit |
| /api/v1/skill-capability-grants/:id/reject | POST | P2-001 | reason、幂等、Run waiting 收敛 |
| /api/v1/skill-capability-grants/:id/revoke | POST/DELETE | P2-001 | active grant 失效、已消费语义 |
| /api/v1/skill-runs/:id/artifacts | GET | P6-001 | ownership、pagination、metadata only |
| /api/v1/skill-artifacts/:id/content | GET | P6-001 | runId 双校验、mime/size |
| /api/v1/skill-artifacts/:id/export | POST | P4-003/P6-001 | destination allowlist、atomic、audit |
| /api/v1/skill-drafts | POST/GET | P5-003 | owner、revision、draft state |
| /api/v1/skill-drafts/:id | GET/PATCH/DELETE | P5-003 | CAS、ownership、discard |
| /api/v1/skill-drafts/:id/validate | POST | P5-003 | same parser/policy、diagnostics |
| /api/v1/skill-drafts/:id/preview | POST | P5-003 | queue/budget/Artifact、无自动发布 |
| /api/v1/skill-drafts/:id/publish | POST | P5-003 | immutable version、confirmation、audit |

### 8.4 API 通用规则

1. 所有 request body、query、path parameter 都在 route 边界 zod 校验。
2. 所有资源读取进行 owner/tenant/session context 校验；不接受客户端传 ownerId 作为权限依据。
3. 所有写操作返回 server canonical resource 和 revision；不要只返回 success=true。
4. 所有异步操作返回 runId/reviewId/draftId 或 operationId；不在 HTTP 请求中等待模型/图片长任务。
5. 错误响应形状固定为 error.code、error.message、error.details（details 只能是安全结构化字段）、requestId。
6. API 版本升级采用 additive/change version；禁止删除旧字段后让 renderer 猜测。

---

## 9. 数据库迁移任务清单

| Migration/数据工作 | 内容 | 对应任务 | 完成证据 |
|---|---|---|---|
| 001~006 审计 | 复核 core/events/artifacts/grants/grant-state/commands | P0-002 | schema snapshot 与源码一致 |
| 007 | queue、import reviews、audit 基础结构 | P0-002/P0-004/P3-003 | 空库/旧库增量通过 |
| 008 | drafts、snapshots、version diffs | P5-001/P5-003 | draft publish/immutable version 测试 |
| skill_runs_v2 | revision、required action、heartbeat、cancel/checkpoint | P1-001/P1-004/P2-003 | transition/recovery snapshot |
| skill_run_events | seq、schema version、producer、索引 | P1-002 | concurrent append/afterSeq |
| skill_run_queue | lease、attempt、backoff、active unique | P0-004 | crash/reclaim |
| capability grants | requested/granted/status/usage/lifecycle | P2-001/P2-002 | grant scope/usage tests |
| artifacts | kind/mime/hash/ownership/retention/export | P6-001 | content/export/cleanup |
| audit | import/grant/run/export/delete/security action | P8-001/P8-002 | audit query snapshots |

### 9.1 数据不变量验收

- SkillRun 只能引用存在的 immutable SkillVersion。
- active Installation 的 current_version_id 必须指向同一 package 的 runnable version。
- (run_id, seq) 和 (run_id, idempotency_key) 唯一。
- queue active lease 不允许同一个 runId 多个 owner。
- grant granted scope 是 requested scope 子集；calls_used 不超过 max_calls。
- Artifact run_id ownership 和文件 sha256/size/mime 一致。
- soft delete 对 Run/Event/Artifact 只读可追溯，不破坏审计。
- 所有 UTC 时间列和 revision 在 DB/DTO/renderer 中约定一致。

---


---

## 10. 测试矩阵

| 层级 | 目标 | 关键用例 | 主要文件/工具 | 通过门槛 |
|---|---|---|---|---|
| 静态类型 | 防止 Port/DTO/错误码漂移 | TypeScript strict、无循环依赖、无 runtime 直接 DB import | src/server/skills、src/renderer、tsconfig、lint | typecheck/lint 全通过 |
| Domain unit | 验证规则与状态机 | transition matrix、scope subset、version immutable、path policy、manifest canonical hash | skill-run-state-machine、capability-policy、manifest-resolver、skill-version.diff | P0 行为 100% 覆盖 |
| Repository contract | 验证 SQLite adapter | CAS、分页、唯一约束、事务回滚、queue lease、event seq | skill-package.repo、migrations、contract test | fake 与真实 adapter 结果一致 |
| Service unit | 验证应用编排 | inspect/install、grant、lifecycle、draft、error mapping | application services | 所有分支和错误码有断言 |
| Worker integration | 验证 durable execution | enqueue→claim→execute→event→artifact→terminal、retry、crash recovery | queue/worker/coordinator/adapter | 重启后不丢 Run、不重复 active lease |
| Capability integration | 验证唯一执行入口 | broker、grant、tool disabled、timeout、budget、image adapter | capability-broker、image adapter、Mastra tools | 禁止能力始终拒绝 |
| API contract | 验证对外协议 | DTO/error/pagination/idempotency/revision/SSE | http routes、apiFetch | Legacy API 无 breaking change |
| Renderer unit | 验证状态和交互 | store reconcile、afterSeq、conflict、empty/error/loading | skill-runtime.store、components | 无 stale update/重复事件 |
| Browser E2E | 验证用户主链路 | import/install/run/approve/artifact/export、Creator publish、rollback | Skills Center、Creator、Run Detail | 关键路径有 trace/video |
| Security | 验证不能越权/逃逸 | Zip Slip、symlink、SSRF、XSS、secret redaction、cross-run access | security tests、fixtures | P0 安全用例全通过 |
| Migration compatibility | 验证数据库升级 | empty DB、current old DB、repeat、forward-fix、app rollback | db/migrations、runbook | 旧 Legacy 功能不回归 |
| Performance | 验证预算和资源 | queue throughput、event volume、large archive reject、Artifact streaming | performance tests/metrics | 达到 release baseline，不能超硬上限 |

### 10.1 必须保留的最小测试 fixture

1. minimal-valid-skill：只有 SKILL.md，零 capability，生成一个 markdown Artifact。
2. references-and-assets：包含有限大小的 references 和允许的 asset metadata。
3. capability-approval-skill：声明 web.search/image.generate，默认进入 waiting_approval。
4. unsupported-capability-skill：声明 shell/python/mcp，inspect 能展示并 install/run 拒绝。
5. malicious-path-package：包含 ..、绝对路径、symlink、盘符路径、过长路径。
6. npx-artifact-package：包含 .skills 布局、package.json、node_modules 和 scripts，验证 ignored/rejected。
7. github-archive-package：mock commit API/archive response，验证 SHA 和 archive hash。
8. invalid-manifest-package：frontmatter 类型错误、缺失 name/version、重复文件、超限内容。
9. failing-runtime-skill：模拟 tool timeout、budget exhaustion、worker crash、DB transaction failure。
10. image-skill：mock generation result，验证 grant consumption、session link 和 image-reference Artifact。

---

## 11. 验收证据模板

每个 SKL 任务完成时必须在 PR 或任务记录中附以下证据，不能只写“已实现”。

~~~text
Task ID: SKL-Px-xxx
实现分支/commit:
涉及文件:
数据库 migration:
API/DTO 变更:
测试命令:
测试结果:
关键日志/trace:
DB 快照或 schema 证据:
文件系统快照（如适用）:
浏览器截图/录屏（如适用）:
安全负例证据:
兼容性证据:
风险与回滚演练:
Done when 对照:
Reviewer:

~~~

### 11.1 Run 端到端证据最低要求

- requestId、runId、skillVersionId、workerId、grantId、artifactId 可串联。
- DB 中 Run revision、queue lease、event seq、grant calls_used、Artifact hash 前后可对照。
- 至少一条 happy path 和两条 negative path（无授权、路径越界/超预算）有 HTTP 与 UI 证据。
- 进程中止后重新启动，Run 进入 interrupted/recovery 并最终完成或明确失败。
- 刷新浏览器后，Run Detail 通过 afterSeq/历史 API 恢复，不依赖内存状态。

### 11.2 Creator 端到端证据最低要求

- 草稿 revision 从 1 递增；并发保存冲突不会覆盖服务端新内容。
- validate 能显示错误位置和 capability 风险；preview 不会自动 publish。
- publish 后 skill_version 的 canonical hash、snapshot hash、manifest hash 固定。
- 发布后再次编辑只修改 draft，不改变已发布 version；删除/回滚受引用保护。

---

## 12. Definition of Done（DoD）

### 12.1 单任务 DoD

一个任务只有同时满足以下条件才能标记 Done：

1. 目标文件和函数已经实现，未实现的文件被明确标记为后续任务而不是留在隐式 TODO。
2. 相关 API、DB、事件、前端类型或 UI 变更形成闭环；不能只实现一个孤立 service。
3. 正向用例、至少一个边界用例、至少一个安全/权限负例有自动化验证。
4. 测试使用临时数据库和 data root，运行后无残留；生产数据不被测试污染。
5. 日志、错误码和审计证据足以定位失败，不泄漏 secret、完整 prompt 或任意本地路径。
6. API/数据变更已经加入兼容策略、migration 和 rollback 说明。
7. 验收证据模板完整，代码 reviewer 能从文件和测试复现结论。

### 12.2 Phase DoD

- P0：migration、queue、state machine、event、worker、capability deny baseline 可以在干净环境运行。
- P1：Package import、执行、恢复、Artifact、Mastra adapter 和 Legacy coexistence 可用。
- P2：grant/approval/budget/waiting 具备完整 API、事件和 UI contract。
- P3：版本、rollback、Creator domain 和 Image/Chat integration 可用。
- P4：Skills Center/Creator/Run Detail、security、observability、E2E 和 runbook 达到发布门槛。

### 12.3 Release DoD

- P0 安全测试全通过；无未决 critical/high 风险。
- 空库和当前生产旧库 migration rehearsal 成功；有可验证 backup。
- Legacy API/页面回归通过；Package feature flags 可独立关闭。
- 关键 E2E 和 crash recovery 可重复；CI 门禁已配置。
- 监控、诊断、告警、回滚联系人和 runbook 已确认。

---

## 13. 推荐执行顺序与并行安排

### 13.1 关键路径

1. P0-001/P0-002/P0-003：先固化配置、迁移和 port。
2. P0-004：Queue/Worker 组合根。
3. P1-001/P1-002：Run 状态和事件协议。
4. P1-003/P1-004：真实执行与恢复。
5. P2-001/P2-002/P2-003：授权和 waiting。
6. P3-001/P3-002/P3-003：静态包导入安全闭环。
7. P4-001/P4-002/P4-003：Domain facade、Mastra、workspace。
8. P5/P6：版本生命周期、Creator domain、Artifact、Image/Chat。
9. P7：API、renderer、Skills Center、Creator UI、Run Detail。
10. P8：安全收口、观测、E2E、发布。

### 13.2 可并行工作流

- 后端基础线：P0-001、P0-002、P0-003 可并行，P0-004 等待 ports/schema contract。
- Runtime 线：P1-001/P1-002 可并行；P1-003 等待 coordinator port，但 adapter fixture 可先写。
- Import 线：P3-001、P3-002、P3-004、P3-005 可按文件写集并行；P3-003 负责整合。
- UI 线：P7-002 可以用 mock API 与 P7-001 并行；P7-003/P7-004/P7-005 共享 typed store 后并行。
- 质量线：测试 fixture、安全负例、Runbook 可提前开始，但只有在真实实现接入后才完成验收。

### 13.3 不应并行的工作

- 不应在 queue/Coordinator 状态机未确定前同时修改多个 HTTP route 的状态语义。
- 不应在 capability policy 未冻结前把 Package Skill 直挂全局 Mastra tools。
- 不应在 version immutable contract 未完成前实现自动 update/rollback UI。
- 不应在 artifact ownership 未完成前开放文件内容预览/导出。
- 不应在 schema migration 未通过旧库 rehearsal 前上线 Worker。

---

## 14. 待决策项和默认决策

| 决策项 | 默认决策 | 需要确认的时点 |
|---|---|---|
| 多租户/用户 ownership 模型 | 沿用现有 session/user context，新增表预留 owner_id | P0-003 前 |
| API pagination | 先使用 limit/offset，后续高频 event 使用 afterSeq/cursor | P7-001 前 |
| Queue 实现 | SQLite durable queue + lease，不引入外部 Redis | P0-004 前 |
| Worker 数量 | 单进程多 worker，配置化 concurrency | P0-001/P0-004 |
| Package execution model | Run-scoped InstructionAgentAdapter + Mastra runtime | P1-003/P4-002 |
| npx skills | 只导入外部生成的静态产物，不在 BloomAI 执行 npx | P3-005 |
| GitHub 认证 | 首期 public repository + commit SHA；私有仓库后置 | P3-004 |
| Python/Shell/MCP | 首期不支持、不可申请 grant | P1/P2 安全门禁 |
| Workspace write | 首期只读 project context，写入 Artifact 后显式导出 | P4-003 |
| Creator publish | 生成 immutable version，默认 disabled；发布不自动授权 | P5-003 |
| SSE vs polling | SSE + afterSeq 补偿，polling 作为降级路径 | P1-002/P7-002 |
| 物理删除 | 默认 soft delete + retention cleanup | P5-002/P8-004 |
| Mastra 依赖边界 | Mastra 负责 agent/tool orchestration，不负责 control plane | P4-002 |
| 旧 Legacy 迁移 | 并存；显式 migration preview，不自动转换 | P4-004 |

如果这些决策发生变化，应新增 ADR，而不是在单个任务中悄悄改变 contract。

---

## 15. 与 001 分析文档的对应关系

| 001 分析结论 | 本实施计划落地任务 | 交付物 |
|---|---|---|
| 三层架构：Control Plane / Mastra Runtime / Capability & Execution | P0-003、P1-003、P2-002、P4-002 | Port、Worker、MastraSkillSource、Broker |
| durable Run、queue、Worker、恢复 | P0-004、P1-001、P1-004 | queue 表、lease、state machine、recovery |
| Event / Artifact / Audit | P1-002、P6-001、P8-001/P8-002 | event protocol、Artifact Store、audit/metrics |
| SKILL.md、references、只读 assets | P1-003、P3-001、P3-002 | Manifest/Reader/InstructionAdapter |
| 本地目录、ZIP、GitHub Archive | P3-003、P3-004 | inspect/install/reproducibility |
| npx skills 产物 | P3-005 | static artifact detector、no command execution |
| Capability Broker、grant、approval | P2-001~003 | requested/granted/waiting/command |
| Legacy 与 Package 并存 | P4-001、P4-004 | facade、adapter、旧 API 保持 |
| 不直接用 Mastra 替换 BloomAI Skills | P4-002 | Mastra adapter，不接管 control plane |
| 版本、更新、rollback、删除 | P5-001、P5-002 | immutable version/lifecycle |
| Skills Creator | P5-003、P7-004 | Draft domain、单页 Creator |
| Image Studio/Article Illustration | P6-002 | image capability adapter/artifact link |
| Chat 集成 | P6-003 | durable Run card/skill launcher |
| 单页工作台和功能展示 | P7-003、P7-005 | Skills Center/Run Detail |
| 安全、观测、E2E、发布 | P8-001~004 | release gate/runbook |

---

## 16. 最终文件架构验收清单

### 16.1 目标后端目录

~~~text
src/server/skills/
├─ config/
│  └─ skill-runtime.config.ts
├─ application/
│  ├─ ports.ts
│  ├─ errors.ts
│  ├─ skills-facade.service.ts
│  ├─ capability-grant.service.ts
│  ├─ skill-version.service.ts
│  ├─ skill-lifecycle.service.ts
│  └─ chat-skill-launcher.ts
├─ runtime/
│  ├─ skill-run-state-machine.ts
│  ├─ skill-run-coordinator.ts
│  ├─ skill-run-events.ts
│  ├─ skill-run-event-registry.ts
│  ├─ skill-run-queue.ts
│  ├─ skill-run-worker.ts
│  ├─ skill-runtime.composition-root.ts
│  └─ skill-execution-context.ts
├─ packages/
│  ├─ manifest-schema.ts
│  ├─ manifest-resolver.ts
│  ├─ package-reader.ts
│  ├─ package-path-policy.ts
│  ├─ package-installer.ts
│  ├─ package-install-review.service.ts
│  ├─ github-source.ts
│  ├─ npx-artifact-detector.ts
│  └─ fixtures/
├─ policy/
│  ├─ capability-policy.ts
│  └─ capability-broker.ts
├─ creator/
│  ├─ skill-draft.schema.ts
│  ├─ skill-draft.service.ts
│  └─ legacy-to-draft.service.ts
├─ artifacts/
│  ├─ artifact-policy.ts
│  └─ artifact-store.ts
├─ filesystem/
│  └─ skill-path-policy.ts
├─ adapters/
│  ├─ instruction-agent-adapter.ts
│  └─ image-studio-capability-adapter.ts
├─ observability/
│  ├─ skill-runtime.metrics.ts
│  ├─ skill-runtime.logger.ts
│  └─ skill-runtime.diagnostics.ts
└─ security/
   ├─ skill-security-checklist.ts
   └─ security-audit.service.ts

src/server/mastra/skills/
├─ mastra-skill-source.ts
└─ mastra-skill-source.test.ts

src/server/http/routes/
├─ skills.ts
├─ skill-package-runtime.ts
└─ skill-creator.ts

src/server/db/
├─ migrations.ts
├─ client.ts
├─ schema.ts
├─ schema-contract.ts
└─ repositories/
   ├─ skill.repo.ts
   └─ skill-package.repo.ts
~~~

### 16.2 目标前端目录

~~~text
src/renderer/pages/Skills/
├─ index.tsx
├─ SkillsCenterWorkbench.tsx
├─ SkillsSidebar.tsx
├─ SkillOverviewPanel.tsx
├─ SkillVersionPanel.tsx
├─ SkillCapabilityPanel.tsx
├─ SkillArtifactPanel.tsx
├─ SkillCreatorWorkbench.tsx
├─ SkillCreatorEditor.tsx
├─ SkillCreatorPreview.tsx
├─ SkillCreatorValidationPanel.tsx
├─ SkillCreatorPublishDialog.tsx
├─ RunDetailDrawer.tsx
├─ RunTimeline.tsx
├─ RunEventStream.tsx
├─ RunActionPanel.tsx
├─ ArtifactList.tsx
├─ CapabilityApprovalCard.tsx
├─ PackageInstallDialog.tsx
├─ PackageDetailDrawer.tsx
├─ skills.store.ts
├─ skill-runtime.store.ts
├─ skill-runtime.types.ts
└─ tests/

src/renderer/api/
└─ index.ts
~~~

### 16.3 文件架构验收规则

1. Domain/Application 不 import renderer、Hono Context、Drizzle row type 或 Mastra singleton。
2. Runtime adapter 不直接 import HTTP route；HTTP route 只依赖 service/facade。
3. Package import/read/write 只能经 packages/filesystem/artifacts policy；禁止散落 fs path logic。
4. 所有新增 route 有独立 schema/error/contract test。
5. 所有新增表有 migration + schema.ts + repository contract test。
6. 所有新增前端页面有 typed API + store + loading/error/empty state + browser test。
7. 每个 P0 任务在文档中有唯一任务号、文件列表、Done when 和验收证据。

---

## 17. 最终结论

本计划不把 Mastra Skills 直接替换 BloomAI Skills，而是按 001 分析文档建立清晰的职责分工：BloomAI 负责安装、版本、权限、Run、队列、审计、Artifact、UI 和生命周期；Mastra 负责 Agent/模型运行时与工具编排；Capability Broker 负责唯一的能力执行入口。这样既能复用 Mastra 的执行能力，又不会把 BloomAI 的控制面、数据边界和安全责任交给一个外部运行时。

实施时应优先完成 P0 的迁移、Port、durable queue、状态机、事件和 Worker，再推进 capability/grant、Package import、Mastra adapter、version/Creator、UI 和发布。每个任务按本文件的“文件→函数/API→数据→边界→测试→证据→Done when”执行，任何跨任务的协议变更都通过 ADR 或本计划版本更新记录。

推荐的首个可交付里程碑为：

- 可导入一个最小本地 SKILL.md Package；
- inspect/install 形成 immutable SkillVersion；
- POST /skill-runs 进入 durable queue；
- Worker 通过 InstructionAgentAdapter 执行并写 Run Event/Artifact；
- 不支持能力和无 grant 能被稳定拒绝；
- Skills Center 能查看 Run、事件和 Artifact；
- 进程重启后 Run 能恢复或明确失败；
- Legacy Skill 和现有 Chat/Image Studio 功能不回归。

该里程碑完成后，再开启 GitHub Archive、npx artifact、Creator publish、Image capability、Chat launch 和完整版本生命周期。

---

文档版本：v1.1
计划编号：002
对应分析文档：docs/skills/001-skills-system-refactor-analysis-v1.1.md
