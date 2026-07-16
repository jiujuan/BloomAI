# BloomAI Deep Research 独立模块设计规格

**日期：** 2026-07-16
**状态：** 已批准进入实施规划
**范围：** 将 Chat 页面现有浅层研究能力升级为独立、持久、证据驱动的 Deep Research 模块

## 1. 决策摘要

BloomAI 将 Deep Research 建设为独立产品域模块。Chat 的“研究”Tab 是该模块的入口之一，但不拥有研究运行时、数据和生命周期。

模块采用以下总体设计：

- 以持久化、强类型的 Mastra Workflow 作为外层控制面。
- 仅在需要语义判断的步骤使用职责单一的 Agent，例如研究规划、证据分析、章节写作和引用验证。
- 搜索执行、URL 归一化、去重、来源评分、抓取、解析、预算、状态迁移、引用绑定和持久化由确定性服务负责。
- BloomAI 自己保存研究运行、问题树、检索词、来源、来源快照、证据、论断、引用、报告章节、质量评估、事件和制品。
- 首版提供四个显式研究 Profile：通用研究、市场研究、竞品研究、学术研究。
- 最终报告中的事实性论断必须能够追溯到具体证据段落，而不是只在段落末尾附一个网页 URL。

现有 researchAgent 和旧 deep-research workflow 在兼容迁移完成后退出用户可见的研究执行路径。

## 2. 背景与问题

当前 BloomAI 有两条相互分离的研究路径：

1. Chat 选择 research Tab 后进入单个 ReAct 风格的 researchAgent。
2. 未选择团队 Tab 且 mode 为 deep 时，才进入固定四步的 deep-research workflow。

由于团队 Agent 路由优先，用户看到的“研究”Tab 实际没有使用深度工作流。旧工作流还存在以下硬限制：只规划 2 至 3 个问题；每题搜索 4 条；总结果上限 8 条；只抓取前 3 页；每页正文截断为 800 字符；全部来源被压成一个字符串；最后只进行一次写作。

这些限制使它无法稳定产出正式市场研究、竞品研究、文献综述或其他深度报告，根因包括：

- 没有持久化 Research Brief 和范围边界。
- 没有问题树、证据要求和正式报告大纲。
- 没有结构化来源和证据账本。
- 没有来源权威性、多样性、时效性和独立性规则。
- 没有覆盖度、矛盾和证据缺口分析。
- 没有有预算的补充研究循环。
- 没有论断到证据的引用验证。
- 没有可靠的取消、恢复、重启续跑和幂等机制。
- 没有不同研究类型的方法论和报告结构。
- 没有客观质量门禁和回归评估。

## 3. 目标

1. 让 Deep Research 成为独立于 Chat 请求生命周期的一等能力。
2. 支持通用、市场、竞品和学术主题的详细、正式、客观报告。
3. 保存 ResearchQuestion -> Evidence -> Claim -> Citation 的可审计链路。
4. 支持长时间运行、实时进度、取消、应用重启和恢复。
5. 将搜索供应商、抓取器、解析器、重排器、向量库和模型隐藏在稳定接口之后。
6. 复用 BloomAI 已有工具策略、Capability Broker、模型选择、日志、可观测性、附件解析和数据库惯例。
7. 通过确定性检查、LLM 辅助评分、固定数据集和回归测试衡量质量。

## 4. 非目标

- 不构建无约束的自主多 Agent 网络。
- 不承诺外部来源绝对真实或无偏见。
- 不绕过付费墙、认证、robots 规则或访问控制。
- 首版不接入付费学术数据库。
- 不替换普通 Chat、Writing 或 Coding Agent。
- 不构建通用工作流设计器。
- 首版不提供多人协同编辑和外部自动发布。

## 5. 架构原则

### 5.1 独立 bounded context

Deep Research 拥有自己的术语、状态、持久化、编排、API 和制品。其他模块只能通过公共 Facade 和共享 DTO 调用，不能直接导入其 Repository 或 Workflow Step。

### 5.2 BloomAI 拥有产品事实

