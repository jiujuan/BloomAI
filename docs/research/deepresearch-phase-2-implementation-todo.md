# BloomAI DeepResearch 第二阶段实施任务 TODO

> **文档状态**：待实施（编码任务拆分）  
> **编写日期**：2026 年 7 月 17 日  
> **依据文档**：[第二阶段技术分析与实施规划](./deepresearch-phase-2-technical-plan.md)  
> **范围**：覆盖分析、补充研究循环、断点恢复、协作式取消，以及支撑这些能力的状态、存储、接口、测试和运维交付。  
> **实施原则**：先统一状态与持久化边界，再接入覆盖/循环，随后启用恢复和取消的生产语义；每个里程碑通过定向测试和回归门禁后才进入下一阶段。

---

## 1. 用途、范围与完成定义

本文将技术规划拆分为可直接排期和编码的任务包。每个任务均明确目标、依赖、功能边界、预期修改与禁止修改的文件、实现要点、可验证链路、测试策略、风险控制与交付物。实施时以任务编号关联 PR、提交说明、测试报告和问题追踪。

### 1.1 第二阶段完成定义

第二阶段完成不等于“能再搜一轮”。以下条件必须同时满足：

1. **可解释覆盖**：每次覆盖判断有 policy/profile 版本、输入指纹、问题级 verdict、gap code、限制说明与停止理由。
2. **有界循环**：补充研究有轮次、预算预留、查询意图、收益判断和硬停止条件；没有无限递归或仅按新增条数循环。
3. **可恢复**：进程中断或 lease 过期后，系统能从数据库检查点找到安全 cursor，并避免重复已成功的查询、抓取、快照、证据和报告副作用。
4. **可信取消**：取消请求立即可见为 `cancelling`，运行操作可 abort 或在安全边界停止；最终只由受控路径进入 `cancelled`。`cancelled` 为终态，不能 resume。
5. **并发与幂等**：同一 Run 同时只有一个有效 attempt 持有 lease；start/resume/cancel 重放不重复创建 attempt 或重复派发昂贵操作。
6. **产品一致性**：HTTP、SSE、store 和 UI 都以服务端 capability 为准；`interrupted` 和 retryable failure 可恢复，`cancelled` 不显示恢复动作。
7. **可发布质量**：迁移、单元、仓储、workflow、故障注入、API/SSE、Renderer、第一阶段回归、typecheck 和 build 全部通过；日志、事件和 telemetry 不泄露正文、绝对路径或 secret。

### 1.2 不在范围内

- 重做第一阶段 Research Tab 路由，或重建 `ResearchRun`、来源、证据等基础表；
- 替换 Search / Fetch / LLM Provider；
- 重写报告章节生成算法或改造成无限制多 Agent 网络；
- 用真实网络测试替代确定性的 fake provider / frozen fixture；
- 改写既有迁移的历史语义。

### 1.3 实施前置结论与工作区边界

- 已有 `008-deep-research-core.sql` 和 `009-deep-research-recovery-commands.sql`，故本阶段新的韧性迁移使用 **`010-deep-research-resilience.sql`**；新增前仍须复核当前最大编号。
- `package.json` 声明的 `db:migrate` 是 `node scripts/db-migrate.js`，但当前仓库没有该脚本。DR2-00 必须先补齐或改正入口，才能把迁移命令作为验收依据。
- 工作区存在可能与报告、章节和来源展示有关的并行修改。不得重置、覆盖、格式化或顺带改写它们。

### 1.4 全局受保护文件

除 DR2-15 的最小挂载点外，下列文件默认不修改；若必须触及，应先单独确认冲突和所有权：

- `src/renderer/pages/Chat/deepresearch/ResearchReportView.tsx`
- `src/renderer/pages/Chat/deepresearch/ResearchReportView.test.ts`
- `src/renderer/pages/Chat/deepresearch/research-source-context.ts`
- `src/renderer/pages/Chat/deepresearch/research-source-context.test.ts`
- `src/server/mastra/deepresearch/agents/report-translator.ts`
- `src/server/mastra/deepresearch/agents/report-translator.test.ts`
- `src/server/mastra/deepresearch/agents/section-writer.ts`
- `src/server/mastra/deepresearch/agents/section-writer.test.ts`
- `src/server/mastra/deepresearch/steps/draft-sections.ts`
- `src/server/mastra/deepresearch/steps/draft-sections.test.ts`
- `src/server/mastra/deepresearch/steps/extract-claims.ts`
- `src/server/mastra/deepresearch/steps/section-evidence.ts`
- `scripts/migrations/008-deep-research-core.sql`
- `scripts/migrations/009-deep-research-recovery-commands.sql`

---

## 2. 里程碑、依赖与交付节奏

```mermaid
flowchart LR
  A0["DR2-00 迁移运行器基线"] --> A1["DR2-01 共享契约与状态机"]
  A0 --> A2["DR2-02 韧性迁移与 Schema"]
  A1 --> A3["DR2-03 仓储"]
  A2 --> A3
  A3 --> A4["DR2-04 幂等命令服务"]
  A4 --> B1["DR2-05 Coverage Policy V2"]
  B1 --> B2["DR2-06 Assessment 持久化"]
  B2 --> C1["DR2-07 Iteration 决策与预算"]
  C1 --> C2["DR2-08 幂等检索与步骤拆分"]
  C2 --> C3["DR2-09 有界循环 Workflow"]
  A4 --> D1["DR2-10 Attempt-aware Executor"]
  C3 --> D2["DR2-11 Checkpoint Cursor 恢复"]
  D1 --> D2
  D2 --> D3["DR2-12 Recovery 与对账"]
  D1 --> E1["DR2-13 协作式取消"]
  D3 --> E2["DR2-14 HTTP、SSE 与 DTO"]
  E1 --> E2
  E2 --> E3["DR2-15 生命周期 UI"]
  E3 --> E4["DR2-16 回归、NFR 与运维"]
```

