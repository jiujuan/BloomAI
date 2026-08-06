# BloomAI Skills Admin System v1.1 设计规格

> **设计名称：** Skills Runtime Control Plane
> **版本：** v1.1
> **日期：** 2026-08-06
> **状态：** 已完成设计审批，待 HTML 原型实现
> **目标目录：** `docs/skills` / `docs/skills/ui`
> **重要说明：** 本设计是全新后台管理系统，不复用、不修改 `skill-management-console-v1.1.html`。

## 1. 设计目标

为 BloomAI Skills System v1.1 提供一个面向管理员和运维人员的统一后台控制面，同时为普通用户保留经过权限过滤的 Skills、Run 和 Artifact 使用入口。

系统必须让用户理解以下事实：

1. Skill Package、Skill Version、Skill Installation、Run、Event、Capability Grant 和 Artifact 是不同的一等对象。
2. Skill manifest 中的 requested capability 不是权限授予；实际执行必须经过 Capability Broker。
3. Run 必须绑定 immutable Skill Version 和 content hash，历史运行不能因为 Skill 更新或卸载而失去可复现性。
4. 长任务、审批等待、Worker 恢复、迁移和回滚都必须展示持久化状态，不能依赖页面或 HTTP 请求存活。
5. 数据库迁移只允许 forward-fix；应用可以回滚，历史 Run/Event/Artifact 不能被删除。

## 2. 范围

### 2.1 页面范围

| 编号 | 页面 | 建议路由 | 页面角色 |
|---|---|---|---|
| 1 | Runtime Overview | `/skills/admin/overview` | 总览、健康、积压、异常入口 |
| 2 | Package Catalog | `/skills/admin/packages` | Skill Package 列表和导入 |
| 3 | Package Detail | `/skills/admin/packages/:packageId` | Package、Version、Installation 详情 |
| 4 | Run Explorer | `/skills/admin/runs` | 全量/个人 Run 查询 |
| 5 | Run Detail | `/skills/admin/runs/:runId` | 状态机、事件、能力、Artifact |
| 6 | Approval Queue | `/skills/admin/approvals` | Capability Approval 队列 |
| 7 | Capability Policies | `/skills/admin/capabilities` | 能力策略和 Scope 管理 |
| 8 | Artifact Center | `/skills/admin/artifacts` | 产物、Retention、Orphan 管理 |
| 9 | Creator / Draft Studio | `/skills/admin/creator` | Draft、审查、预览、发布 |
| 10 | Legacy Skills | `/skills/admin/legacy` | Legacy 兼容和迁移评估 |
| 11 | Runtime Diagnostics | `/skills/admin/diagnostics` | Health、Worker、Queue、DB、Metrics |
| 12 | Release & Migration | `/skills/admin/operations` | 发布阶段、迁移、备份、回滚 |
| 13 | Audit & Evidence | `/skills/admin/audit` | 审计、发布证据、导出 |

### 2.2 非目标

- 不在本次 HTML 原型中实现真实认证、后端请求、数据库写入或真实文件下载。
- 不修改已有 Skills UI 页面或现有后台业务页面。
- 不把 Legacy Skill 强制改写为 SKILL.md。
- 不在前端绕过 Capability Broker、Grant、Audit 或 Runtime Feature Gate。

## 3. 信息架构

### 3.1 后台壳层

采用桌面端控制台布局：

- 左侧导航：页面分组和当前角色可见菜单；
- 顶部上下文栏：当前 Workbench、Runtime 状态、schema、Worker、队列、审批数量、全局搜索、角色切换；
- 主内容区：页面标题、状态 Banner、指标、列表或工作台；
- 右侧抽屉：详情预览、操作确认、关联对象；
- Toast / Inline Banner：成功、警告、错误和长任务进度。

`Workspace` 在 UI 中统一改为 **Workbench**。领域对象字段如果来自服务端协议，可以保留 `workbenchId`，不得在用户界面显示 Workspace。

### 3.2 全局上下文栏

固定显示：

- `Workbench` 选择器；
- Runtime 状态：Healthy、Degraded、Read-only、Execution disabled；
- 当前 schema migration；
- Worker 在线数、Queue depth；
- Pending Approval 数量；
- 全局搜索；
- 当前角色；
- `暂停新 Run`（只有管理员/运维可用）。