Mastra 是执行引擎，但 Mastra 的内部 Workflow 状态不是产品事实的唯一来源。研究状态、证据、报告、事件和制品由 BloomAI 数据表保存。这与现有 Agent Runtime 架构中“BloomAI 产品域封装层 + Mastra 适配层”的原则一致。

### 5.3 确定性外壳，概率性核心

LLM 只负责必须进行语义判断的工作。ID、状态迁移、预算、重试、URL 归一化、存储和引用完整性由确定性代码负责。

### 5.4 先证据后写作

报告章节只有在存在相关 Evidence 后才能写作。Writer 接收 Evidence ID 和有界 Evidence Packet，不再接收一个扁平化的 sources 字符串。

### 5.5 有界递归

补充研究循环受轮次、查询数、来源数、运行时间、Token 和成本限制。预算耗尽时输出明确限制，不允许无限循环。

### 5.6 事件追加写

用户进度和内部生命周期使用单调递增的追加事件。Run 保存当前聚合状态，Events 解释状态如何演进。

## 6. 模块边界与目录

    src/shared/deepresearch/
      contracts.ts
      events.ts
      schemas.ts

    src/server/deepresearch/
      index.ts
      deep-research.service.ts
      domain/
        types.ts
        state-machine.ts
        profiles.ts
        budgets.ts
        quality.ts

    src/server/db/repositories/deepresearch/
      research-run.repo.ts
      research-question.repo.ts
      research-source.repo.ts
      research-evidence.repo.ts
      research-report.repo.ts
      research-event.repo.ts

    src/server/services/deepresearch/
      search-service.ts
      source-curator.ts
      content-service.ts
      evidence-service.ts
      citation-service.ts
      artifact-service.ts

    src/server/mastra/deepresearch/
      mastra.ts
      workflow.ts
      workflow-context.ts
      steps/
      agents/

    src/server/http/routes/deep-research.ts

    src/renderer/pages/Chat/deepresearch/
      DeepResearchLauncher.tsx
      DeepResearchRunView.tsx
      ResearchProgress.tsx
      ResearchQuestionTree.tsx
      ResearchSourcesPanel.tsx
      ResearchReportView.tsx
      deep-research.store.ts
      deep-research.types.ts

    scripts/migrations/008-deep-research-core.sql

该模块是独立业务域，不是第二套通用 Agent Runtime。代码按 BloomAI 现有分层约定分别放入数据库 Repository、Server Service 和 Mastra 目录，但模块公共边界仍是 src/server/deepresearch/index.ts；HTTP Route、启动恢复及其他调用方不得绕过 Facade 直接依赖 Repository、Service 或 Runtime 内部实现。它通过适配器消费 Mastra 和 BloomAI 现有能力。

## 7. 公共类型

    export type ResearchProfile = 'general' | 'market' | 'competitor' | 'academic'
    export type ResearchDepth = 'standard' | 'deep' | 'exhaustive'

    export type ResearchRunStatus =
      | 'queued'
      | 'planning'
      | 'researching'
      | 'synthesizing'
      | 'verifying'
      | 'completed'
      | 'completed_with_limitations'
      | 'awaiting_input'
      | 'cancelling'
      | 'cancelled'
      | 'interrupted'
      | 'failed'

    export interface StartResearchInput {
      sessionId?: string
      topic: string
      profile: ResearchProfile
      depth: ResearchDepth
      objective?: string
      audience?: string
      geography?: string[]
      timeRange?: { from?: string; to?: string }
      preferredDomains?: string[]
      excludedDomains?: string[]
      attachmentIds?: string[]
      model?: string
    }

    export interface ResearchRunDto {
      id: string
      sessionId: string | null
      topic: string
      profile: ResearchProfile
      depth: ResearchDepth
      status: ResearchRunStatus
      phase: string
      progress: number
      brief: ResearchBriefDto | null
      budget: ResearchBudgetDto
      usage: ResearchUsageDto
      quality: ResearchQualityDto | null
      reportArtifactId: string | null
      error: { code: string; message: string; retryable: boolean } | null
      createdAt: number
      updatedAt: number
      completedAt: number | null
    }

公共类型必须可 JSON 序列化。数据库 Row、Drizzle 类型和 Mastra 类型不能泄漏到模块外。

## 8. Research Profile