| 里程碑 | 任务 | 阶段验收门槛 |
| --- | --- | --- |
| 2A：状态与持久化基础 | DR2-00 ～ DR2-04 | 可运行迁移、兼容 schema、事务化仓储、状态机和命令幂等可独立验证。 |
| 2B：Coverage V2 | DR2-05 ～ DR2-06 | 覆盖结果确定、版本化、可审计，旧 DTO 仍可读取。 |
| 2C：有界补充循环 | DR2-07 ～ DR2-09 | 每轮具有计划、预算、收益、停止理由和限制说明。 |
| 2D：恢复与执行器 | DR2-10 ～ DR2-12 | 断点恢复不重复昂贵副作用，自动恢复竞争安全。 |
| 2E：取消、产品表面与交付 | DR2-13 ～ DR2-16 | 取消可靠、API/UI 一致、NFR 与全量测试闭环。 |

---

# 里程碑 2A：状态与持久化基础

## DR2-00：修复迁移运行器并建立迁移回归基线

- **目标**：让数据库迁移有真实、可重复、可在临时 SQLite 数据库执行的入口，为后续 `010` 迁移提供可信验收条件。
- **依赖**：无。
- **实现功能**：盘点 DB 初始化/迁移调用链；补齐 `scripts/db-migrate.js` 或将 `db:migrate` 指向真实入口；按数字前缀稳定排序并记录已执行版本；支持重复执行；建立空库与第一阶段旧库升级测试。
- **修改/新增代码和文件**：`scripts/db-migrate.js`（或实际入口）、必要时 `package.json`、现有 migration loader；新增 `src/server/db/migrations.test.ts`（实际目录按项目规范）。
- **明确不修改**：`008`、`009` 历史迁移；DeepResearch workflow、业务仓储、Renderer 和报告/章节文件。
- **实现要点**：测试只用临时数据库路径；迁移记录表防止同一脚本重复应用；出错能定位具体迁移文件；命令不得默连开发者长期数据库。
- **功能验收与可验证链路**：`空库 → db:migrate → 核对版本记录/表 → 再次执行 → 无重复；第一阶段 fixture DB → db:migrate → 旧 Run/来源/证据仍可读`。
- **功能测试策略**：空库一次/两次执行、已有 `008/009` 数据升级、排序/遗漏脚本、错误 SQL 定位 fixture。
- **风险与缓解**：入口可能在未预期路径，先画调用链；误升级本地 DB，要求显式配置且测试隔离；迁移编号冲突，提交前再次扫描目录。
- **最终交付物**：可运行的 `npm run db:migrate`、迁移回归测试、`010` 编号基线。

## DR2-01：扩展共享契约并统一 Run/Attempt 状态机

- **目标**：让 Run、Attempt、Checkpoint、Iteration、Coverage Assessment、Loop Decision、取消/恢复 capability 有稳定、兼容、可验证的共享语义。
- **依赖**：DR2-00。
- **实现功能**：新增 V2 DTO/schema；定义 Run/Attempt 状态及错误分类；将 `resumePhase` 收敛为 checkpoint cursor 的兼容投影；明确 `cancelled` 为终态，仅 `interrupted` 与 retryable `failed` 可恢复；输出服务端计算的 action capabilities。
- **修改/新增代码和文件**：修改 `src/shared/deepresearch/contracts.ts`、`schemas.ts`、`events.ts`、`index.ts`；修改或新建 `src/server/deepresearch/domain/state-machine.ts`、`errors.ts`、`attempt-state.ts`、`checkpoint-types.ts` 及测试。
- **明确不修改**：数据库迁移、Provider、`ResearchReportView`、报告章节生成与 UI 展示逻辑。
- **实现要点**：状态转换由纯领域函数集中裁决，workflow/UI/route 不得各自猜测；`cancelling` 优先于正常 completion/failure；旧 `ResearchCoverageDto` 保留投影；新增字段先可选并定义默认语义。
- **功能验收与可验证链路**：`旧 Run DTO → schema 解析 → 新状态能力投影 → cancelled 不可 resume；interrupted/retryable failed 有 resume capability`。
- **功能测试策略**：合法/非法转换；cancel 与 complete/fail 竞争；retryable/non-retryable；旧 payload/事件缺 V2 字段仍可解析。
- **风险与缓解**：破坏旧客户端，新增不删除字段；状态分散，只导出一个状态机入口；UI 未同步，先以服务端 capability 为真相。
- **最终交付物**：Versioned contracts、状态迁移矩阵、状态机与兼容性单测。

## DR2-02：新增韧性迁移与 Schema 映射

- **目标**：为 attempt、checkpoint、iteration、assessment、取消请求、stop reason 与乐观并发建立数据库真相源。
- **依赖**：DR2-00、DR2-01。
- **实现功能**：新增 `research_run_attempts`、`research_run_checkpoints`、`research_iterations`、`research_coverage_assessments`（或等价版本化表）；为 `research_runs` 追加 `state_version`、当前 attempt、取消请求、stop reason、limitations 等列；增加外键、唯一约束和查询索引。
- **修改/新增代码和文件**：新建 `scripts/migrations/010-deep-research-resilience.sql`；修改 `src/server/db/schema.ts` 与 DB 类型映射；新增 schema/迁移测试。
- **明确不修改**：`008`、`009`；既有 sources/evidence 表的历史字段语义；报告/章节 UI。
- **实现要点**：只追加表/列/索引，禁止重建第一阶段表；checkpoint 以 `(attempt_id, sequence)` 唯一；attempt 存 trigger、workflowRunId、lease/ownership、时间、错误分类；iteration 存预算、前后 assessment、计划、决策和 limitations；legacy Run 无 checkpoint 时保守从 planning 恢复。
- **功能验收与可验证链路**：`第一阶段 fixture DB → 010 升级 → 读取旧 Run → 创建 attempt/checkpoint/iteration/assessment → 查询关联和默认值`。
- **功能测试策略**：旧库升级、外键/默认值/唯一性/索引、重复迁移、legacy detail/cancel/resume capability。
- **风险与缓解**：SQLite ALTER 限制，仅用受支持追加；历史值为空用 nullable+fallback；编号冲突提交前复核。
- **最终交付物**：`010` 迁移、TypeScript schema、legacy migration 回归测试。