### 3.3 对象关联

```text
Workbench
  └── SkillInstallation
        └── SkillVersion
              └── SkillPackage
                    ├── Run
                    │    ├── Event
                    │    ├── Capability Grant
                    │    └── Artifact
                    └── Audit
```

所有详情入口保留上下文链路：

```text
Package → Version → Installation → Run → Event / Capability / Artifact
```

## 4. 三角色权限模型

角色只保留三种：**普通用户、管理员、运维人员**。

### 4.1 普通用户

允许：

- 查看自己在当前 Workbench 可用的 Skills；
- 在授权范围内启用/使用 Skill；
- 查看自己的 Run、Event 摘要和 Artifact；
- 提交 Capability 使用请求；
- 取消自己的 Run；
- 创建、保存自己的 Creator Draft；
- 查看自己的错误和提示。

禁止：

- 管理全局 Package、Version、Installation；
- 修改 Capability Policy；
- 查看其他用户数据；
- 执行 Migration、Release、Rollback；
- 修改 Runtime Feature Flag。

### 4.2 管理员

允许：

- 管理 Package、Version、Installation；
- 导入、审查、启用、禁用和删除 Skill；
- 管理 Creator Draft、Review、Publish；
- 处理 Capability Approval；
- 管理 Capability Policy；
- 查看全局 Package、Run、Artifact、Audit；
- 管理 Workbench 级 Skill 可见性；
- 管理 Legacy 兼容和迁移评估。

禁止：

- 直接修改生产数据库；
- 执行 Restore；
- 直接完成生产 Rollback；
- 绕过 Runtime 安全策略执行高风险能力。

### 4.3 运维人员

允许：

- 查看 Runtime Overview、全局 Run、Queue 和 Worker；
- 暂停新 Run、Drain Worker、恢复 Worker；
- 查看 Diagnostics、Metrics、Health、Readiness；
- 管理 Artifact Retention 和 Orphan Cleanup；
- 执行 Release Gate、Migration Dry-run、Backup / Restore Rehearsal；
- 执行应用 Rollback 和 Runtime 降级；
- 查看全局 Audit 和发布证据。

禁止：

- 修改 Skill 内容和 Creator Draft；
- 发布 Skill Version；
- 修改 Capability Policy；
- 绕过管理员审批直接批准高风险 Grant。

### 4.4 页面可见性

| 页面 | 普通用户 | 管理员 | 运维人员 |
|---|---:|---:|---:|
| Runtime Overview | 个人摘要 | 全局只读 | 全局 + 运维操作 |
| Package Catalog | 可用 Skills | 完整管理 | 全局只读 |
| Package Detail | 可用范围 | 完整管理 | 全局只读 |
| Run Explorer | 自己的 Run | 全局 | 全局 |
| Run Detail | 自己的 Run | 全局 | 全局 |
| Approval Queue | 自己提交的请求 | 审批处理 | 只读 |
| Capability Policies | 只读说明 | 管理 | 只读 |
| Artifact Center | 自己的 Artifact | 全局管理 | Retention / Cleanup |
| Creator / Draft Studio | 自己的 Draft | Review / Publish | 只读 |
| Legacy Skills | 不可见或只读提示 | 管理 | 迁移状态只读 |
| Runtime Diagnostics | 不可见 | 只读摘要 | 完整诊断 |
| Release & Migration | 不可见 | 证据只读 | 完整操作 |
| Audit & Evidence | 自己相关 | 全局 | 全局 |

没有权限的按钮不直接隐藏，使用 disabled + 解释性 Tooltip，避免用户误以为系统缺失功能。

## 5. 视觉系统

视觉基于当前 BloomAI 后台 Token，但为 Skills Runtime 重新设计组件和页面，不复制既有 HTML。

### 5.1 基础 Token

| Token | Light | Dark |
|---|---|---|
| bg-primary | `#ffffff` | `#1a1a18` |
| bg-secondary | `#f5f5f4` | `#242422` |
| bg-tertiary | `#eeede9` | `#2e2e2b` |
| bg-info | `#eff5fc` | `#0c1f35` |
| bg-success | `#edf7f2` | `#071f18` |
| bg-warning | `#fef5e8` | `#201200` |
| bg-danger | `#fcebeb` | `#1f0808` |
| text-primary | `#1a1a18` | `#e8e6e0` |
| text-secondary | `#3d3d3a` | `#c2c0b6` |
| text-tertiary | `#73726c` | `#888780` |
| border-tertiary | `#dddbd6` | `#35342f` |
| brand-gradient | `#7C6FF7 → #4B9BF5` | `#7C6FF7 → #4B9BF5` |