### 8.1 通用研究

问题分类包括定义、历史、现状、机制、利益相关者、主要证据、分歧、影响、风险和开放问题。

默认报告包括执行摘要、范围与方法、按研究问题组织的发现、不同解释、影响、限制和参考文献。

### 8.2 市场研究

问题分类包括市场定义、细分、规模、增长、需求驱动、价值链、客户群体、监管、竞争结构、风险和机会。

优先来源为官方统计、监管文件、公司财报、行业协会、原始调查和可信研究机构。厂商营销页面可以证明厂商自己的说法，但不能独立证明市场整体结论。

### 8.3 竞品研究

问题分类包括定位、目标客户、产品能力、定价、渠道、合作伙伴、技术路线、采用信号、优势、弱点和战略风险。

所有比较表必须声明比较日期并使用统一维度。缺失数据表示 unknown，不能推断成“没有该能力”。

### 8.4 学术研究

问题分类包括研究问题、术语、理论脉络、奠基工作、近期工作、方法、数据集、发现、共识、争议、限制和研究空白。

优先来源为同行评审论文、会议论文、明确标记的预印本、机构仓库、DOI 元数据和原始数据集。报告必须区分同行评审、预印本和二手综述。

## 9. 深度与预算

| 项目 | Standard | Deep | Exhaustive |
|---|---:|---:|---:|
| 最大研究问题 | 8 | 14 | 24 |
| 补充研究轮次 | 1 | 3 | 5 |
| 最大检索查询 | 20 | 48 | 90 |
| 最大归一化来源 | 24 | 50 | 100 |
| 最大抓取来源 | 16 | 36 | 70 |
| 并发搜索 | 4 | 6 | 8 |
| 并发抓取 | 3 | 5 | 6 |
| 最大运行时间 | 10 分钟 | 30 分钟 | 60 分钟 |

以上为硬上限。覆盖度和质量门禁提前满足时应提前停止。Token 和供应商费用在能够可靠获得 usage 后纳入同一个 Budget 对象。

## 10. 数据模型

### 10.1 核心表

- research_runs：请求配置、生命周期、Budget、Usage、质量摘要、Mastra workflow run ID 和最终 Artifact。
- research_questions：问题树、章节意图、所需证据类型、优先级、状态和覆盖度。
- research_search_queries：查询文本、所属问题、迭代轮次、供应商、状态、结果数量和错误。
- research_sources：canonical URL、域名、标题、作者或发布者、发布时间、来源类型及各项评分。
- research_source_snapshots：抓取元数据、内容 Hash、正文、结构化元数据、抓取时间、解析器版本和 HTTP provenance。
- research_evidence：精确证据段落、规范化摘要、立场、所属问题、Source Snapshot、置信度和文本位置。
- research_report_sections：章节顺序、标题、目的、草稿、验证后文本和状态。
- research_claims：原子论断、类型、重要性、验证状态、置信度和修复历史。
- research_citations：Claim 到 Evidence 的关系、蕴含状态、验证理由和稳定显示序号。
- research_quality_assessments：指标、门禁结果、限制和评分器版本。
- research_events：按 run_id 和 sequence 排序的追加事件。
- research_artifacts：报告及证据导出的元数据；大文件保存在 BloomAI 管理目录。

### 10.2 引用完整性

- 每条 Evidence 必须引用同一 Run 的一个不可变 Source Snapshot 和一个 Research Question。
- 最终报告中的事实性 Claim 必须至少有一条 Citation；分析、建议和限制必须显式分类。
- 每条 Citation 必须引用同一 Run 的 Evidence。
- Citation ordinal 在重新加载和导出后保持稳定。
- 删除 Run 必须由 Service 事务性级联删除相关记录和受管 Artifact。

### 10.3 状态机

    queued -> planning -> researching -> synthesizing -> verifying
    verifying -> completed | completed_with_limitations
    active -> awaiting_input -> active
    active -> cancelling -> cancelled
    active -> interrupted -> queued
    active -> failed -> queued

其中 active 指 planning、researching、synthesizing 或 verifying。进入 awaiting_input 或 interrupted 时，Run 额外保存 resume_phase，用于恢复到明确阶段；不能把抽象的 active 写入数据库。非法状态迁移抛出 Domain Error，不写状态也不写事件。