## DR2-03：实现 Attempt、Checkpoint、Iteration 与 Assessment 仓储

- **目标**：建立循环、恢复、审计和副作用去重的数据访问边界，保证状态、事件和检查点的一致提交。
- **依赖**：DR2-01、DR2-02。
- **实现功能**：创建/获取/结束 attempt、查找活动 attempt；追加不可变 checkpoint、查最新兼容 cursor；创建/更新 iteration 和预算账；保存/读取 assessment；用 `state_version` 做 CAS；将 Run/Attempt 转换、event、关键 checkpoint 组合为事务。
- **修改/新增代码和文件**：新建 `research-attempt.repo.ts`、`research-checkpoint.repo.ts`、`research-iteration.repo.ts`、`research-coverage-assessment.repo.ts`；修改 `research-run.repo.ts`、`research-event.repo.ts`、`repository-utils.ts`；新增 repository 测试。
- **明确不修改**：`deep-research.service.ts`、`executor.ts`、`workflow.ts` 的业务编排；Renderer；报告生成步骤。
- **实现要点**：checkpoint 包含 attempt、phase、sequence、input/output fingerprint、cursor、replay rule、关联实体 cursor；ownership-sensitive 写入带 attempt/lease 条件；event 与状态转换同事务；正文保留在 snapshot/artifact，checkpoint 只存 hash/ID/摘要。
- **功能验收与可验证链路**：`创建 Run → Attempt → checkpoint → 读取 cursor → 两个 writer 同版本更新 → 仅一方成功且有匹配 event`。
- **功能测试策略**：sequence 唯一、同幂等键重写、CAS 冲突、失去 ownership 无法写完成 checkpoint、事务失败无半更新。
- **风险与缓解**：仓储 API 泄露 SQL，暴露领域方法；payload 过大，保存引用；事件状态漂移，强制事务入口。
- **最终交付物**：四类仓储、事务转换基础设施、仓储一致性测试。

## DR2-04：重构命令服务，统一 start/resume/cancel 的幂等入口

- **目标**：使 service/facade 成为唯一业务命令入口，避免 API、Recovery、Executor 分别修改 Run 状态。
- **依赖**：DR2-03。
- **实现功能**：`startRun` 创建首 attempt/初始 checkpoint；`resumeRun` 从兼容 cursor 新建 attempt；`cancelRun` 持久化请求并转 `cancelling`，不伪造 `cancelled`；支持 client command/idempotency key；返回 action capability、phase、attempt、cursor、stop reason。
- **修改/新增代码和文件**：修改 `src/server/deepresearch/deep-research.service.ts`、`index.ts`、`research-event-publisher.ts` 及测试；可新建 `commands.ts`、`commands.test.ts`。
- **明确不修改**：HTTP routes、Renderer、Mastra step 具体实现、报告章节代码。
- **实现要点**：首次、人工恢复、自动恢复共用 attempt 规则但 trigger 不同；command key + state CAS 双重去重；`cancelled` 永不返回 resume；命令服务只创建 dispatch 请求，不直接运行 workflow。
- **功能验收与可验证链路**：`相同 start/resume/cancel 重放 → 同一逻辑结果 → 不重复 attempt/dispatch；cancelled resume → 明确领域错误`。
- **功能测试策略**：start 重放、并发 resume、cancel 重放、两类 failed、legacy fallback。
- **风险与缓解**：旧 API 直接改状态，保留外形但内转 command service；并发用 CAS+command key+attempt 约束；UI 按 capability。
- **最终交付物**：统一命令服务、幂等测试、Run/Attempt 生命周期基础闭环。


---

# 里程碑 2B：Coverage Policy V2

## DR2-05：实现确定性 Coverage Policy V2

- **目标**：把分散的评分和字符串 gaps 升级为版本化、可解释、可测试的领域判断。
- **依赖**：DR2-04。
- **实现功能**：定义 `general`、`market`、`competitor`、`academic` profile；依据证据充分性、来源独立性、权威性/类型、时效、正反证据、矛盾和问题优先级，计算 score、verdict、gap codes、可补救性、建议检索意图和 material gain；支持单一权威来源例外。
- **修改/新增代码和文件**：新建 `src/server/deepresearch/domain/coverage-policy.ts`、`coverage-profiles.ts`、对应测试；修改 `src/server/services/deepresearch/evidence-service.ts` 及测试；必要时扩展 shared contracts。
- **明确不修改**：`gap-analyst.ts` 的提示词主体、workflow 循环、Provider、报告/章节 UI。
- **实现要点**：policy 是纯函数；模型只提供候选 gap/query，不拥有最终 verdict；assessment 输入必须可 fingerprint（证据集合版本、policy/profile 版本、优先级）；material gain 同时观察分数变化和关键问题 verdict 是否改善。
- **功能验收与可验证链路**：`冻结证据集 + 指定 profile/priority → 稳定返回 score/verdict/gap code/remediation/material gain`。
- **功能测试策略**：同域名低质量证据不能伪造独立覆盖；高优先级缺独立权威来源；单一权威例外；过期来源；缺反证据/矛盾；profile 差异；低价值新增不构成 gain。
- **风险与缓解**：大函数难维护，权重/阈值/计算分离；规则变更不可解释，记录版本；模型漂移，门禁仅在确定性领域层。
- **最终交付物**：Coverage Policy V2、四 profile fixture、可持久化 assessment 结果结构。

## DR2-06：持久化 Assessment 并投影问题覆盖状态

