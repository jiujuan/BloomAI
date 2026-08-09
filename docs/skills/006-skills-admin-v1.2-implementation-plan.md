# BloomAI Skills 后台 v1.2 实施任务计划

> **文档编号：** 006-skills-admin-v1.2-implementation-plan  
> **版本：** v1.2  
> **状态：** Ready for implementation review  
> **编写日期：** 2026-08-07  
> **适用项目：** `D:\codeproject\JS\bloomai`  
> **设计基线：** `docs/skills/skill-admin-system-v1.2-design.md`  
> **交互原型：** `docs/skills/ui/skill-management-console-v1.2.html`  
> **历史参考：** `docs/skills/002-skills-system-refactor-implementation-plan-v1.1.md`

---

## 0. 文档说明与执行规则

### 0.1 目的

本计划用于把 v1.2 设计规格和独立 HTML 原型落地为可运行、可审计、可测试的 Skills 后台。目标不是继续扩展旧的 Skills 页面，而是形成以 **Package Skill / Skill Version / Installation / Run / Capability Grant / Artifact** 为核心对象的统一管理闭环。

本计划覆盖：

- 后端领域服务、Repository、HTTP API、数据库和运行时；
- Renderer API、状态管理和 Skills 管理页面；
- Skills Center、Import、Creator、Detail、Permissions、Runs、Artifacts、Settings 九个视图；
- v1.2 原型中的状态颜色、图标、行内操作和无“Skill 操作”菜单弹窗交互；
- Legacy Skills 用户界面、路由、Repository、运行入口、迁移代码和测试的清理；
- 单元、集成、安全、浏览器 E2E、迁移、可访问性和发布验证。

### 0.2 执行原则

1. **先契约、后实现。** 先冻结状态机、错误码、权限边界、分页、幂等和数据库不变量，再并行开发服务与页面。
2. **Package Runtime 是唯一现行管理面。** v1.2 不再把 Legacy Skill 当作可管理、可安装或可运行的 Skill 类型。
3. **导入和执行分离。** 导入必须经过 inspect、风险检查和必要审批；未经安装和权限收敛的包不能直接执行。
4. **危险操作显式化。** 禁用、卸载、撤销权限、取消 Run、导出 Artifact 等操作必须有明确动作名、权限检查、审计记录和必要的二次确认。
5. **状态不能只依赖颜色。** 所有状态同时使用文字、语义图标和颜色；列表、详情、Toast、Timeline 和设置页使用同一状态矩阵。
6. **删除 Legacy 前先完成数据与调用方证据。** 删除旧代码前必须完成调用方扫描、数据盘点、备份、迁移验证和回滚演练。
7. **保持 v1.1 可追溯。** 不覆盖 v1.1 设计和实施计划；v1.2 以新增计划和源码变更记录承接历史。

### 0.3 任务状态和证据

每项任务使用以下状态：

- `TODO`：尚未开始；
- `DOING`：正在实现；
- `BLOCKED`：存在明确外部依赖或待决策项；
- `REVIEW`：代码完成，等待评审或测试；
- `DONE`：代码、测试、文档和证据均已完成。

每项任务完成时至少保留：

- 修改文件清单；
- 迁移或 API 契约变更说明；
- 自动化测试结果；
- 必要时的 HTTP、数据库、浏览器截图或日志证据；
- 风险、兼容性和回滚说明。

---

## 1. v1.2 目标、范围与非目标

### 1.1 版本目标

| 目标 | 可验证结果 |
|---|---|
| 统一 Catalog | Skills Center 只展示 Package Skill，并能按名称、来源、状态、版本和安装状态查询。 |
| 完成管理闭环 | 导入 → inspect → 审批 → 安装 → 启用/禁用 → 更新/切换版本/回滚 → 运行 → 查看 Artifact → 卸载可闭环。 |
| 完成 Creator 闭环 | Draft 创建、编辑、校验、预览、Capability 声明、发布和发布后的 Detail 跳转可用。 |
| 完成运行审计 | Run、Event、Capability、Artifact 和 Activity 有稳定关联，支持 Timeline、SSE、命令和审计追踪。 |
| 统一安全边界 | Capability Broker 是高风险能力的唯一执行入口；安装、审批、运行和导出均进行权限、来源和范围校验。 |
| 对齐 v1.2 UI | 页面使用 BloomAI 暖灰/白色/紫蓝品牌配色、状态图标、Tooltip、键盘 Focus 和响应式布局。 |
| 清理 Legacy | 产品界面不再展示 Legacy，不允许新建、安装、启用、更新或运行 Legacy；旧数据只按迁移/审计策略处理。 |

### 1.2 本期范围

1. Package Manifest、Version、source reproducibility 和文件快照；
2. GitHub、本地目录、ZIP、npx 产物的导入检查和安装流程；
3. Installation 生命周期和版本切换；
4. Capability 请求、审批、撤销、预算和有效期；
5. Run 状态机、Worker、Event、SSE、取消、重试和恢复；
6. Artifact ownership、预览、内容读取、下载/导出和来源追溯；
7. Skills Creator Draft、Validate、Preview、Publish；
8. 九个后台视图和内联行操作；
9. 数据库迁移、索引、不变量和回滚；
10. 安全、审计、指标、诊断和发布门禁。

### 1.3 非目标

以下内容不属于 v1.2 的新增目标：

- 不恢复或继续扩展 Legacy Skills 管理页面；
- 不为旧 `js-function`、`http-api`、`prompt-template` 类型增加新运行能力；
- 不在 Skills Center 行操作中恢复三点菜单或“Skill 操作”弹窗；
- 不把原型静态数据直接视为生产数据；
- 不在本计划内重写 BloomAI 全局设计系统；只抽取并复用现有 renderer token；
- 不在没有安全审查的情况下开放任意文件系统、网络、Shell 或模型能力；
- 不把一次性 Legacy 数据迁移做成长期用户可见的管理功能。

---

## 2. 设计基线与当前源码基线

### 2.1 设计和原型映射

| 设计对象 | v1.2 设计要求 | 实现目标 |
|---|---|---|
| Skills Center | Catalog、指标、最近运行、待处理事项 | Package 列表、筛选、分页、状态和四个直接操作图标 |
| 导入 Skill | GitHub、本地、ZIP、npx、检查和审批 | inspect、review、approve/reject、install |
| Skills Creator | Draft、Runtime、Capability、实时预览 | Draft Store、编辑器、校验、发布 |
| Skill 详情 | Package、Version、Files、Capabilities、Runs、History | Detail Drawer/Page 和上下文链路 |
| 权限与安装 | Installation、Grant、审批队列 | enable/disable、switch、rollback、grant 审批 |
| 运行记录 | Run 查询、筛选、Timeline、命令 | Run 列表、Detail、Event stream、cancel/retry |
| Artifacts | 预览、来源、下载/导出 | Artifact list/detail/content/export |
| 系统设置 | Runtime、Import/Security、Artifact、Feature Flags | health、diagnostics、配置和开关 |
| 行内操作 | 查看、启用/禁用、创建版本、卸载 | 图标直接显示，hover/focus 显示文字说明，不使用三点菜单 |

### 2.2 已存在的 Package Runtime 基础

当前代码已经存在可复用的 Package Runtime 基础，不应重新设计一套并行 API：

- 后端路由：
  - `src/server/http/routes/skill-package-runtime.ts`
  - `src/server/http/routes/skill-creator.ts`
  - `src/server/http/routes/skill-runtime-observability.ts`
- 后端服务：
  - `src/server/services/skill-package-runtime.service.ts`
  - `src/server/services/skill.service.ts`