### 10.4 执行器 Lease 与幂等

research_runs 保存 executor_id、lease_expires_at 和 heartbeat_at。同一时间只有成功获取未过期 Lease 的执行器可以推进 Run。长步骤定期续租；进程退出后 Lease 到期，启动恢复器才能接管。

BloomAI 主数据库和独立 Mastra Runtime 数据库之间不假设存在跨库事务。每个 Workflow 边界采用以下协议：先以幂等键保存 Domain Intent，再执行外部或 Mastra 操作，最后幂等写入结果与 Event。启动恢复器对账 Domain Status、Lease 和 Mastra Run State，修复只写入一侧的中间状态。

Query、Snapshot、Evidence、Section、Claim 和 Artifact 都必须具有 Run 内唯一的 idempotency_key。重复执行返回既有记录，不重复消耗外部调用或改变 Citation ordinal。

## 11. 研究工作流

外层 Workflow 固定为：

    load-run
      -> build-brief
      -> plan-question-tree
      -> plan-search-queries
      -> execute-searches
      -> curate-sources
      -> fetch-and-snapshot
      -> extract-evidence
      -> assess-coverage
      -> dountil(gap-fill-iteration, coverage-satisfied-or-budget-exhausted)
      -> build-report-outline
      -> draft-sections
      -> extract-claims
      -> verify-citations
      -> repair-report
      -> assess-quality
      -> finalize-artifacts

每个网络或模型边界执行前后都必须检查取消信号、Run 状态和预算。

### 11.1 规划

Brief Planner 接收规范化输入、Profile Policy、Budget 和附件摘要，输出 Research Brief、层级问题树、每个问题所需证据类别、正式报告大纲和需要澄清的歧义。

关键歧义存在时，Workflow 保存 Brief，转为 awaiting_input 并 suspend。非关键歧义写入 assumptions 后继续。

### 11.2 检索与来源筛选

Query Planner 为每个问题生成多个不同形式的检索式。搜索采用有界并发、供应商超时和有限重试。

Source Curator 依次执行 URL canonicalization、追踪参数清理、精确和域名去重、来源类型分类、权威性与相关性评分、时效性评分、独立性评分、域名集中度控制和 Profile 策略筛选。

搜索摘要只用于发现，不能作为最终 Evidence。

### 11.3 抓取与 Evidence

选中的来源通过现有 Capability Broker 抓取。优先静态抓取，仅在正文不足时使用浏览器渲染。抓取失败必须持久化并显示，不能吞掉后伪装成空成功。

正文按标题和文本位置分块。Evidence Analyst 每次只处理一个问题的有界 Chunk Packet，并输出原始段落、摘要、supports、contradicts、context 或 unclear 立场以及置信度。

### 11.4 覆盖度和补充研究

每个问题的覆盖度考虑独立来源数量、证据类别、Primary Source、支持与反对证据、时效性和单一来源依赖。

Gap Analyst 只接收 Coverage Matrix 和已有查询摘要，生成精确的补充查询，不重新生成全局计划。当高优先级问题达标、边际信息增益过低或硬预算耗尽时结束循环。

### 11.5 写作和验证

Section Writer 按章节并行执行，每个 Writer 只能看到本章节允许的 Evidence ID。

Claim Extractor 将草稿拆成原子 Claim。确定性检查拒绝缺失 Evidence ID、跨 Run 引用、重复 Citation ordinal 和引用已排除来源。

Citation Verifier 将每个 Claim-Evidence 关系标记为 supported、partially_supported、unsupported 或 contradicted。

Repair 只接收失败 Claim、相关 Evidence 和上下文句子。没有 Evidence ID 时不能增加新的事实内容。

### 11.6 最终制品

模块生成：

- 正式 Markdown 报告。
- Structured Report JSON。
- Reference List。
- Research Method 摘要。
- Limitations 与未解决矛盾。
- Evidence Appendix JSON。
- 包含 Profile、Budget、Usage、时间戳和质量结果的 Run Manifest。