- **目标**：令每次覆盖评估可审计，并使问题树的兼容 coverage 摘要来自最新 assessment 投影而非步骤随意写入。
- **依赖**：DR2-05。
- **实现功能**：持久化版本化 assessment；将最新结果投影到 question 的旧 `ResearchCoverageDto`；保存 unresolved contradiction、limitations、gap codes；assessment 与投影成功后写 event/checkpoint。
- **修改/新增代码和文件**：修改 `evidence-service.ts`、`research-question.repo.ts`、`research-event.repo.ts`、`src/server/mastra/deepresearch/steps/assess-coverage.ts`、`steps/types.ts`；使用 DR2-03 的 assessment repo；新增单元/集成测试。
- **明确不修改**：`ResearchQuestionTree.tsx` 的结构/样式、`ResearchReportView.tsx`、`gap-fill-iteration.ts`（本任务不改循环）。
- **实现要点**：assessment 绑定 run、attempt、iteration（初始评估可无 iteration）；assessment 写入和问题投影同事务或可重试事务；相同输入 fingerprint 不重复保存等价结果；checkpoint 在全部业务写入后追加。
- **功能验收与可验证链路**：`证据落库 → assess-coverage → assessment → 问题投影 → event/checkpoint → detail API 同时读取 V1 与 V2`。
- **功能测试策略**：assessment 失败不能半更新问题；等价输入去重；新 assessment 覆盖旧投影；旧 DTO 投影正确；event/checkpoint 完整。
- **风险与缓解**：assessment/问题状态分叉，用仓储事务；表膨胀，仅存证据 ID/统计/hash/摘要；前端抢跑，V1 DTO 继续可用。
- **最终交付物**：Assessment 审计链、问题覆盖投影、V1/V2 兼容测试。

---

# 里程碑 2C：有界补充研究循环

## DR2-07：实现 Iteration 计划、预算预留与停止决策

- **目标**：将“是否继续补充研究”变成受预算、可解释、可持久化的领域决策。
- **依赖**：DR2-06。
- **实现功能**：按 gap priority、可补救性、预期价值生成 iteration plan；预留 search/fetch/model/轮次预算；规范 stop reason：coverage reached、budget exhausted、max iterations、no actionable gaps、no material gain、cancellation requested、blocked/unrecoverable；生成最终 limitations。
- **修改/新增代码和文件**：新建 `src/server/deepresearch/domain/iteration-decision.ts`、`budget-reservation.ts` 及测试；修改 `domain/budgets.ts`、`research-iteration.repo.ts`；仅为结构化输入适配 `gap-analyst.ts`。
- **明确不修改**：`workflow.ts`、`gap-fill-iteration.ts`、所有 Provider、报告章节代码。
- **实现要点**：决策输入包括当前/上一 assessment、历史 iteration、消耗和预留预算、取消状态；不可补救或 blocked gap 不再重复派发；先预留后执行，失败/取消结算未用余额；每个 stop decision 持久化命中的规则与输入摘要。
- **功能验收与可验证链路**：`assessment → iteration plan → budget reserve → continue/stop decision → limitations`。
- **功能测试策略**：初始达标零 iteration；关键 gap 但预算不足；连续两轮无 gain；有 gap 无可执行 query；取消优先；最大轮次。
- **风险与缓解**：单看证据数会死循环，以 gain/预算/可行动性联合决策；结束才算预算会超支，采用预留结算；停止不可解释，持久化决策。
- **最终交付物**：Iteration Decision 服务、stop reason/limitations 规范、预算/停止矩阵测试。

## DR2-08：拆分补充研究步骤并实现查询、来源、证据幂等性

- **目标**：使单轮补充研究成为可恢复的最小事务，避免内存数组位置或重复请求造成副作用重复。
- **依赖**：DR2-07。
- **实现功能**：将循环拆为 `plan-iteration`、`execute-iteration-retrieval`、`assess-iteration`；实现 query fingerprint、canonical URL/source fingerprint、snapshot content hash、evidence fingerprint 和步骤 idempotency key；复用完成实体，仅重试未完成部分。
- **修改/新增代码和文件**：新建 `src/server/mastra/deepresearch/steps/plan-iteration.ts`、`execute-iteration-retrieval.ts`、`assess-iteration.ts`、`src/server/deepresearch/domain/idempotency.ts`；修改 `gap-fill-iteration.ts`（兼容包装或移除调用）、`search-service.ts`、`content-service.ts`、`evidence-service.ts` 和相关 repositories/tests。
- **明确不修改**：`draft-sections.ts`、`section-evidence.ts`、报告 UI、报告 artifact 展示。
- **实现要点**：同 run/iteration/intent/query/profile/time scope 的 fingerprint 复用；canonicalization 集中且保守，保留原 URL；副作用请求/成功/失败/取消均能由 checkpoint/repository 判定；不得以 loop index 作幂等键。
- **功能验收与可验证链路**：`补充 query → search/fetch → source/snapshot → evidence → iteration result → 重放同输入 → 无重复 query/source/snapshot/evidence`。
- **功能测试策略**：同 query 重放；等价 URL；同 content hash；search 成功但更新前崩溃；snapshot 成功但 checkpoint 前崩溃；恢复后 fake provider 调用次数不增加。
- **风险与缓解**：过度 URL 合并，保守规则并留原始 URL；幂等键过宽漏检索，包含 intent/profile/time/input version；步骤变多，统一 IterationContext。
- **最终交付物**：结构化迭代步骤、幂等副作用协议、故障注入测试。

## DR2-09：将 Workflow 接入有界、持久化补充循环