- Skills 领域目录：
  - `src/server/skills/config/`
  - `src/server/skills/packages/`
  - `src/server/skills/policy/`
  - `src/server/skills/runtime/`
  - `src/server/skills/artifacts/`
  - `src/server/skills/creator/`
  - `src/server/skills/observability/`
  - `src/server/skills/security/`
- 数据访问：
  - `src/server/db/repositories/skill-package.repo.ts`
  - `src/server/db/repositories/skill.repo.ts`
  - `src/server/db/schema.ts`
  - `src/server/db/migrations.ts`
- Renderer：
  - `src/renderer/api/index.ts`
  - `src/renderer/pages/Skills/skill-runtime.types.ts`
  - `src/renderer/pages/Skills/skill-runtime.store.ts`
  - `src/renderer/pages/Skills/SkillsCenterWorkbench.tsx`
  - `src/renderer/pages/Skills/SkillCreatorWorkbench.tsx`
  - `src/renderer/pages/Skills/PackageDetailDrawer.tsx`
  - `src/renderer/pages/Skills/RunDetailDrawer.tsx`
  - `src/renderer/pages/Skills/SkillRuntimeDiagnostics.tsx`

实现时应优先补齐上述现有能力的契约、权限、错误处理和 UI 闭环，避免重复实现同名服务。

### 2.3 当前源码中发现的 Legacy 遗留入口

尽管产品要求已经删除 Legacy Skills，但当前基线扫描仍发现以下遗留引用，必须作为 v1.2 的显式清理任务，而不能假设它们已经不存在：

| 区域 | 当前遗留入口 | v1.2 处理 |
|---|---|---|
| App 入口 | `src/renderer/App.tsx` 中 `LegacySkillsMarket` import 和 Feature Flag 分支 | 统一进入 `SkillsCenterWorkbench`，删除 Legacy 分支和无效开关依赖。 |
| Skills 页面 | `src/renderer/pages/Skills/index.tsx` 中 Legacy Skills、Create Legacy Skill、legacy market/installed/run | 删除 Legacy Tab、卡片、安装/卸载/创建逻辑，仅保留 Package Runtime。 |
| Workbench | `SkillsCenterWorkbench.tsx` 中 `legacySkills`、`kind: 'legacy'`、Legacy source/runtime | 删除参数、类型分支、转换函数和旧展示。 |
| Store | `skills.store.ts` 中 Legacy 转换、market、installed、uninstall | 删除旧 store 或拆分为只含 Package Runtime 的 store。 |
| Repository | `src/server/db/repositories/skill.repo.ts` 中 `LegacySkillRepository`、`legacySkillRepo`、旧 `skills`/`skill_runs` 读写 | 迁移到 Package Repository；旧读写仅在离线迁移阶段可存在。 |
| Server Legacy 目录 | `src/server/skills/legacy/` | 停止编译和运行时引用，数据迁移验证后删除。 |
| Adapter/Creator | `creator/legacy-to-draft.service.ts` | 不作为用户功能保留；如迁移仍需要，移动到一次性离线迁移边界。 |
| Migration | `src/server/skills/migration/`、`routes/skill-migration.ts` | 取消用户可见管理入口；未完成迁移前保留受保护的一次性工具，完成后删除。 |
| 旧路由 | `src/server/http/routes/skills.ts` 的旧 market/install/run/update 接口 | Package 路由完成替代后取消注册；过渡期若必须兼容，返回明确弃用/410 错误并记录调用方。 |
| 测试和 fixture | `tests/e2e/skills/legacy-skills-migration.browser.test.ts`、legacy fixture 和迁移安全测试 | 改为离线迁移验证或在迁移结束后删除，不能继续作为后台功能测试。 |

### 2.4 当前 Package Runtime 路由基线

以下路由应作为 v1.2 API 评审的起点，优先复用并补齐权限、分页、错误和审计：

```text
GET    /skill-runtime/capabilities
POST   /skill-packages/inspect
POST   /skill-packages/install
GET    /skill-import-reviews/:id
POST   /skill-import-reviews/:id/approve
POST   /skill-import-reviews/:id/reject
GET    /skill-packages
GET    /skill-installations
GET    /skill-packages/:id
GET    /skill-packages/:id/versions
GET    /skill-versions/:id
GET    /skill-versions/:id/diff
POST   /skill-packages/:id/update/preview
POST   /skill-packages/:id/update
PATCH  /skill-installations/:id
POST   /skill-installations/:id/switch-version
POST   /skill-installations/:id/rollback
DELETE /skill-installations/:id
DELETE /skill-packages/:id
DELETE /skill-capability-grants/:id
POST   /skill-capability-grants/:id/approve
POST   /skill-capability-grants/:id/reject
POST   /skill-capability-grants/:id/revoke
POST   /skill-runs
GET    /skill-runs
GET    /skill-runs/:id/next-action
GET    /skill-runs/:id
GET    /skill-runs/:id/capabilities
GET    /skill-runs/:id/events
GET    /skill-runs/:id/stream
POST   /skill-runs/:id/commands
POST   /skill-runs/:id/cancel
GET    /skill-runs/:id/artifacts
GET    /skill-artifacts/:id/content
POST   /skill-artifacts/:id/export
GET    /skill-runtime/health
GET    /skill-runtime/diagnostics
POST   /skill-drafts
GET    /skill-drafts/:id
PATCH  /skill-drafts/:id
DELETE /skill-drafts/:id
POST   /skill-drafts/:id/validate
POST   /skill-drafts/:id/preview
POST   /skill-drafts/:id/publish
```

---

## 3. 目标架构和边界

### 3.1 目标分层

```text
Renderer / Skills Admin UI
        │  typed API client + Runtime Store
        ▼
HTTP Routes / DTO / Auth / Error Mapping
        ▼
Application Services
  Import · Catalog · Installation · Grant · Run · Artifact · Creator · Settings
        ▼
Domain Services
  Manifest · Package Reader · Policy · State Machine · Queue · Worker · Audit
        ▼
Repository Ports
        ▼
SQLite / File Store / Queue / Runtime Adapter
```

依赖规则：

- Renderer 不直接访问数据库、文件系统或运行时执行器；
- Route 只负责解析请求、调用应用服务、转换 DTO 和 HTTP 错误；
- Application Service 负责授权、幂等、事务编排和审计；
- Domain Service 负责不变量、状态转移、安全策略和可重试语义；
- Repository 负责持久化，不向 Renderer 暴露数据库字段命名；
- Capability Broker 是网络、文件、Shell、模型等高风险能力的唯一执行入口；
- Worker 只能消费已持久化、已授权、未过期且版本固定的 Run。

### 3.2 关键运行链路

#### 导入链路

```text
source input
  → source normalize
  → safe reader / path budget
  → manifest resolve
  → capability / security inspection
  → import review
  → approve / reject
  → package + immutable version snapshot
  → installation
```

#### 执行链路

```text
UI Start Run / Chat Start Run
  → authorize installation + capability grants
  → create Run and initial Event
  → enqueue durable job
  → worker claim with lease
  → Capability Broker executes calls
  → append ordered events
  → persist artifacts and audit
  → terminal state
```

#### 管理链路

```text
Skills Center
  → Skill Detail
  → Version / Capability / Run
  → Run Detail
  → Artifact / Grant / Audit
```

---

## 4. 领域对象、状态机和不变量

### 4.1 核心对象