PDF 和 DOCX 是对已验证 Structured Report 的后续 Renderer，不触发新的研究运行。

## 12. Agent 与确定性服务分工

| 组件 | 类型 | 职责 |
|---|---|---|
| Brief Planner | Agent | 范围、假设、问题树和大纲 |
| Query Planner | Agent | 生成多样化且针对性的检索式 |
| Evidence Analyst | Agent | 从有界 Chunk 中抽取相关证据 |
| Gap Analyst | Agent | 识别缺口并生成补充查询 |
| Section Writer | Agent | 仅使用允许 Evidence 写一个章节 |
| Claim Extractor | Agent | 把报告拆成原子论断 |
| Citation Verifier | Agent | 判断 Claim-Evidence 蕴含和限定条件 |
| Report Critic | Agent | 评估结构、中立性和限制披露 |
| Search Service | 确定性 | Provider 调用、超时、重试和计量 |
| Source Curator | 确定性 | 归一化、去重、评分和多样性 |
| Content Service | 确定性 | 抓取、解析、Hash、快照和分块 |
| Citation Service | 确定性 | 引用完整性、序号和覆盖率 |
| State Machine | 确定性 | 状态迁移和终态规则 |

Agent 不直接拥有任意 Tool Surface。Workflow Step 组装允许输入，并通过 Structured Output Schema 调用 Agent。

## 13. Mastra Runtime

模块创建独立 Mastra 实例，不复用当前全局 InMemoryStore：

    new Mastra({
      storage: new LibSQLStore({
        id: 'deep-research-runtime',
        url: runtimeDbUrl,
      }),
      agents: deepResearchAgents,
      workflows: { 'deep-research-v1': deepResearchWorkflow },
      observability,
    })

Mastra run ID 保存到 research_runs.workflow_run_id。BloomAI Run 状态和 Event 在 Workflow 边界更新，但不宣称与独立 Runtime DB 原子提交；一致性由 Lease、幂等键和启动对账保证。

功能映射：

- parallel 或受控 Service 并发：独立搜索和抓取。
- foreach：按问题、章节执行强类型 fan-out。
- dountil：补充研究循环。
- branch：澄清、限制和修复路径。
- suspend 和 resume：关键用户澄清。
- LibSQL Workflow Storage：进程重启恢复。

默认执行路径不使用 Agent Network。

## 14. 模块 Facade

    export interface DeepResearchModule {
      startResearch(input: StartResearchInput): Promise<ResearchRunDto>
      getRun(runId: string): Promise<ResearchRunDetailDto | undefined>
      listRuns(filter?: ResearchRunFilter): Promise<ResearchRunDto[]>
      answerClarification(runId: string, input: ResearchClarificationInput): Promise<ResearchRunDto>
      cancelRun(runId: string): Promise<ResearchRunDto>
      resumeRun(runId: string): Promise<ResearchRunDto>
      listEvents(runId: string, afterSequence?: number): Promise<ResearchEventDto[]>
      getArtifact(runId: string, artifactId: string): Promise<ResearchArtifactContent | undefined>
      recoverInterruptedRuns(): Promise<void>
    }

HTTP Route、应用启动恢复和未来非 Chat 入口只能导入这个 Facade。startResearch 必须先持久化 Run 再调度执行，HTTP 请求不等待完整研究结束。

## 15. HTTP API

    GET    /api/v1/deep-research/status
    POST   /api/v1/deep-research/runs
    GET    /api/v1/deep-research/runs
    GET    /api/v1/deep-research/runs/:runId
    GET    /api/v1/deep-research/runs/:runId/events?after=<sequence>
    GET    /api/v1/deep-research/runs/:runId/stream
    POST   /api/v1/deep-research/runs/:runId/clarifications
    POST   /api/v1/deep-research/runs/:runId/cancel
    POST   /api/v1/deep-research/runs/:runId/resume
    GET    /api/v1/deep-research/runs/:runId/artifacts/:artifactId

GET /status 始终注册并返回 `{ enabled, version }`，Renderer 用它在新 Workbench 与旧 Research 回滚路径之间选择。只有 `DEEP_RESEARCH_V2_ENABLED` 开启时才注册 Run、Event、Stream 和 Artifact 业务处理器。POST /runs 返回 201 和已经持久化的 Run。Stream 发出与 research_events 一致的稳定事件；重连使用 Last-Event-ID 或 after 参数。