### 5.2 状态语言

| 状态 | 颜色 | 图标建议 | 使用场景 |
|---|---|---|---|
| Healthy / Succeeded | `#1D9E75` | CircleCheck | 成功、健康、已安装 |
| Running / Active | `#2563eb` | LoaderCircle / Play | 执行、同步、Worker 活跃 |
| Waiting / Review | `#EF9F27` | Clock3 / ShieldQuestion | 审批、输入、待审查 |
| Degraded / Warning | `#BA7517` | TriangleAlert | 降级、版本不一致、迁移提醒 |
| Failed / Blocked | `#e5484d` | CircleX / Ban | 失败、阻断、安全拒绝 |
| Disabled / Read-only | `#73726c` | PauseCircle / LockKeyhole | 禁用、只读、历史兼容 |
| Info | `#534AB7` | Info | 诊断、版本、策略提示 |

状态必须使用“图标 + 文字 + 颜色”三重表达，不能只依赖颜色。

### 5.3 组件密度

- 系统无衬线字体；
- 表格支持 32px / 40px 两种行高；
- 圆角使用 4px、6px、10px、14px；
- 细边框和轻阴影；
- 品牌渐变仅用于 Logo、主 CTA、选中态和 Runtime 总览；
- Run ID、migration ID、content hash、duration 使用等宽字体；
- 图标采用 `lucide-react` 风格：线性、默认 16px，导航 18px。

## 6. 页面规格

### 6.1 Runtime Overview

**目的：** 让管理员/运维快速判断 Runtime 是否健康、是否需要处理审批、失败 Run、Worker、队列或发布问题。

**顶部：** Skills Runtime 标题、Workbench、Runtime 状态、暂停新 Run、打开诊断、发布检查。

**指标卡：** Runtime Health、Pending Approvals、Active Runs、Failure Budget。

**运行态：** Queue 泳道 `Queued → Running → Waiting → Succeeded / Failed`；Workbench 健康清单包含 Worker、Database、Artifact Store、Capability Broker、Event Stream、Legacy Adapter。

**异常区：** 最近异常 Run、最近审批、最近 Release / Migration、最近 Runtime Event。

**状态：** 首次加载骨架屏、无活动 Run、降级 Banner、只读模式、局部错误、队列积压警告。

### 6.2 Package Catalog

**顶部操作：** 导入 Skill、创建 Draft、导出清单；搜索 name、slug、source、version、hash。

**筛选：** All、Enabled、Disabled、Needs review、Risky capabilities、Legacy、Recently updated。

**表格：** Package、Runtime、Version、Installations、Capabilities、Risk、Status、Updated、Actions。

**抽屉：** 基本信息、当前版本、安装关系、能力声明与授权差异、最近 Run，支持打开详情、开始审查、禁用。

**状态：** 空态导入提示、scanner progress、版本冲突、禁用灰度、安全策略阻断。

### 6.3 Package Detail

**头部：** Package icon、name、slug、source、Runtime 标签、状态、风险、安装到 Workbench、刷新版本、禁用、删除、审查。

**Tabs：** Overview、Versions、Installations、Capabilities、Runs、Artifacts、Audit。

**关键规则：** 显示 `skillVersionId` 和 content hash；删除只删除安装关系；禁用不影响历史 Run；安装和启用前完成静态扫描与能力审查；High-risk 不允许普通启用按钮直接授权。

### 6.4 Run Explorer

**筛选：** created、validating、running、waiting_input、waiting_approval、interrupted、completed、completed_with_errors、failed、cancelled；Package/Version、Workbench、Agent、用户、时间、Capability、Artifact、重试。

**表格：** Run、Skill、Workbench、State、Duration、Capabilities、Artifacts、Started、Actions。

**交互：** 批量取消、失败重试预览、审批高亮、Run Summary Drawer、复制 runId/requestId/correlation ID。

### 6.5 Run Detail