| 对象 | 最低字段/语义 | v1.2 管理能力 |
|---|---|---|
| `SkillPackage` | id、name、description、source、repository、created/updated、deletedAt | Catalog、详情、归档/删除、版本入口 |
| `SkillVersion` | id、packageId、version、commit/digest、manifest、filesSnapshot、capabilities | 版本列表、Diff、发布、切换、回滚 |
| `SkillInstallation` | id、packageId、activeVersionId、status、enabled、installedAt、updatedAt | 启用/禁用、版本切换、回滚、卸载 |
| `ImportReview` | id、source、inspection、risk、requestedCapabilities、status、reviewer | 审批、拒绝、状态追踪 |
| `SkillDraft` | id、content、revision、validation、preview、status | 创建、编辑、验证、预览、发布/丢弃 |
| `CapabilityGrant` | id、installation/version、capability、scope、status、budget、expiresAt、actor | 审批、撤销、预算和有效期管理 |
| `SkillRun` | id、installation/version、status、revision、trigger、budget、timestamps | 查询、Detail、命令、取消、恢复、重试 |
| `SkillRunEvent` | runId、seq、type、payload、schemaVersion、createdAt | Timeline、SSE、审计和调试 |
| `SkillArtifact` | id、runId、kind、path/key、size、checksum、status、ownership | 列表、预览、内容读取、导出 |
| `AuditActivity` | actor、action、object、result、requestId、reason、createdAt | 追踪导入、审批、运行、权限和危险操作 |

### 4.2 状态统一规则

| 类型 | 状态 | UI 图标/语义色 | 允许的主要转移 |
|---|---|---|---|
| Installation | `active` | `check` / success | `disabled → active`、`pending → active` |
| Installation | `disabled` | `pause` / neutral | `active → disabled` |
| Installation | `pending` | `clock` / warning | `pending → active`、`pending → rejected` |
| Installation | `quarantined` | `info` / danger | 只能人工复核或删除 |
| ImportReview | `scanning` | `activity` / info | `scanning → validated/warning/rejected` |
| ImportReview | `validated` | `check` / success | `validated → approved/rejected` |
| ImportReview | `warning` | `clock` / warning | `warning → approved/rejected` |
| ImportReview | `rejected` | `info` / danger | 终态，允许重新导入 |
| Grant | `pending` | `lock`/`clock` / warning | `pending → active/rejected` |
| Grant | `active` | `shield`/`check` / success | `active → revoked/expired` |
| Grant | `revoked` | `pause` / danger | 终态 |
| Run | `queued` | `clock` / info | `queued → running/cancelled` |
| Run | `running` | `play`/`activity` / info | `running → waiting/completed/failed/cancelled` |
| Run | `waiting_approval` | `lock`/`clock` / warning | `waiting → running/cancelled/failed` |
| Run | `succeeded` | `check` / success | 终态 |
| Run | `failed` | `info` / danger | 可通过 Retry 创建新 Run，不直接改写历史 Run |
| Run | `cancelled` | `pause` / neutral | 终态 |
| Artifact | `processing` | `activity` / info | `processing → ready/orphaned/failed` |
| Artifact | `ready` | `file`/`check` / success | 允许预览和导出 |
| Artifact | `orphaned` | `info` / warning | 只读和清理，不可冒充可用产物 |

### 4.3 必须保持的不变量

1. 每个 Run 必须绑定一个不可变的 `SkillVersion`，不能执行浮动 branch 内容。
2. 每个 Installation 的 active version 必须属于对应 Package，且版本快照可验证。
3. 被禁用或卸载的 Installation 不能创建新的可执行 Run；历史 Run 仍可审计查看。
4. 未经允许的 Capability Grant 不能进入 Broker；过期、撤销或超预算的 grant 必须被拒绝。
5. Run Event 的 `seq` 在同一 Run 内单调递增；重试或重复投递不能产生重复语义事件。
6. Artifact 必须能追溯到 Run、Skill Version 和生成步骤；导出必须通过 ownership 和路径策略校验。
7. 失败、取消、拒绝等终态不可被普通 PATCH 直接覆盖；只能由明确命令或补偿流程推进。
8. 所有危险操作都必须带 actor、requestId、reason（适用时）和结果审计。
9. v1.2 现行 Catalog 不接收 `legacy` 类型；不存在 `Legacy Runtime`、Legacy Installation 或 Legacy Run 的新建入口。

---

## 5. Legacy Skills 清理策略

### 5.1 最终产品策略

v1.2 的最终产品边界如下：

- Skills Center、导入、Creator、详情、权限、Runs、Artifacts 和 Settings 都只面向 Package Runtime；
- 不显示 Legacy Skill、Legacy Runtime、Legacy Market、Legacy Installed、Legacy Run；
- 不允许创建、安装、启用、更新、切换、回滚、运行或卸载 Legacy Skill；
- 不允许通过旧 `/skills` 接口绕过 Package Runtime 执行；
- 旧数据如果仍需要保留，只能进入迁移/审计数据域，不参与现行 Catalog 和运行时；
- 一次性迁移工具不属于后台管理功能，不进入 Renderer、不注册公开 HTTP 路由。

### 5.2 分阶段清理顺序

| 阶段 | 动作 | 进入下一阶段的门槛 |
|---|---|---|
| L0 盘点 | 扫描 import、route registration、动态字符串、数据库表、fixture、文档和脚本 | 输出引用清单、数据量、外部调用方清单 |
| L1 隔离 | 关闭 Legacy UI 和新写入；旧入口若必须保留则只返回弃用/410，并记录请求 | Package Runtime 主链路通过回归测试 |
| L2 迁移 | 对仍需保留的旧数据执行离线转换或只读归档；记录无法自动迁移的原因 | 迁移报告、计数校验、抽样校验和回滚备份完成 |
| L3 删除 | 删除 Legacy Renderer、适配器、Repository、运行器、用户路由和无效 Feature Flag | 全量测试无 Legacy 管理引用；构建和安全门禁通过 |
| L4 清表 | 在发布窗口执行旧表/旧列删除或归档，保留审计所需最小记录 | 备份可恢复、迁移后不变量通过、回滚演练通过 |

### 5.3 数据处理默认决策

- 默认不在运行时读取旧 `skills` 和旧 `skill_runs` 表；
- 如果生产数据仍需迁移，保留最小的只读迁移 Repository 和一次性 CLI，禁止被应用服务 import；
- `legacy-to-draft` 只允许作为迁移转换器存在，不再作为 Creator 用户流程；
- 旧记录迁移失败时进入 manual-review report，不得静默丢弃或自动启用；
- 迁移完成后删除 `src/server/skills/legacy/`、Legacy adapter、Legacy registry、旧路由和旧表访问代码；
- 若一次性迁移尚未完成，v1.2 可以暂时保留迁移工具，但必须从生产 HTTP 路由和 Renderer bundle 中隔离，并在发布清单中写明删除条件。

---

## 6. 分阶段实施任务清单

### 6.1 Phase P0：基线、契约和安全边界

#### `SKL12-P0-001` 源码基线与 Legacy 依赖图

- **目标：** 对现有 Skills 代码、路由注册、Renderer 入口、数据库访问和测试做一次可复现盘点。
- **输入：** v1.2 设计文档、v1.1 实施计划、当前源码。
- **重点文件：** `src/renderer/App.tsx`、`src/renderer/pages/Skills/`、`src/server/http/routes/`、`src/server/skills/`、`src/server/db/`、`tests/`。
- **依赖：** 无。
- **验收：** 生成 import/route/schema/test 引用清单；每个 Legacy 引用标记为删除、迁移保留或审计保留；禁止以“源码已删除”代替扫描证据。