稳定错误码包括 RESEARCH_RUN_NOT_FOUND、RESEARCH_INVALID_TRANSITION、RESEARCH_BUDGET_EXHAUSTED、RESEARCH_PROVIDER_UNAVAILABLE、RESEARCH_AWAITING_INPUT、RESEARCH_CANCELLED 和 RESEARCH_ARTIFACT_NOT_FOUND。

## 16. Event Protocol

每个事件都包含 runId、sequence、type、phase、timestamp 和 JSON-safe payload。

    research.run.created
    research.run.status_changed
    research.brief.completed
    research.questions.planned
    research.query.started
    research.query.completed
    research.query.failed
    research.source.discovered
    research.source.selected
    research.source.fetch_failed
    research.evidence.extracted
    research.coverage.assessed
    research.iteration.started
    research.iteration.completed
    research.section.drafted
    research.claim.verified
    research.quality.assessed
    research.artifact.created
    research.run.awaiting_input
    research.run.completed
    research.run.failed
    research.run.cancelled

Events 用于观察和审计。消费者从 Run Detail 和 Events 构建 UI，不能解析日志文本。

## 17. Chat 和 UI 集成

### 17.1 路由

选择 Research Tab 后不再路由到 TEAM_AGENT_BY_TAB.research，而是打开 Deep Research Launcher。提交后通过独立 API 创建 Research Run。

普通 Chat Transport 保持不变。完成报告可以作为 data-research-run UI Part 链接回 Chat，该 Part 只保存 runId、标题、状态和 Artifact Reference。

### 17.2 Launcher

Launcher 提供 Topic、Profile、Depth、Objective、Audience、Geography、Time Range、Preferred Domains、Excluded Domains、Chat Attachments 和 Model。

高级设置默认折叠。UI 显示相对时间和来源规模，不提供不可靠的精确价格估算。

### 17.3 Run View

Run View 提供 Overview、Questions、Sources、Report、Evidence 和 Activity 六个视图。

- Overview：阶段、进度、预算、假设和限制。
- Questions：问题树和覆盖度。
- Sources：选中或拒绝来源、评分和抓取状态。
- Report：带可点击 Citation 的验证报告。
- Evidence：证据段落、来源元数据和所支持 Claim。
- Activity：追加事件和失败记录。

用户可以取消、恢复、回答澄清、重试失败运行和导出。刷新或重启桌面应用后必须从服务端恢复状态。

## 18. 引用与客观性规则

1. Search Snippet 不能作为最终引用证据。
2. Citation 指向存储的 Evidence Passage，而不仅是 URL。
3. 来源对自身的陈述标记为 First-party Evidence。
4. 市场规模结论必须记录来源、日期、地区、单位和可获得的方法。
5. 竞品比较必须使用同一比较日期和维度。
6. 学术结论必须区分同行评审、预印本和二手摘要。
7. 可信来源冲突时必须披露，不能静默平均。
8. 未知信息保持未知；缺少证据不能被写成不存在。
9. 建议和解释必须与有来源的事实发现分开呈现。
10. Limitations 必须披露不可访问来源、过时证据、未解决矛盾和预算耗尽。

## 19. 质量模型

质量指标不宣称证明绝对真实性，而是判断报告是否达到可发布标准。

| 指标 | 默认门禁 |
|---|---:|
| 高优先级问题覆盖率 | >= 0.80 |
| 事实性 Claim 引用覆盖率 | >= 0.90 |
| supported 或 partially_supported 引用占比 | >= 0.90 |
| 高重要性 unsupported Claim | 0 |
| 独立引用域名 | >= 3，除非研究范围不允许 |
| 未解决矛盾披露率 | 100% |
| Profile 必需章节覆盖率 | 100% |

全部硬门禁通过时状态为 completed。硬预算耗尽但仍能生成有用报告，并且没有高重要性 unsupported Claim 时，状态为 completed_with_limitations。否则进入 failed，并记录 retryable 属性。

## 20. 失败、取消与恢复