- **目标**：把现有简单 do-until 形态升级为由 assessment、iteration 和 stop decision 驱动的有限闭环。
- **依赖**：DR2-08。
- **实现功能**：workflow 按“初始 assessment → 0..N plan/retrieval/iteration assessment → stop decision → outline/synthesis/verification”编排；每轮持久化 event/checkpoint/预算；最终输出 `completed` 或 `completed_with_limitations`，带 stop reason/limitations。
- **修改/新增代码和文件**：修改 `src/server/mastra/deepresearch/workflow.ts`、`workflow-context.ts`、`steps/load-run.ts`、`steps/types.ts`、workflow 测试；新增 bounded-loop 集成测试。
- **明确不修改**：`draft-sections.ts`、`section-evidence.ts`、`repair-report.ts`、`finalize-skeleton.ts` 及 report/section Renderer。
- **实现要点**：workflow 只编排，DB 是业务真相；每轮落库后才能继续；max iteration 和预算是硬门槛；旧 Run 无 iteration/checkpoint 时走兼容初始路径；不可继续时必须生成 limitations。
- **功能验收与可验证链路**：`初始研究 → assessment → 0..N iterations → stop → 综合/验证 → completed 或 completed_with_limitations`。
- **功能测试策略**：初始达标；关键 gap 正确意图；同域新增无 gain；预算耗尽无额外调用；contradiction 触发反证据意图；max iterations 有限结束。
- **风险与缓解**：影响第一阶段主链，保留 step contract 后渐进替换；结果类型膨胀，稳定 IterationContext；真实网络不稳，fake provider/frozen fixture。
- **最终交付物**：有界循环 workflow、coverage/budget/no-gain 集成测试、可展示 limitations 数据。


---

# 里程碑 2D：执行器、检查点和恢复

## DR2-10：将 Executor 改造成 Attempt-aware、Lease-aware 执行器

- **目标**：让 executor 专注 lease、heartbeat、AbortController 与异常分类，不再自行推断恢复阶段或绕过命令服务。
- **依赖**：DR2-04。
- **实现功能**：lease 从 run 扩展为 attempt；每次执行生成 ownership token；创建 execution context（attemptId、token、signal、resumeCursor）；实现 heartbeat/租约过期处理；分类 cancellation、interruption、retryable/non-retryable failure；拒绝被新 attempt 取代的旧 executor 写终态。
- **修改/新增代码和文件**：修改 `src/server/deepresearch/executor.ts`、`deep-research.service.ts` 及测试；新建 `executor.test.ts`，必要时 `attempt-execution-context.ts`。
- **明确不修改**：workflow 循环规则；Provider 取消细节（DR2-13）；Renderer 和报告/章节文件。
- **实现要点**：heartbeat 使用短事务；所有完成/失败写入前重新检查 lease ownership 与取消请求；workflow 接收 attempt 语境而非仅 runId；executor 通过 command/repository 领域入口写状态。
- **功能验收与可验证链路**：`创建 attempt → 获得 lease → heartbeat → 正常完成/失去 lease/抛异常 → 只产生一个正确终态`。
- **功能测试策略**：并发 executor 竞争；heartbeat 延长 lease；旧 executor completion 被拒；异常分类；ownership token 缺失/不符。
- **风险与缓解**：TTL 过短误抢占，统一 TTL/heartbeat 并用 fake clock；executor 承担业务状态，禁止直接 SQL；旧 attempt 残留写，所有写入带 ownership 条件。
- **最终交付物**：Attempt-aware executor、执行上下文契约、lease/heartbeat/异常测试。

## DR2-11：实现 Checkpoint Cursor 驱动的 Workflow 恢复

- **目标**：中断后从最近的有效安全边界继续，而不是始终从 planning 重跑。
- **依赖**：DR2-09、DR2-10。
- **实现功能**：定义 cursor/replay rule；`load-run` 读取 resume cursor；在 planning、search、fetch、evidence、coverage/iteration、outline、synthesis/finalization、verification 等昂贵副作用或阶段边界写 checkpoint；恢复时跳过成功步骤或重放最小安全单元。
- **修改/新增代码和文件**：修改 `steps/load-run.ts`、`workflow.ts`、`workflow-context.ts`，以及 `plan-questions.ts`、`plan-queries.ts`、`execute-searches.ts`、`fetch-sources.ts`、`extract-evidence.ts`、`assess-coverage.ts`；新增 checkpoint/resume 集成测试。
- **明确不修改**：报告/章节算法文件；报告 Renderer；不重构 section 生成，仅允许在其外层记录/读取阶段 checkpoint。
- **实现要点**：checkpoint 只能在对应 DB 写入完成后落库；恢复以 BloomAI DB 为主、Mastra state 为辅助诊断；profile/policy/input 版本不兼容时显式失效并回退安全边界；读取 cursor 前做实体完整性检查，防止“假成功 checkpoint”。
- **功能验收与可验证链路**：`每个安全边界注入崩溃 → 新 attempt resume → 已完成 query/fetch/evidence 不重复 → 最终报告/状态正确`。
- **功能测试策略**：search 后 query 更新前；snapshot 后 checkpoint 前；evidence 后 assessment 前；iteration 后 outline 前；artifact 已生成未登记；版本不兼容 cursor。
- **风险与缓解**：粒度太细，限定昂贵副作用和阶段边界；cursor/实体分叉，恢复前 reconciliation；误跳过，保存 fingerprint 与实体 cursor。
- **最终交付物**：Resume cursor 协议、checkpoint-aware workflow、崩溃恢复矩阵。

## DR2-12：扩展启动恢复协调器并实现副作用/Artifact 对账

- **目标**：应用重启和 lease 过期后，安全标记中断 attempt、去重恢复、对账孤儿副作用，并且不自动恢复 cancelled Run。
- **依赖**：DR2-11。
- **实现功能**：扫描过期 attempt lease；将 attempt/Run 转为 interrupted；创建去重 auto-resume command；检查 checkpoint 与 query/source/snapshot/evidence/artifact 一致性；补登记可验证 orphan artifact 或安全重建；写 reconciliation event/诊断。
- **修改/新增代码和文件**：修改 `src/server/deepresearch/recovery.ts`、`recovery.test.ts`、`src/server/services/deepresearch/artifact-service.ts`、`research-report.repo.ts`；新建 `reconciliation.ts`、`reconciliation.test.ts`。
- **明确不修改**：`ResearchReportView.tsx`、报告生成/渲染实现、`009` 历史迁移（需要字段时新增后续迁移）。
- **实现要点**：recovery 只能调用 DR2-04 command service，不得直接 workflow dispatch；对账必须幂等；artifact 必须校验 run/attempt/fingerprint/时间和登记状态，不能因文件存在即认定报告完成；non-retryable failed 与 cancelled 均不自动恢复。
- **功能验收与可验证链路**：`执行中关机 → 启动 recovery → 发现失效 lease → interrupted → 读取 checkpoint → 仅一个恢复 attempt → 对账后完成`。
- **功能测试策略**：多个 coordinator 并发；auto-resume command 重放；snapshot/artifact 孤儿；cancelled/non-retryable 不恢复；恢复后实体数、报告内容、事件序列无重复。
- **风险与缓解**：重复 dispatch，用 command key + attempt 唯一 + lease 三层保护；错误认定孤儿，用归属/fingerprint 联合校验；跨入 UI，对账仅服务端。
- **最终交付物**：Recovery coordinator V2、reconciliation 服务、自动恢复和孤儿 artifact 回归测试。