#### `SKL12-P0-002` Runtime 配置、Feature Flag 和权限边界

- **目标：** 固化 Package Runtime 的启用条件、Worker 配置、允许的 source、Capability policy、后台角色和危险操作权限。
- **重点文件：** `src/server/skills/config/skill-runtime.config.ts`、`src/server/skills/packages/feature-flag.ts`、认证/授权中间件、设置 Repository、`SkillRuntimeDiagnostics.tsx`。
- **依赖：** `SKL12-P0-001`。
- **验收：** 缺失配置有安全默认值；Legacy flag 不再控制用户界面；禁用 Runtime 时 UI 有明确 disabled/degraded 状态；普通用户不能执行管理员危险操作。

#### `SKL12-P0-003` HTTP DTO、错误、分页和幂等契约

- **目标：** 统一 API 响应结构、错误码、分页、排序、筛选、requestId、idempotencyKey 和 expectedRevision。
- **重点文件：** `src/server/http/dtos/skill-runtime.dto.ts`、`src/server/http/dtos/skill-runtime.error.ts`、`src/renderer/api/index.ts`、`skill-runtime.types.ts`。
- **依赖：** `SKL12-P0-002`。
- **验收：** 前后端共享类型或可验证 DTO；重复 install/update/cancel/export 不产生重复副作用；过期 revision 返回可识别冲突错误；错误可区分 retryable 与 non-retryable。

#### `SKL12-P0-004` 数据盘点、备份和迁移决策

- **目标：** 确认当前 Package 表、旧 Skills 表、Run 表、Artifact 表、迁移版本和真实数据量，形成迁移/清理决策。
- **重点文件：** `src/server/db/schema.ts`、`src/server/db/migrations.ts`、`src/server/db/migrate-cli.ts`、`src/server/db/repositories/legacy-migration.repo.ts`。
- **依赖：** `SKL12-P0-001`。
- **验收：** 输出 schema 快照、备份位置、行数/外键/孤儿记录检查结果、保留期限和删除时间；未完成迁移时禁止执行旧表删除。

### 6.2 Phase P1：后端领域和持久化

#### `SKL12-P1-001` Package/Version Repository 与领域 Facade

- **目标：** 以 Package Runtime Repository 为唯一 Catalog 数据源，隔离旧 `skillRepo` 兼容别名。
- **重点文件：** `src/server/db/repositories/skill-package.repo.ts`、`src/server/db/repositories/skill.repo.ts`、`src/server/db/repositories/skill-repo.boundary.test.ts`、`src/server/services/skill-package-runtime.service.ts`。
- **依赖：** P0 全部。
- **验收：** Package/Version/Installation 查询不触碰旧 Legacy Repository；删除或限制 `skillRepo = legacySkillRepo`；边界测试能阻止新代码 import Legacy adapter。

#### `SKL12-P1-002` Package 导入、Manifest 和 Import Review

- **目标：** 完成 GitHub、本地、ZIP、npx source 的 normalize、safe read、Manifest 解析、风险检查、review 和 snapshot。
- **重点文件：** `src/server/skills/packages/manifest-resolver.ts`、`manifest-schema.ts`、`package-reader.ts`、`package-path-policy.ts`、`github-source.ts`、`npx-artifact-detector.ts`、`package-install-review.service.ts`、`package-installer.ts`。
- **依赖：** `SKL12-P0-003`、`SKL12-P1-001`。
- **验收：** 路径穿越、超大文件、超深目录、非法 Manifest、未知 Capability、来源不可复现和恶意安装脚本均被拒绝或进入 warning/review；成功安装保存 digest/commit/文件快照。

#### `SKL12-P1-003` Catalog、Version、Update 和删除语义

- **目标：** 支持 Package 列表、详情、版本历史、Diff、更新预览、更新、归档/删除。
- **重点文件：** `skill-package-runtime.service.ts`、`src/server/skills/packages/`、`skill-package.repo.ts`、相关 DTO 和测试。
- **依赖：** `SKL12-P1-002`。
- **验收：** 版本不可变；更新前可预览 manifest、Capability 和风险变化；当前运行或历史审计引用不会被硬删除；删除采用明确的软删除/归档语义并可审计。

#### `SKL12-P1-004` Installation 生命周期

- **目标：** 完成 Installation 查询、启用/禁用、版本切换、回滚、卸载和状态收敛。
- **重点文件：** `skill-package-runtime.service.ts`、`src/server/skills/runtime/`、`skill-package.repo.ts`、`skill-runtime-invariants.ts`。
- **依赖：** `SKL12-P1-003`。
- **验收：** 禁用后不能创建新 Run；切换版本必须验证版本属于 Package 且 Capability 重新评估；回滚指向已验证快照；卸载不删除审计引用；重复操作幂等。

#### `SKL12-P1-005` Capability Grant、审批和 Broker

- **目标：** 统一 requested capability、审批、撤销、scope、预算、有效期和 Broker 执行入口。
- **重点文件：** `src/server/skills/policy/capability-policy.ts`、`capability-broker.ts`、`src/server/skills/policy/index.ts`、相关 Grant Repository/Service。
- **依赖：** `SKL12-P1-002`、`SKL12-P1-004`。
- **验收：** 未授权调用在 Broker 层被拒绝；pending Grant 会使 Run 进入 `waiting_approval` 而不是绕过审批；预算、scope、expiresAt、actor 和 audit reason 均生效；approve/reject/revoke 可重复调用且状态稳定。

#### `SKL12-P1-006` Run Coordinator、Queue、Worker 和 Event

- **目标：** 将 Run 建立、排队、领取、执行、等待、取消、恢复、重试和终态持久化为稳定状态机。
- **重点文件：** `src/server/skills/runtime/skill-run-coordinator.ts`、`skill-run-state-machine.ts`、`skill-run-queue.ts`、`skill-run-worker.ts`、`skill-run-events.ts`、`skill-run-recovery.test.ts`。
- **依赖：** `SKL12-P1-004`、`SKL12-P1-005`。
- **验收：** Run 创建后先持久化再入队；Worker lease 可恢复；事件 seq 单调递增；cancel/retry 不污染历史 Run；重启后 queued/running/waiting 状态按策略恢复；SSE 与历史事件一致。

#### `SKL12-P1-007` Artifact Store 和导出生命周期

- **目标：** 实现 Artifact ownership、类型、大小、checksum、处理状态、内容读取和安全导出。
- **重点文件：** `src/server/skills/artifacts/artifact-store.ts`、`artifact-policy.ts`、`src/server/skills/artifacts/index.ts`、Artifact Repository、`SkillArtifactPanel.tsx` 对应 DTO。
- **依赖：** `SKL12-P1-006`。
- **验收：** Artifact 必须绑定 Run/Version；路径不能逃逸受控目录；内容读取经过 ownership；导出需要确认、目标路径策略、审计 reason；processing/orphaned 状态正确显示。

#### `SKL12-P1-008` Creator Draft、Validate、Preview 和 Publish

- **目标：** 使 Creator 以 Package Runtime Draft 为唯一来源，禁止创建 Legacy Runtime。
- **重点文件：** `src/server/skills/creator/skill-draft.schema.ts`、`skill-draft.service.ts`、`src/server/http/routes/skill-creator.ts`、`SkillCreatorWorkbench.tsx`、`SkillCreatorEditor.tsx`、`SkillCreatorPreview.tsx`、`SkillCreatorPublishDialog.tsx`。
- **依赖：** `SKL12-P1-002`、`SKL12-P1-005`。
- **验收：** Draft 具备 revision 乐观锁；校验报告区分 error/warning；Preview 不产生安装副作用；Publish 生成不可变版本并可选择启用；Runtime 选项中不存在 Legacy。