**顶部：** Run 状态、Package + immutable Version、Workbench、Agent、触发者、时间、取消、批准并继续、拒绝能力、重试、导出审计。

**左侧：** 状态时间线。

**中间：** 事件流：package.loaded、file_loaded、step.started、step.completed、capability.requested、approval.required、capability.approved、capability.denied、capability.completed、artifact.created、run.failed/cancelled/succeeded。

**右侧：** Execution Context、Capability Summary、Artifacts。

**状态：** waiting_approval、waiting_input、interrupted、completed_with_errors、failed、cancelled 均提供对应操作或解释；取消不删除事件和产物。

### 6.6 Approval Queue

**摘要：** 待审批总数、High Risk、平均等待、超 SLO、自动拒绝策略。

**表格：** Request、Skill、Capability、Scope、Risk、Lifecycle、Requested by、Waiting、Actions。

**抽屉：** 原始声明、静态扫描、Run 上下文、Requested Scope、建议 Scope、现有 Grant、相似历史、影响范围、理由输入。

**动作：** Approve once、Approve session、Approve persistent、Reject。

**硬性约束：** requested 不等于 granted；只能批准 requested scope 子集；High Risk 默认禁止 persistent；审批幂等；拒绝必须让 Run 收敛；全部写入 Audit。

### 6.7 Capability Policies

**列表：** Capability、风险、默认开关、Scope 类型、默认生命周期、是否审批、是否允许 Workbench 覆盖、最近变更。

**详情：** requested/granted 说明、允许/禁止 Scope、生命周期、Surface、Policy 版本、拒绝原因。

**编辑器：** Risk Level、Enabled、Require Approval、Allowed Scope、Default Lifecycle、Max Duration、Max Calls、Max Bytes、Surface/Workbench Allowlist。

**保存预览：** 影响 Package、Installation、现有 Run，是否只影响新 Run，是否需要 reload。

### 6.8 Artifact Center

**筛选：** 文件名、sha256、runId、packageId、类型、保留状态、来源。

**表格：** Artifact、Source、Run、Integrity、Retention、Ownership、Status、Actions。

**抽屉：** 预览、sha256、创建事件、所属 Run/Version、Retention、下载审计、标记保留、导出、删除。

**规则：** 删除不删除历史 Run/Event；Orphan cleanup 先 Dry-run，再执行。

### 6.9 Creator / Draft Studio

**左栏：** All Drafts、My Drafts、Needs Review、Validation Failed、Ready to Publish、Published、Archived。

**中栏：** SKILL.md、manifest、references/assets 文件树、capabilities、version、changelog、preview。

**右栏：** Manifest Validation、文件限制、Capability Review、Path Policy、Security Scan、content hash、preview diff。

**门禁：** Preview 不自动 Publish；静态审查通过；immutable hash；验证失败禁用 Publish；发布需审查人和原因；新版本不覆盖旧版本。

### 6.10 Legacy Skills

**概览：** 数量、启停、失败、兼容风险、迁移推荐。

**列表：** Skill、Runtime、Compatibility、Last Run、Unified Run、Capabilities、Migration、Actions。

**详情：** 原始配置、统一 Input/Output、Capability/Event/Artifact、Legacy 直跑 Package 提示、迁移建议和对照预览。

### 6.11 Runtime Diagnostics

**Health：** liveness、readiness、Runtime、Worker heartbeat、Queue、Lease、Event Stream、Artifact Store。

**Database：** migration、history、schema checksum、database size、WAL/SHM、backup、restore rehearsal。

**Feature Flags：** Package execution、import、GitHub、npx、Creator、Creator publish、Image、Legacy、read-only。

**Metrics：** queue lag、lease expired、Run duration/status、retry/dead、approval wait、capability latency/error、artifact bytes、import reject reasons。

**诊断包：** 只包含脱敏 correlation、错误分类、指标和 schema 信息，不包含 token、cookie、resolved environment 和原始用户内容。

### 6.12 Release & Migration

**阶段：** Schema-only、Inspect-only、Install disabled、Worker shadow/dry-run、Package Run allowlist、GA。

**阶段卡：** Entry criteria、SLO、Error budget、Rollback trigger、Owner、Exit evidence、Decision。

**Migration：** 001–043 历史、当前/待执行、forward-fix、dry-run、backup/restore rehearsal、schema snapshot、暂停新 Run、只读模式。