- Search 和 Fetch 失败按操作持久化，不能降级成空成功。
- Provider 重试使用有界指数退避，且不能超过 Run Deadline。
- 单个来源失败但存在充分替代来源时，不应导致整个 Run 失败。
- Cancel 先设置 cancelling；Workflow 在下一个边界停止并设置 cancelled。
- 应用启动时，Lease 已过期且没有活跃执行器的 planning、researching、synthesizing 和 verifying Run 标记为 interrupted，并保留 resume_phase。
- Resume 复用已保存的问题、来源、快照、Evidence 和已成功章节。
- 只有输入、Parser Version 或 Model Contract 变化导致失效时，才重新执行昂贵步骤。
- Query、Snapshot、Evidence 和 Artifact 使用 Idempotency Key 防止恢复时重复写入。

## 21. 安全与隐私

- 网络访问全部经过现有 Capability Broker 和 Tool Policy。
- URL 抓取拒绝不支持的 Scheme 和本地或私网目标；Redirect Target 采用同样校验。
- 抓取内容是不可信数据，页面中的指令不能作为 Agent 指令。
- Secret、Authorization Header 和本地路径不能写入 Evidence、Event、Report 或 Prompt。
- Attachment 通过服务端 ID 和有界解析访问，新 API 不接收任意客户端文件路径。
- Artifact Path 由服务端在受管目录内生成。

## 22. 可观测性与评估

每个 Workflow Step 同时关联 researchRunId 和 Mastra workflowRunId。指标包括：

- 按 Profile 和 Depth 的运行时间。
- Search 和 Fetch 成功率及延迟。
- 发现、筛选、抓取和引用的来源数量。
- Evidence 和 Claim 数量。
- 补充研究轮次及新增 Evidence。
- 可获得时的 Token 和 Provider Usage。
- Citation Coverage 和 Verifier 结果。
- 完成、限制完成、取消、恢复和失败率。

回归 Dataset 覆盖四个 Profile，确定性 CI 使用冻结来源 Fixture 和 Fake Model Adapter；Live Web 测试与 CI 分离。

## 23. 测试策略

### 23.1 Unit

- 状态迁移和终态。
- Budget 计量与循环终止。
- URL 归一化、去重和来源多样性。
- Profile Policy 和必需章节。
- Evidence Packet 边界。
- Claim 与 Citation 引用完整性。
- Quality Gate 计算。
- Event Sequence 单调性。

### 23.2 Repository 和 Migration

- 新数据库迁移及当前 Schema 升级。
- Cascade、Index、Unique、JSON Decode 和 Idempotency Key。
- Run、Questions、Sources、Evidence、Report 和 Events 聚合重建。

### 23.3 Workflow

- Fake Search、Fetch 和 Model Adapter 的 Happy Path。
- Search Provider 部分失败。
- Budget Exhaustion 后生成 Limited Report。
- Critical Clarification Suspend 与 Resume。
- Search 和 Writing 期间 Cancel。
- Process Interruption 后幂等 Resume。
- Unsupported Claim Repair 和 Quality Failure。

### 23.4 API 和 UI

- Validation、Create、Detail 和 Event Pagination。
- SSE 重连不丢失或重复事件。
- 非法 Cancel 或 Resume。
- Artifact 必须属于对应 Run。
- Launcher 的 Profile 和 Depth。
- Refresh 后 Run Hydration。
- Event Reducer。
- Citation 点击跳转 Evidence。
- Clarification、Cancel、Resume、Retry 和 Export。

### 23.5 验收命令

- npm test
- npm run typecheck
- npm run build
- 一个 Fixture-backed Run 和一个 Live Web Standard Run。
- Desktop 和窄视口截图，确保控件、报告和 Citation 不重叠或截断。

## 24. 迁移与兼容