#### `SKL12-P1-009` Runtime Health、Diagnostics、Audit 和 Metrics

- **目标：** 提供后台判断“Runtime 是否可用”的健康状态、诊断信息、关键指标和审计查询。
- **重点文件：** `src/server/skills/observability/skill-runtime.diagnostics.ts`、`skill-runtime.logger.ts`、`skill-runtime.metrics.ts`、`src/server/http/routes/skill-runtime-observability.ts`、`SkillRuntimeDiagnostics.tsx`。
- **依赖：** P1 核心服务完成。
- **验收：** health 和 diagnostics 能区分 healthy/degraded/disabled；日志包含 requestId/runId/packageId/versionId 且敏感值脱敏；指标至少覆盖 install、approval、queue、run、artifact、error 和 Legacy 拒绝计数。

### 6.3 Phase P2：HTTP API 实现和契约接线

#### `SKL12-P2-001` Package/Import/Installation API

- **修改范围：** `src/server/http/routes/skill-package-runtime.ts`、DTO、授权中间件、API 集成测试。
- **内容：** 接线 inspect/install/review approve/reject、catalog、detail、versions、diff、update preview/update、installation patch/switch/rollback/delete。
- **验收：** 每个写操作具备权限检查、参数校验、幂等键/expectedRevision（适用时）、审计和明确错误码；分页和筛选结果稳定。

#### `SKL12-P2-002` Grant/Run/Artifact API

- **修改范围：** `skill-package-runtime.ts`、`skill-runtime-observability.ts`、DTO、SSE stream 和集成测试。
- **内容：** 接线 Grant 操作、Run 创建/列表/detail/next-action/events/stream/commands/cancel、Artifact 列表/content/export。
- **验收：** 事件历史与 SSE 顺序一致；Run 命令只允许状态机允许的动作；Artifact 内容和导出执行 ownership、路径和审计检查。

#### `SKL12-P2-003` Creator API 与后台设置 API

- **修改范围：** `src/server/http/routes/skill-creator.ts`、设置相关路由、schema 和测试。
- **内容：** Draft CRUD、validate、preview、publish、Runtime settings/diagnostics/feature flag 读取和更新。
- **验收：** Draft 发布和 Package 版本建立可追踪关系；设置变更有权限、审计和回滚；不提供 Legacy 开关或 Legacy 管理入口。


### 6.4 Phase P3：Renderer Skills 管理后台

#### `SKL12-P3-001` API Client、DTO 类型和 Runtime Store

- **修改范围：** `src/renderer/api/index.ts`、`src/renderer/pages/Skills/skill-runtime.types.ts`、`skill-runtime.store.ts`、相关测试。
- **内容：** 复用现有 API 方法，补齐筛选、分页、错误、loading、mutation 状态、SSE 重连、toast 和 optimistic update 回滚。
- **验收：** UI 不直接拼接未编码 ID；所有响应按 DTO 转换；API 错误显示可读信息；并发更新不会用旧 revision 覆盖新状态。

#### `SKL12-P3-002` App 入口、导航和页面壳

- **修改范围：** `src/renderer/App.tsx`、`src/renderer/pages/Skills/SkillsSidebar.tsx`、`src/renderer/pages/Skills/index.tsx`。
- **内容：** 九个视图统一进入 Package Runtime 管理后台；导航、面包屑、Runtime Healthy/Worker 上下文、全局搜索和页面状态与设计文档一致。
- **验收：** 不再存在 `LegacySkillsMarket` 分支；刷新/切换视图不会丢失当前上下文；Feature Flag 只控制现行 Runtime 能力。

#### `SKL12-P3-003` Skills Center Catalog

- **修改范围：** `SkillsCenterWorkbench.tsx`、相关子组件、`skills-center.e2e.ts`、`SkillsCenterWorkbench.test.tsx`。
- **内容：** Package 列表、状态图例、指标卡、筛选、搜索、分页、最近 Run、待审批事项、空/错误/加载状态。
- **验收：** 列表只出现 Package Skill；状态使用图标+文字+颜色；可从列表进入 Detail、Run、Grant；列表和详情状态最终一致。

#### `SKL12-P3-004` 列表行内操作图标和 Tooltip

- **修改范围：** `SkillsCenterWorkbench.tsx` 及操作按钮/样式组件。
- **内容：** Actions 列固定显示四个图标，顺序为：查看详情、启用/禁用、创建新版本、卸载 Installation；不显示三点入口，不打开标题为“Skill 操作”的菜单弹窗。
- **验收：** 每个 icon-only button 有 `aria-label`、`title`、键盘 Focus 和可读 hover/focus 文字；启用/禁用图标随状态动态切换；卸载使用 danger 色并只打开单动作确认；点击成功后列表状态刷新，失败时恢复并显示错误。

#### `SKL12-P3-005` 导入 Skill 页面

- **修改范围：** Import 视图、`PackageInstallDialog.tsx`、相关 API/store/test。
- **内容：** source 类型选择、路径/URL 校验、inspect 结果、风险、Capability、review 状态、approve/reject/install 长任务。
- **验收：** 导入过程分阶段显示；警告必须解释原因和下一步；Rejected 不能安装；安装成功跳转 Package Detail 或 Skills Center 并保留审计信息。

#### `SKL12-P3-006` Skills Creator 页面

- **修改范围：** `SkillCreatorWorkbench.tsx`、`SkillCreatorEditor.tsx`、`SkillCreatorPreview.tsx`、`SkillCreatorValidationPanel.tsx`、`SkillCreatorPublishDialog.tsx`。
- **内容：** Draft 自动保存、revision、Runtime/Capability 选择、校验、预览、发布、发布后跳转。
- **验收：** 不出现 Legacy Runtime；危险 Capability 有 warning/approval 提示；校验 error 阻止发布；发布成功后生成 Package/Version/Installation 关系。

#### `SKL12-P3-007` Skill 详情、版本、文件和 Capability

- **修改范围：** `PackageDetailDrawer.tsx`、`SkillOverviewPanel.tsx`、`SkillVersionPanel.tsx`、`SkillCapabilityPanel.tsx`、`SkillEditor.tsx`。
- **内容：** Hero、来源、版本、文件树、Diff、Capabilities、Installations、Runs、History、更新预览、回滚和危险操作确认。
- **验收：** 所有详情链接可追溯到 Package/Version/Installation；历史版本不可被误显示为当前版本；Capability scope 可读；更新/回滚展示影响和风险。

#### `SKL12-P3-008` 权限与安装页面

- **修改范围：** `CapabilityApprovalCard.tsx`、`SkillCapabilityPanel.tsx`、安装状态组件、权限相关 store/test。
- **内容：** Pending Approval 队列、Active/Revoked Grant、Installation 状态、approve/reject/revoke、scope/budget/expiry 展示。
- **验收：** 审批后回到原上下文；重复审批不会产生冲突；权限状态和 Run waiting 状态最终收敛；无权限用户只能查看允许范围。

#### `SKL12-P3-009` Runs、Run Detail、Artifacts 和 Settings

- **修改范围：** `RunActionPanel.tsx`、`RunDetailDrawer.tsx`、`RunEventStream.tsx`、`RunTimeline.tsx`、`ArtifactList.tsx`、`SkillArtifactPanel.tsx`、`SkillRuntimeDiagnostics.tsx`。
- **内容：** Run 查询/筛选、Timeline、SSE、next action、cancel/retry/export events、Artifact 预览/导出、Runtime health/diagnostics/settings。
- **验收：** running/waiting/succeeded/failed/cancelled 使用设计统一状态；SSE 断线可重连且不重复事件；Artifact 显示来源和安全状态；设置页无 Legacy 兼容开关。