---

# 里程碑 2E：取消、接口、UI、回归与运维

## DR2-13：实现协作式取消闭环与 AbortSignal 传播

- **目标**：让取消从“状态修改”变成可靠执行协议：立即可见、尽快中止、取消后不继续写下游副作用。
- **依赖**：DR2-10。
- **实现功能**：cancel command 记录请求；executor 观察请求并 `AbortController.abort()`；Search、Fetch、模型调用传递 `AbortSignal` 或前后安全边界检查；完成/失败与取消仲裁；释放未用预算、结束 attempt、写 checkpoint/event。
- **修改/新增代码和文件**：修改 `executor.ts`、`deep-research.service.ts`、`search-service.ts`、`content-service.ts`、相关 LLM adapter 和非 report 核心步骤；新建 `src/server/deepresearch/domain/cancellation.ts`、`cancellation.test.ts`。
- **明确不修改**：Renderer（DR2-15）、`ResearchReportView.tsx`、报告/章节生成算法本身；仅允许外层遵循 signal/guard。
- **实现要点**：取消后禁止开始新的 search/fetch/LLM；provider 不支持 abort 时，在返回后的首个安全边界停止且不写 evidence/report；取消不是 failure；complete/fail 前检查 cancellation + ownership；重复 cancel 安全。
- **功能验收与可验证链路**：`运行中 → cancel → cancelling → signal/guard → in-flight 请求停止或边界停止 → attempt close → cancelled`。
- **功能测试策略**：在 planning、search、fetch、extraction、draft、finalization 六个注入点取消；断言无新 provider 调用、不会进入 completed/failed、cancel-finalize race 只可能 cancelled、cancelled 不可 resume。
- **风险与缓解**：Provider 不支持 abort，边界 guard；异步回写，ownership+cancellation 条件；用户误以为可恢复，capability/UI 明确终态，未来另设 fork/new-from-run。
- **最终交付物**：取消领域协议、signal 传播、竞争与注入点测试。

## DR2-14：扩展 HTTP API、SSE 事件和查询 DTO

- **目标**：让客户端可读取并正确操作 attempt、checkpoint、coverage、iteration、budget、stop reason、limitations 和 action capability。
- **依赖**：DR2-12、DR2-13。
- **实现功能**：Run detail 返回当前/历史 attempt 摘要、resume checkpoint、assessment、iteration history、budget、stop reason、limitations、canCancel/canResume；新增 attempt/checkpoint/iteration/cancellation/reconciliation 事件；保持 start/get/list/cancel/resume 向后兼容。
- **修改/新增代码和文件**：修改 `src/server/http/routes/deep-research.ts`、其测试、`src/shared/deepresearch/contracts.ts`、`events.ts`、`research-event-publisher.ts`；新增 API/SSE contract tests。
- **明确不修改**：报告/来源/证据 Renderer 与所有章节生成文件。
- **实现要点**：不暴露 lease token、绝对文件路径、抓取正文或 secret；detail 返回摘要，历史按需分页；SSE event 有稳定 ID，store 可去重；action 可用性严格由服务端计算。
- **功能验收与可验证链路**：`GET detail / 订阅 SSE → lifecycle 数据 → cancel/resume API → 状态、capability、事件一致`。
- **功能测试策略**：旧/新 DTO；cancelled 不可恢复；interrupted 显示 cursor；SSE schema 与重放去重；敏感字段不出现；分页/空历史。
- **风险与缓解**：payload 膨胀，摘要+分页；前后端判断不一致，capability 单一来源；事件演进破坏客户端，加字段不删字段、版本化可选。
- **最终交付物**：API/SSE V2、HTTP/契约测试、稳定前端消费模型。

## DR2-15：实现隔离式研究生命周期 UI 集成

- **目标**：在不侵入并行报告/章节改动的前提下，展示覆盖、迭代、恢复、取消和限制信息，并让按钮与服务端能力一致。
- **依赖**：DR2-14。
- **实现功能**：新增独立 Lifecycle Panel，显示 phase、attempt 编号、resume checkpoint、cancelling/cancelled/interrupted、预算、stop reason、limitations；store 接收 V2 DTO、按 event ID 去重；仅按 capability 显示动作；cancelled 不显示恢复。
- **修改/新增代码和文件**：新建 `src/renderer/pages/Chat/deepresearch/ResearchRunLifecyclePanel.tsx` 与测试；修改 `deep-research.types.ts`、`deep-research.store.ts` 及测试；最小修改 `DeepResearchRunView.tsx` 只挂载 panel。
- **明确不修改**：`ResearchReportView.tsx`、`ResearchRunPart.tsx`、`ResearchSourcesPanel.tsx`、`ResearchEvidencePanel.tsx`、`ResearchQuestionTree.tsx`、所有 report/section 后端步骤。
- **实现要点**：开始前复查 git diff；受保护 UI 有并行改动时先保持 panel 独立，挂载点仅最小 diff；组件只读展示+调用 API action，不复制状态机；文案明确区分 cancellation、interruption、retryable/non-retryable failure。
- **功能验收与可验证链路**：`detail/SSE → store 去重投影 → Lifecycle Panel → 按 capability cancel/resume → 状态刷新`。
- **功能测试策略**：cancelling 禁用重复取消；cancelled 无 resume；interrupted 显示 cursor；failure 可恢复性差异；SSE 重放不重复活动/iteration；报告、来源、证据、问题树既有快照未变化。
- **风险与缓解**：并行 UI 冲突，新增组件+最小挂载；轮询/SSE 重复，event ID/version；UI 复制后端规则，只消费 capability。
- **最终交付物**：独立 Lifecycle Panel、store/UI 一致性测试、受保护 UI 最小变更记录。