1. 新增 Deep Research Schema，不修改现有 Chat Message。
2. 始终注册只读 Status Route；在 DEEP_RESEARCH_V2_ENABLED Feature Flag 后注册模块及其 Run、Event、Stream 和 Artifact Route。
3. 新增 Research Launcher 和 Run View。
4. Flag 开启时，从 TEAM_AGENT_BY_TAB 移除 research 并把 Tab 连接到新模块。
5. 旧 Workflow 保留一个兼容版本，用于已有 data-workflow Message 的渲染。
6. 首发阶段保留旧 Research 执行路径作为 Flag 关闭时的回滚；完成验收和发布门禁后，在独立退役提交中删除旧 Research Agent、Planner、Writer、Workflow 和 Flag 回滚分支。
7. WorkflowSteps 的 data-workflow 渲染兼容独立于旧执行代码，退役后仍永久保留。

已有 data-workflow Message 不转换为 Research Run，因为扁平化 Sources 无法重建可信 Evidence Ledger。

## 25. 交付切片

### Slice 1：持久研究基础

Contracts、Migration、Repository、State Machine、Facade、Route、Event Protocol、持久 Mastra Runtime 和 Fixture-backed Skeleton Workflow。

### Slice 2：结构化检索与证据

问题规划、Query 执行、Source Curator、Snapshot、Evidence Extraction、Coverage Matrix 和一轮有界 Gap Filling。

### Slice 3：验证报告

Outline、并行章节写作、Atomic Claim、Citation Verification、Repair、Quality Gate、Markdown 与 JSON Artifact 和 completed_with_limitations。

### Slice 4：研究工作台

Launcher、Progress、Question Tree、Sources、Report、Evidence Navigation、Activity、Cancel、Resume、Clarification 和 Chat Report Link。

### Slice 5：评估与加固

Regression Dataset、Observability、Restart Recovery、Live Web Smoke、性能优化和旧研究路径退役。

每个 Slice 完成后应用都必须可构建，并具有可独立验证的用户行为。

## 26. 验收标准

1. Research Tab 启动新模块，不再进入轻量 researchAgent。
2. Run 独立于 HTTP Stream，应用重启后仍可见。
3. Standard Run 在主题需要时可规划至少 8 个问题并抓取超过 3 个来源。
4. Source 和不可变 Snapshot 与生成文本分开保存。
5. 每个显示 Citation 可以打开准确 Evidence Passage 和来源元数据。
6. 高重要性 unsupported Claim 不能进入 completed Report。
7. 高优先级问题覆盖不足时执行定向 Gap Filling，并在硬预算停止。
8. Search 或 Fetch 失败及 Budget Exhaustion 在 Events 和 Limitations 中可见。
9. 用户可以 Cancel、Resume 和回答关键 Clarification。
10. 四个 Profile 具有不同问题策略和报告结构。
11. Markdown 与 Structured JSON Export 使用稳定 Citation ID。
12. Unit、Workflow、Repository、API、UI、Typecheck、Build 和 Runtime 验收通过。

## 27. 备选方案

### 27.1 只增强现有 researchAgent

拒绝作为目标架构。单 Agent 无法自然提供持久生命周期、确定性预算、结构化 Evidence 和可靠 Claim-level Citation。

### 27.2 原地扩展旧四步 Workflow

拒绝。扁平 sources Contract 和 Chat-owned Streaming Lifecycle 会迫使每一步做破坏性修改，建立兼容适配器比保留错误边界更简单。

### 27.3 使用动态 Agent Network 作为主编排器

拒绝默认采用。它增加成本和不确定性，使取消、回放、质量门禁和 Fixture Test 更困难。未来可以在某个有界探索 Step 内可选使用。

### 27.4 只保存 Mastra Workflow State

拒绝。Workflow State 是执行基础设施，不是稳定的产品 Evidence Model；只依赖它会把报告历史耦合到执行引擎内部格式。

## 28. 参考资料

- GPT Researcher repository: https://github.com/assafelovic/gpt-researcher
- GPT Researcher introduction: https://docs.gptr.dev/docs/gpt-researcher/getting-started/introduction
- Building GPT Researcher: https://docs.gptr.dev/blog/building-gpt-researcher
- Mastra workflows: https://mastra.ai/docs/workflows/overview
- Mastra control flow: https://mastra.ai/docs/workflows/control-flow
- Mastra durable execution: https://mastra.ai/docs/workflows/durable-execution
- BloomAI Agent Runtime architecture: docs/agent/agent-runtime-architecture-design.md