#### `SKL12-P3-010` 视觉、响应式和可访问性统一

- **修改范围：** Skills 页面样式、共享 token、图标组件、测试。
- **内容：** 使用 `#F5F5F4`、`#FFFFFF`、`#EEEDE9`、`#1A1A18`、`#DDDBD6`、`#7C6FF7`、`#4B9BF5` 和设计文档规定的语义色；统一 badge、button、notice、focus ring、tooltip、滚动表格。
- **验收：** 1120/860px 断点表现符合设计；表格可横向滚动；操作触控区域不小于 29×29px；状态在灰度/色觉差异下仍可识别；键盘可完成主流程。

### 6.5 Phase P4：Legacy 清理和边界收紧

#### `SKL12-P4-001` 删除前端 Legacy 入口

- **修改范围：** `src/renderer/App.tsx`、`src/renderer/pages/Skills/index.tsx`、`SkillsCenterWorkbench.tsx`、`skills.store.ts`、相关样式和测试。
- **内容：** 删除 Legacy import、分支、market/installed、Create Legacy Skill、旧 Tab、旧卡片、旧安装/卸载/运行调用和 `legacySkills` 参数。
- **验收：** `rg`/`Select-String` 扫描生产 Renderer 不再存在 Legacy 管理字符串；页面只加载 Package Runtime；打包产物不含旧页面入口。

#### `SKL12-P4-002` 删除或隔离后端 Legacy 入口

- **修改范围：** `src/server/http/routes/skills.ts`、`skill-migration.ts`、`src/server/skills/legacy/`、`creator/legacy-to-draft.service.ts`、`skill.repo.ts`、服务注册文件。
- **内容：** 取消旧用户路由注册；删除 `legacySkillRepo` 默认别名；Legacy adapter/registry 不再被应用运行时引用；迁移工具如仍需要则隔离为一次性 CLI。
- **验收：** 应用启动时不初始化 Legacy Registry；任何新建/安装/运行 Legacy 请求被拒绝或路由不存在；Package Runtime 测试通过；依赖边界测试阻止回流。

#### `SKL12-P4-003` Legacy 数据迁移、归档和旧表处理

- **修改范围：** `src/server/db/migrations.ts`、`migrate-cli.ts`、`legacy-migration.repo.ts`、`src/server/skills/migration/`、迁移脚本和报告。
- **内容：** 执行备份、计数校验、可迁移数据转换、manual review、旧数据只读归档、旧表/列删除计划。
- **验收：** 迁移前后包/版本/安装/Run/Artifact 计数可对账；无法迁移记录可追踪；迁移失败可恢复；未满足门槛不得 drop 旧表。

#### `SKL12-P4-004` 清理 Legacy 测试、fixture 和文档引用

- **修改范围：** `tests/e2e/skills/legacy-skills-migration.browser.test.ts`、`tests/e2e/skills/fixtures/legacy-skills.json`、`tests/integration/skill-runtime/legacy-migration.integration.test.ts`、`tests/security/legacy-skill-migration.security.test.ts`、脚本和文档。
- **内容：** 迁移尚未结束时将测试重命名为离线迁移验证并隔离；迁移完成后删除旧管理功能 fixture 和测试；更新 package scripts 和 README/文档索引。
- **验收：** 生产功能测试不再依赖 Legacy fixture；保留的迁移测试明确是一次性、只读、不可作为用户功能；文档不会宣称 Legacy 管理仍受支持。

### 6.6 Phase P5：测试、验收和发布门禁

#### `SKL12-P5-001` 单元和领域测试

覆盖：Manifest schema、source normalize、safe reader、path policy、Capability policy/Broker、状态机、Queue/Worker、Event seq、Artifact policy、Draft schema/service、Repository invariants。

#### `SKL12-P5-002` HTTP 和数据库集成测试

覆盖：导入审批、安装、更新、切换、回滚、卸载、Grant、Run、SSE、Artifact、Creator、health/diagnostics、权限拒绝、幂等、分页、迁移前后不变量。

#### `SKL12-P5-003` 安全测试

覆盖：路径穿越、压缩包炸弹、恶意脚本、非法 source、Capability 越权、scope 绕过、过期 grant、敏感日志、导出目录逃逸、审计字段缺失、Legacy 绕过接口。

#### `SKL12-P5-004` Renderer 和浏览器 E2E

覆盖：

- Skills Center 搜索/筛选/分页/空态/错误态；
- 四个行内图标的 click、hover、focus、Tooltip、aria-label；
- 启用/禁用和卸载确认；
- 导入 inspect → approve/reject → install；
- Creator draft → validate → preview → publish；
- Detail → Version → Grant → Run → Artifact；
- SSE 断线重连、Run cancel/retry；
- 860px/1120px 响应式和键盘操作；
- 页面中不存在 Legacy 入口。

#### `SKL12-P5-005` 发布门禁和回滚演练

发布前必须执行：

```text
npm run lint
npm run typecheck:skills
npm run test:skills:unit
npm run test:skills:integration
npm run test:skills:security
npm run test:skills:migration
npm run test:skills:e2e
npm run build
npm test
```

如果迁移工具在本版本仍然存在，再执行：

```text
npm run verify:legacy-skills-migration
npm run test:skills:migration:smoke
```

验收结果需记录命令、执行时间、提交 SHA、测试数量、失败重试和证据路径。

---

## 7. API 契约实施要求

### 7.1 响应结构

成功响应统一为：

```json
{
  "data": {},
  "meta": {
    "requestId": "...",
    "page": { "limit": 50, "offset": 0, "total": 0 }
  }
}
```

错误响应统一为：

```json
{
  "error": {
    "code": "SKILL_CAPABILITY_DENIED",
    "message": "Readable message",
    "details": {},
    "retryable": false,
    "requestId": "..."
  }
}
```

### 7.2 写操作要求

| 操作 | 幂等/并发要求 | 审计要求 |
|---|---|---|
| inspect | 相同 source digest 可复用检查结果，但不能跳过安全检查 | source、digest、actor、result |
| install | `idempotencyKey`；相同 package/version 不重复写入 | source、version、risk、actor |
| approve/reject | 状态条件更新，重复请求返回当前结果 | reviewer、reason、review result |
| update/switch/rollback | `expectedRevision` 或 version guard | before/after version、risk |
| enable/disable | 状态条件更新，重复调用幂等 | actor、before/after |
| uninstall/delete | 明确确认值和权限；运行中禁止破坏性删除 | reason、affected installation、audit refs |
| create Run | version 固定；创建和入队可重试 | trigger、actor、capability snapshot |
| cancel/retry | 只允许状态机允许动作；retry 新建 Run | source run、reason、actor |
| grant approve/revoke | scope、budget、expiry 必须可见 | capability、scope、actor、reason |
| artifact export | `confirmed: true`、目标路径校验、审计 reason | artifact、run、destination、actor |
| draft update/publish | revision 乐观锁；publish 不可重复生成不同版本 | draft、revision、published version |

### 7.3 权限和资源范围

每个 API 必须至少验证：

- 当前用户/工作区是否有 Skills 管理权限；
- package、installation、run、grant、artifact 是否属于当前 workspace；
- 资源是否已删除、禁用、隔离、过期或处于不允许操作的状态；
- Capability 是否在系统策略和 Installation Grant 范围内；
- 导出路径、source URL、本地目录和文件内容是否满足安全策略；
- 是否写入 actor、requestId、operation reason 和结果审计。