## DR2-16：完成回归、非功能验收、Telemetry 与运维交付

- **目标**：让第二阶段达到可诊断、可回归、可安全发布的工程状态。
- **依赖**：DR2-15。
- **实现功能**：记录 coverage verdict/score 分布、iteration 数/增量、stop reason、预算耗尽、no-gain、取消延迟、取消后外调次数、恢复成功率、checkpoint reuse、lease 拒绝写入、attempt/端到端耗时；编写恢复/取消/孤儿 artifact/迁移回归运维手册；建立 acceptance suite 和测试矩阵。
- **修改/新增代码和文件**：现有 telemetry/observability 代码及测试；新建 `src/server/deepresearch/deep-research.phase2.acceptance.test.ts`、`docs/research/deepresearch-phase-2-operations.md`、`docs/research/deepresearch-phase-2-test-matrix.md`。
- **明确不修改**：第一阶段基础迁移、Search/Fetch/LLM Provider 的替换、报告/章节算法和其 UI。
- **实现要点**：telemetry 仅含枚举、计数、时长、安全摘要/hash，不含正文、附件绝对路径、敏感 URL query 或 secret；CI 使用 fake clock/frozen fixture/fake provider；真实网络只作独立手工或夜间验证；关键场景成为 release gate。
- **功能验收与可验证链路**：`迁移 → 初始研究 → Coverage → Iteration → crash/resume → cancel → HTTP/SSE → UI → full regression`。
- **功能测试策略**：见第 4、5 节；最终运行 typecheck、architecture test、test、build，迁移在临时库执行。
- **风险与缓解**：live web flaky，冻结 fixture；指标泄露，字段白名单/payload 检查；遗漏第一阶段回归，纳入发布门禁。
- **最终交付物**：acceptance suite、运维手册、Telemetry 字段说明、验收记录和发布清单。


---

## 3. 跨任务决策、取舍与文件所有权

### 3.1 高影响决策

| 决策 | 选择 | 原因与实施约束 |
| --- | --- | --- |
| 业务真相源 | BloomAI DB checkpoint 为主，Mastra state 仅辅助 | 外部 workflow state 可能丢失或版本不兼容；恢复必须可脱离 Mastra 进行。 |
| Run 与执行 | Run 与 Attempt 分离 | Run 是用户研究档案；每次启动/恢复是独立、可审计的 attempt。 |
| 循环 | 有界、持久化 iteration | 预算、停止性、审计和测试确定性优先于自由递归。 |
| cancelled 后恢复 | 禁止 resume | 取消必须是可信终态；需要复用时未来使用 fork/new run。 |
| 覆盖判定 | 确定性 policy，模型只提候选 | 将质量门禁留在可测试、可版本化的领域层。 |
| checkpoint 粒度 | 昂贵副作用/阶段边界 | 不记录 token/chunk；以可控复杂度覆盖关键重复成本。 |
| legacy Run | 保守从 planning 继续 | 缺历史 checkpoint 时不能伪造已完成事实。 |

### 3.2 跨任务文件所有权

| 文件/目录 | 主责任任务 | 其他任务约束 |
| --- | --- | --- |
| `src/shared/deepresearch/*` | DR2-01、DR2-14 | 只增加兼容字段，不删除旧字段。 |
| `scripts/migrations/*`、`src/server/db/schema.ts` | DR2-00、DR2-02 | 历史迁移只读。 |
| `db/repositories/deepresearch/*` | DR2-03、DR2-06、DR2-08 | workflow 不直写 DB 语义。 |
| `src/server/deepresearch/*` | DR2-04、DR2-10、DR2-12、DR2-13 | service 是命令入口；executor 受 ownership 限制。 |
| `services/deepresearch/*` | DR2-05、DR2-08、DR2-13 | 保持 Provider 可替换，本阶段不替换 Provider。 |
| `mastra/deepresearch/workflow*` 与非报告 steps | DR2-08、DR2-09、DR2-11 | 仅编排，业务真相在 DB。 |
| `http/routes/deep-research.ts` | DR2-14 | 只消费 command/query service。 |
| `renderer/.../deepresearch` | DR2-15 | 仅新增生命周期表面，避免报告/章节 UI 冲突。 |
| `docs/research/*` | DR2-16 | 维护决策、验证记录和 runbook。 |

---

## 4. 回归与非功能验收标准

| 维度 | 可测量验收标准 | 主要任务 |
| --- | --- | --- |
| 数据安全 | event/log/telemetry 不含抓取全文、绝对附件路径、API secret；API 不返回 lease token。 | DR2-14、DR2-16 |
| 成本边界 | standard/deep/exhaustive fixture 不超过硬预算；预算耗尽后没有外部调用。 | DR2-07、DR2-09 |
| 可终止性 | 覆盖达标、预算、无增益、无行动 gap、取消、最大轮次均有限结束。 | DR2-07、DR2-09、DR2-13 |
| 取消可靠性 | 取消持久化后无新 provider 调用；飞行请求返回后不写下游副作用；最终为 cancelled。 | DR2-13 |
| 恢复正确性 | 每个安全边界 crash/resume 后，已成功 query/fetch/evidence/artifact 不重复调用 fake provider。 | DR2-08、DR2-11、DR2-12 |
| 并发安全 | 同 Run 仅一个 attempt 有有效 lease；旧 attempt 无法覆盖新状态。 | DR2-03、DR2-04、DR2-10 |
| 向后兼容 | 第一阶段 Run 可读取/查看；V1 DTO 可用；legacy 无 checkpoint 只保守恢复。 | DR2-01、DR2-02、DR2-06、DR2-14 |
| 测试确定性 | CI 使用 frozen fixture、fake clock、fake Search/Fetch/Model，无实时网络依赖。 | DR2-09、DR2-16 |
| 工程质量 | 迁移、typecheck、architecture test、全量测试、build 通过。 | DR2-00、DR2-16 |