**Rollback：** 不执行数据库 down migration；可回滚应用、关闭 Package execution、保留查询、Drain Worker、Orphan cleanup Dry-run；必须填写 incident ID、owner、原因。

### 6.13 Audit & Evidence

**事件：** install、enable、disable、grant、approve、reject、revoke、run、cancel、retry、artifact export、migration、release、rollback、feature flag、security decision。

**筛选：** actor、requestId、runId、Workbench、对象类型、时间。

**动作：** 查看脱敏事件、导出 JSON/CSV、生成发布验收证据、关联 Runbook/checklist。

## 7. 跨页面交互规则

1. Overview 异常卡片进入预过滤列表。
2. Package Detail、Run Detail、Artifact、Audit 之间始终保留关联对象链接。
3. Approval 完成后回到原 Run，展示状态已收敛。
4. 所有长任务展示持久化进度，不依赖页面存活。
5. 危险操作必须二次确认，并显示影响范围、操作者、对象和不可逆性。
6. 无权限动作采用 disabled + tooltip；Feature disabled 使用明确错误说明，不静默隐藏。
7. 只读模式保留查询、导出、事件和 Artifact 访问，禁用新执行和修改操作。

## 8. 统一状态矩阵

每个页面必须覆盖：

- Loading；
- Empty；
- Populated；
- Partial failure；
- Permission denied；
- Read-only；
- Feature disabled；
- Network/API error；
- Destructive confirmation；
- Long-running progress；
- Success feedback；
- Retryable error。

## 9. 数据映射建议

前端不自行推导安全结论，所有策略结果由服务端返回：

| UI 数据 | 服务端来源建议 |
|---|---|
| Package | `skill_packages` / Package API |
| Version | `skill_versions`、manifest、content hash |
| Installation | `skill_installations` |
| Run | `skill_runs_v2` / Run API |
| Event | `skill_run_events` / Event API |
| Queue | `skill_run_queue` / diagnostics |
| Grant | `skill_capability_grants` / Capability API |
| Artifact | `skill_artifacts` / Artifact API |
| Audit | Audit Repository / Audit API |
| Migration | migration table / diagnostics |
| Runtime state | health/readiness/metrics API |
| Feature flag | server capability summary |

推荐 API 读取方式：

- 页面列表采用分页、筛选和服务端排序；
- Run Detail 通过历史 Event + afterSeq/SSE 恢复；
- 所有操作返回 requestId、对象状态和可追踪错误码；
- 前端只展示服务端已脱敏的 payload；
- 所有跨角色数据范围由服务端会话解析，不信任用户提交的 ownerId/projectId。

## 10. 独立 HTML 原型验收标准

文件：`docs/skills/ui/skill-admin-control-plane-v1.1.html`

必须满足：

- 双击可打开，无构建依赖、无网络依赖；
- 左侧导航可切换全部 13 个页面；
- 三角色切换器可切换普通用户、管理员、运维人员；
- 切换角色后导航、数据范围和操作权限改变；
- 顶部上下文使用 Workbench，不出现 Workspace UI 文案；
- Light/Dark Mode 可切换；
- 使用 BloomAI 当前暖灰、白色、品牌渐变和状态色；
- 使用线性 Icon，状态同时显示图标、文字和颜色；
- 至少实现 Package Detail、Run Detail、Approval、Artifact、Migration 五类详情抽屉；
- 至少实现批准、拒绝、取消、重试、暂停新 Run、Dry-run、Rollback 确认弹窗；
- 包含 loading、empty、waiting、failed、read-only、feature-disabled、permission-denied 示例；
- 不修改 `docs/skills/ui/skill-management-console-v1.1.html`；
- 使用真实设计字段名，不能以无意义占位文案或占位页面代替。

## 11. 完成定义

- [ ] 设计规格已完成并通过评审；
- [ ] 独立 HTML 原型覆盖全部页面；
- [ ] 三角色权限边界可演示；
- [ ] Workbench 术语、BloomAI 配色和状态图标统一；
- [ ] 页面状态矩阵和危险操作均有可视化；
- [ ] 设计文件和 HTML 文件位于指定目录；
- [ ] 只提交本次新增文件，不影响用户已有修改和未跟踪文件。