---

## 8. 数据库和迁移实施计划

### 8.1 Schema 任务

1. 对现有 Package Runtime 表、旧 `skills`/`skill_runs` 表和迁移版本生成快照。
2. 为 Package、Version、Installation、ImportReview、Grant、Run、Event、Artifact、Draft 和 Audit 建立明确外键、唯一键、状态字段、revision 和时间字段。
3. 为高频查询增加索引：
   - package name/source/status；
   - installation package/status/active version；
   - run status/createdAt/package/version；
   - run event runId/seq；
   - grant status/installation/capability；
   - artifact runId/status/createdAt；
   - draft status/updatedAt。
4. 对事件和审计字段使用 JSON schema/version 标记，避免未来只能依赖不可验证的自由 JSON。
5. 对所有删除动作明确软删除、归档或物理删除边界，不能让 `DELETE` 误删运行和审计历史。

### 8.2 迁移步骤

```text
M0 备份数据库和受控文件存储
M1 校验现有 schema、外键、索引、迁移版本
M2 确认 Package Runtime 表和不变量
M3 停止 Legacy 新写入和用户路由
M4 执行可迁移数据转换/只读归档
M5 计数、外键、digest、Artifact ownership 对账
M6 发布 v1.2 应用代码
M7 观察窗口内保留回滚备份和迁移报告
M8 达到门槛后删除旧表/旧列/旧代码
```

### 8.3 迁移验收门槛

- Package、Version、Installation、Run、Artifact 数量与源数据可对账；
- 所有 active Installation 的 active Version 存在且 digest 可验证；
- 所有保留 Run 都能定位到 Version；
- 所有 Artifact 都能定位到 Run 和受控存储位置；
- 不存在指向旧 Legacy Repository 的生产服务；
- migration smoke、数据库 invariant 和恢复演练通过；
- 迁移报告中没有未说明的丢失、重复或孤儿数据。

---

## 9. 前端页面验收清单

### 9.1 Skills Center

- [ ] 只展示 Package Skill；
- [ ] 搜索、筛选、分页和排序与 URL/Store 状态一致；
- [ ] 状态 Badge 同时有图标、文字、语义色；
- [ ] 指标卡显示 Package、Active Installation、Running Run、Pending Approval 等真实数据；
- [ ] 列表 Actions 直接显示四个图标，不显示三点菜单；
- [ ] 查看详情、启用/禁用、创建新版本、卸载分别调用正确 API；
- [ ] 危险卸载只出现单动作确认；
- [ ] hover/focus 显示操作文字说明；
- [ ] loading、empty、error、disabled 状态完整。

### 9.2 导入和 Creator

- [ ] Import source 校验、inspect、风险和 Capability 结果可见；
- [ ] warning/rejected 状态不能被误显示为 validated；
- [ ] Creator 没有 Legacy Runtime 选项；
- [ ] Draft revision 冲突可恢复；
- [ ] Validate error 阻止 Publish；
- [ ] Publish 后能跳转 Detail 并看到版本和 Installation 状态。

### 9.3 Detail、Permissions、Runs、Artifacts、Settings

- [ ] Detail 能查看版本、文件、Capability、Runs、History；
- [ ] Grant pending/active/revoked 与后端一致；
- [ ] Run Timeline、Event stream、Cancel/Retry 状态一致；
- [ ] Artifact 显示类型、来源、Run、大小、状态和导出权限；
- [ ] Settings 显示 Runtime health/diagnostics、Import/Security、Artifact 和 Feature Flags；
- [ ] 页面不出现 Legacy 文字、Legacy 操作或旧数据写入入口。

---

## 10. 测试矩阵与证据要求

| 层级 | 重点范围 | 必须执行 |
|---|---|---|
| Typecheck | Skills 类型、Route DTO、Renderer API/store | `npm run typecheck:skills` |
| Unit | Domain、Repository、Manifest、Policy、State Machine、Artifact、Creator | `npm run test:skills:unit` |
| Integration | HTTP、DB、Queue、Worker、SSE、Migration | `npm run test:skills:integration`、`npm run test:skills:migration` |
| Security | source、path、capability、export、audit、Legacy bypass | `npm run test:skills:security` |
| Renderer | Store、API adapter、组件、状态和错误 | 纳入现有 Vitest 测试集合 |
| Browser E2E | 九视图、四个行内动作、Creator、Run、Artifact、响应式 | `npm run test:skills:e2e` |
| Migration smoke | 数据计数、不变量、旧入口关闭 | `npm run test:skills:migration:smoke` |
| Build | Electron/Vite 构建、bundle 无 Legacy 入口 | `npm run build` |
| Full regression | 项目既有测试 | `npm test` |

### 10.1 最小测试 fixture

保留或补齐以下 Package Runtime fixture：

- 最小合法 Package；
- 含 Capability Approval 的 Package；
- 失败运行 Package；
- 含 Artifact 的 Image/Article Illustration Package；
- GitHub archive source；
- npx artifact source；
- 非法 Manifest；
- 路径穿越和恶意安装脚本；
- unsupported capability；
- 多版本、更新、回滚和禁用 Installation；
- waiting approval、SSE 断线和 Worker recovery。

Legacy fixture 只在一次性迁移仍未完成时保留，并放在迁移测试专用目录，禁止被后台 E2E 复用。

### 10.2 浏览器验收证据

每个主流程至少保留：

1. 操作前页面和当前状态；
2. 操作请求的成功/失败反馈；
3. 操作后列表或详情的持久状态；
4. 必要时的 Network/Server log/requestId；
5. 危险操作确认和审计结果；
6. 窄屏和键盘 Focus 证据。


---

## 11. 实施顺序、依赖和并行安排

### 11.1 关键路径

```text
P0 基线/契约
  → P1 数据与领域服务
  → P2 HTTP API
  → P3 Renderer API/store
  → P3 页面闭环
  → P4 Legacy 隔离/删除
  → P5 全量测试与迁移门禁
  → 发布和回滚演练
```

### 11.2 可并行工作流

在 P0 契约冻结后可并行：

- 后端 Package/Installation/Grant/Run/Artifact 服务；
- Renderer API/types/store 和页面骨架；
- 数据库迁移脚本和迁移验证工具；
- 安全测试 fixture、领域单测和 E2E 骨架；
- Legacy 引用扫描和删除补丁。

### 11.3 不应并行的工作

- 未冻结状态机前，不同时修改 Run Worker 和 Run Detail 状态映射；
- 未完成迁移对账前，不删除旧表或旧 Repository；
- 未完成 Package API 权限审查前，不开放 UI 的 Install/Run/Export；
- 未完成 Actions 图标可访问性验收前，不将三点菜单删除作为“已完成”；
- 未完成安全 fixture 后，不宣称导入链路已可发布。

### 11.4 推荐提交边界

建议按以下提交边界拆分，便于评审和回滚：

1. `docs/skills`：本实施计划和契约补充；
2. `skills-domain`：状态机、Policy、Repository boundary；
3. `skills-api`：Route、DTO、错误和权限；
4. `skills-runtime`：Queue、Worker、Event、Artifact；
5. `skills-renderer`：API、Store、九视图；
6. `skills-legacy-removal`：Legacy 清理和迁移隔离；
7. `skills-tests`：单测、集成、E2E、安全和发布门禁；
8. `skills-release`：迁移 runbook、监控和回滚证据。