---

## 5. 测试与验收矩阵

| 场景 | 主要任务 | 核心断言 |
| --- | --- | --- |
| 初始覆盖已达标 | DR2-05 ～ DR2-09 | 不创建 iteration，直接进入综合。 |
| 高优先级问题缺独立权威来源 | DR2-05、DR2-07、DR2-08 | 生成 `search_primary` / `search_independent` 意图。 |
| 新证据均来自同域名 | DR2-05、DR2-07、DR2-09 | 无 material gain，按 no-material-gain 停止。 |
| 预算耗尽 | DR2-07、DR2-09 | 不发超额调用，生成 budget limitation。 |
| search 后崩溃 | DR2-08、DR2-11、DR2-12 | 不重复派发已成功 query。 |
| snapshot 后崩溃 | DR2-08、DR2-11 | 复用 content hash 相同 snapshot。 |
| artifact 生成未登记 | DR2-11、DR2-12 | 补登记或安全重建，无重复 artifact。 |
| 并发 auto-resume | DR2-03、DR2-04、DR2-10、DR2-12 | 单一 attempt 获取 lease/dispatch。 |
| fetch 返回与取消竞争 | DR2-13 | 不写后续 evidence/report，不进入 completed。 |
| finalization 与取消竞争 | DR2-01、DR2-13 | 最终只可能 cancelled，事件序列可解释。 |
| cancelled 后 resume | DR2-01、DR2-04、DR2-14、DR2-15 | 后端拒绝，UI 无恢复按钮。 |
| interrupted 后 resume | DR2-04、DR2-11、DR2-14、DR2-15 | 展示 checkpoint，从安全 cursor 继续。 |
| 第一阶段历史 Run | DR2-02、DR2-11、DR2-16 | 可读取，恢复保守 fallback，不伪造 checkpoint。 |
| SSE/轮询重复 | DR2-14、DR2-15 | 相同 event ID 不重复显示活动或 iteration。 |

### 5.1 分层测试策略

1. **领域单测**：状态机、coverage policy、budget、iteration decision、fingerprint、cancellation arbitration。
2. **仓储测试**：迁移、外键、唯一约束、事务、state version、checkpoint cursor、attempt ownership。
3. **服务/Workflow 集成测试**：coverage 达标、补充循环、预算、无增益、矛盾、恢复、取消。
4. **故障注入**：search/fetch/snapshot/evidence/assessment/artifact/checkpoint 各安全边界崩溃或竞争。
5. **API/SSE 测试**：新旧 DTO、capability 一致性、event schema、敏感字段排除、幂等 command。
6. **Renderer 测试**：lifecycle panel、store 去重、取消/恢复按钮、报告/来源/证据/问题树回归。
7. **全量回归**：第一阶段 acceptance、report quality、chat routing、architecture、typecheck、build。

### 5.2 建议验证命令

> 先完成 DR2-00；在此之前，`npm run db:migrate` 不是可用验收命令。

```powershell
# 定向（按实际测试文件调整路径）
npm test -- src/shared/deepresearch
npm test -- src/server/deepresearch/domain
npm test -- src/server/db/repositories/deepresearch
npm test -- src/server/services/deepresearch
npm test -- src/server/mastra/deepresearch
npm test -- src/server/http/routes/deep-research.test.ts
npm test -- src/renderer/pages/Chat/deepresearch

# 迁移与发布门禁
npm run db:migrate
npm run typecheck
npm run test:architecture
npm test
npm run build
```

---

## 6. 最终交付物和发布检查清单

### 6.1 代码与数据交付物

- [ ] 可运行且有迁移回归的迁移工具。
- [ ] `010-deep-research-resilience.sql` 与 schema 映射。
- [ ] Attempt、Checkpoint、Iteration、Assessment V2 契约和仓储。
- [ ] Run/Attempt 状态机、CAS、command idempotency 和 action capability。
- [ ] Coverage Policy V2、profile、gap code、limitations 与 assessment audit trail。
- [ ] 有界、预算受控、具 stop reason 的补充研究循环。
- [ ] Attempt-aware executor、cursor 恢复、reconciliation。
- [ ] 协作式取消、AbortSignal 传播和竞争仲裁。
- [ ] HTTP/SSE V2 与独立生命周期 UI 面板。

### 6.2 质量与运维交付物

- [ ] 单元、仓储、workflow、故障注入、API/SSE、Renderer、迁移、第一阶段回归测试。
- [ ] `deepresearch-phase-2-operations.md`：卡住 Run、lease、checkpoint、取消、孤儿 artifact、迁移排障。
- [ ] `deepresearch-phase-2-test-matrix.md`：fixture、场景、命令、责任人和结果记录。
- [ ] telemetry 字段与隐私白名单说明。
- [ ] 发布验收记录：迁移升级、恢复、取消、API/UI 一致性、NFR、全量构建结果。

### 6.3 发布前最终人工检查

1. 复核迁移编号、升级路径、rollback/恢复策略和临时数据库演练结果。
2. 复核没有修改受保护报告/章节文件，或已获得并行改动的明确合并确认。
3. 在 fake provider 下复跑 crash/resume 与六个取消注入点测试。
4. 检查 `cancelled` 在 API、SSE、store、UI 中均为不可恢复终态。
5. 抽查 telemetry/event/API payload，确认无正文、绝对路径、token 或 secret。
6. 执行第 5.2 节发布门禁并保存结果。

---

## 7. 推荐实施顺序

严格按 **DR2-00 → DR2-16** 推进。每个里程碑结束时先完成其定向测试、迁移兼容演练和代码边界检查，再开始下一里程碑。这样会把最难返工的持久化语义、状态机、并发和恢复风险前置，同时避免与报告/章节工作发生不必要的交叉修改。