---

## 12. 发布、迁移和回滚方案

### 12.1 发布前

- 冻结数据库备份和文件存储备份；
- 确认 Package Runtime 的 feature flag、Worker 数量和队列目录；
- 完成所有 release-gate 命令；
- 完成 Legacy 引用扫描并保存结果；
- 完成一轮导入、安装、审批、运行、Artifact、卸载的真实闭环；
- 确认操作员知道如何停止 Worker、恢复数据库和回滚 bundle。

### 12.2 分阶段发布

1. **内部工作区：** 只对开发/测试 workspace 开启，观察 import、grant、run、artifact 错误率。
2. **小范围工作区：** 开启真实但低风险 Package，确认更新、回滚和卸载。
3. **全量开启：** 关闭 Legacy 新写入和 UI；保留迁移观察窗口；按门槛执行旧表清理。

### 12.3 回滚触发条件

以下任一条件成立时停止扩大发布并评估回滚：

- active Installation 或 Run 数据出现不可解释的数量变化；
- Run 状态无法收敛、事件 seq 重复或 SSE 与历史不一致；
- Capability Broker 出现越权或未授权调用；
- Artifact ownership/path policy 出现绕过；
- 安全扫描、数据库 invariant 或迁移 smoke 失败；
- 卸载、回滚或禁用造成历史审计引用丢失；
- Legacy 路由仍能创建或执行旧对象。

### 12.4 回滚原则

- 先关闭新写入和 Worker，再恢复应用版本；
- 保留新版本产生的数据库备份和审计日志，不直接覆盖证据；
- 如果已经执行旧表删除，必须使用备份恢复或预先验证过的反向迁移，不允许现场手工猜测修复；
- 回滚后重新执行 Package/Installation/Run/Artifact 不变量检查；
- 回滚结果和未解决问题必须写入发布记录。

---

## 13. Definition of Done

### 13.1 单任务 DoD

- 代码实现与 v1.2 设计和本计划一致；
- 不增加 Legacy 管理能力或绕过 Package Runtime 的新入口；
- 有对应单元/集成/组件/E2E 测试；
- 错误、权限、幂等、审计和回滚语义已覆盖；
- 修改文件、数据库影响和 API 影响已记录；
- lint、typecheck 和相关测试通过；
- 评审意见已处理。

### 13.2 Phase DoD

- Phase 内所有任务状态为 `DONE` 或有书面批准的 `BLOCKED`；
- Phase 输出的契约、迁移和测试证据可被下一 Phase 使用；
- 不能存在未解释的 Legacy 依赖回流；
- 关键页面和服务可以独立启动并完成最小闭环。

### 13.3 Release DoD

发布 v1.2 前必须全部满足：

- [ ] Skills Center 只展示 Package Skill；
- [ ] 导入、安装、审批、启用/禁用、更新、切换、回滚、卸载闭环通过；
- [ ] Creator Draft、Validate、Preview、Publish 闭环通过；
- [ ] Run、Event、SSE、Cancel/Retry、Artifact 闭环通过；
- [ ] Capability Broker 和权限边界通过安全测试；
- [ ] 四个列表行内图标及 Tooltip、`aria-label`、键盘 Focus 通过；
- [ ] 不再显示或执行 Legacy 管理功能；
- [ ] Legacy 旧数据已按迁移策略完成归档/转换/清理，或有批准的隔离计划；
- [ ] 所有 release-gate 命令通过；
- [ ] 备份、迁移、监控、回滚 Runbook 可执行并完成演练；
- [ ] 交付清单、变更日志和已知问题已更新。

---

## 14. 待决策项

以下事项在开始 P1/P2 前必须由产品、后端和安全负责人确认；未确认时按“安全默认值”执行：

1. 生产环境是否仍存在必须迁移的 Legacy 数据，保留期限是多少？
2. Legacy 一次性迁移是否在 v1.2 发布前完成，还是作为独立离线批次发布？
3. `DELETE /skill-packages/:id` 的最终语义是归档、软删除还是仅删除未安装 Package？
4. 危险操作是否需要管理员角色、二次认证或 workspace owner 审批？
5. 运行时允许的最大文件、Artifact、Run 时长、队列深度和 Capability 预算是多少？
6. Package source 是否允许 branch；如果允许，安装后如何固定为 digest/commit？
7. Artifact 导出是否允许任意 workspace 目录，还是只能导出到受控 workspace storage？
8. v1.2 是否需要保留旧 API 的短期 410 兼容响应，还是直接取消路由注册？
9. Runtime health/diagnostics 是否需要接入现有监控系统和通知渠道？

默认决策：**生产环境必须迁移 Legacy 数据不用保留、不开放 Legacy 用户 API、一次性迁移完成 Legacy 在 v1.2、不允许 Legacy 新写入、不允许不受控文件导出、不允许未审批 Capability 执行；数据迁移完成前只保留隔离的离线工具。运行时允许的最大文件设置一个默认值10M可修改、Artifact、Run 时长设置一个默认值10分钟可修改；Artifact 导出只能导出到受控 workspace storage**

---

## 15. 最终交付清单

### 15.1 文档

- `docs/skills/006-skills-admin-v1.2-implementation-plan.md`
- `docs/skills/skill-admin-system-v1.2-design.md`
- `docs/skills/ui/skill-management-console-v1.2.html`
- API/数据库迁移说明、发布 Runbook、变更日志和已知问题。

### 15.2 后端

- Package/Version/Installation/ImportReview/Grant/Run/Event/Artifact/Draft 服务；
- HTTP routes、DTO、错误码、授权、审计和幂等；
- 数据库 schema、迁移、索引和 invariant；
- Queue/Worker、SSE、Artifact Store、Diagnostics；
- Legacy 路由、适配器、Registry 和旧 Repository 的删除或隔离结果。

### 15.3 前端

- API client、类型和 Runtime Store；
- Skills Center、Import、Creator、Detail、Permissions、Runs、Run Detail、Artifacts、Settings；
- 统一状态 Badge、颜色、图标、Tooltip、Focus 和响应式样式；
- Skills Center 四个直接行内操作图标；
- Legacy UI 和旧入口清理结果。

### 15.4 测试和证据

- 单元、集成、安全、Renderer、浏览器 E2E、迁移和回滚证据；
- release-gate 命令输出；
- 数据库备份、迁移对账和恢复演练记录；
- 关键操作的 requestId、审计记录、截图或日志。

---

## 16. 本计划执行起点

按以下顺序开始实际开发：

1. 执行 `SKL12-P0-001`，提交当前源码 Legacy 引用和 Package Runtime 依赖图；
2. 执行 `SKL12-P0-002` 至 `SKL12-P0-004`，冻结权限、错误、幂等和数据迁移决策；
3. 先完成 Package/Version/Installation/Grant/Run/Artifact 的后端契约与不变量；
4. 接线现有 HTTP API 和 Renderer API/store；
5. 以 `skill-management-console-v1.2.html` 为视觉验收基准实现九个 React 视图；
6. 完成列表行内四个图标操作和可访问性验收；
7. 关闭并删除 Legacy 用户入口，完成迁移验证后删除 Legacy 代码；
8. 执行完整测试、发布门禁、迁移和回滚演练；
9. 只有在所有 Release DoD 勾选完成后，才标记 Skills 后台 v1.2 可发布。

> **当前状态说明：** 本文档只定义实施任务和验收门槛；创建本文档时尚未开始修改 Skills 业务代码。后续实现必须以本计划、v1.2 设计文档和 v1.2 HTML 原型三者共同作为评审基线。
