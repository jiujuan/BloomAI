# BloomAI Deep Research 实施计划

> **面向智能体执行者：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施本计划。各步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 构建独立、持久化、证据驱动的 Deep Research 模块，并将 Chat 的“研究”标签页接入该模块。

**架构：** BloomAI 在主 SQLite 数据库中管理研究领域状态、证据、报告、事件和制品。专用的持久化 Mastra 实例负责协调有边界的工作流步骤；确定性服务负责检索、筛选、预算、状态转换、引用和恢复。Chat 与 HTTP 通过稳定的 `DeepResearchModule` 门面使用该模块。

**技术栈：** TypeScript、Hono、Drizzle SQLite、Mastra 1.49、LibSQLStore、Zod、Zustand、React 18、AI SDK 6、Vitest。

---

## 文件映射

共享契约：

- 新建 `src/shared/deepresearch/contracts.ts`，定义可安全 JSON 序列化的 DTO 和枚举。
- 新建 `src/shared/deepresearch/events.ts`，定义稳定的事件联合类型。
- 新建 `src/shared/deepresearch/schemas.ts`，实现基于 Zod 的 API 校验。
- 新建 `src/shared/deepresearch/index.ts`，作为共享层导出边界。

服务端模块与适配器：

- 新建 `src/server/deepresearch/domain/state-machine.ts`、`budgets.ts`、`profiles.ts`、`quality.ts` 和 `errors.ts`。
- 新建 `scripts/migrations/008-deep-research-core.sql`，并扩展 `src/server/db/schema.ts`。
- 在 `src/server/db/repositories/deepresearch` 下新建职责聚焦的 Repository。
- 在 `src/server/services/deepresearch` 下新建确定性服务。
- 在 `src/server/mastra/deepresearch` 下新建专用运行时。
- 新建 `src/server/deepresearch/deep-research.service.ts` 和 `index.ts`，作为公共门面。
- 新建 `src/server/http/routes/deep-research.ts`，并在 `src/server/http/app.ts` 中注册。

渲染端：

- 扩展 `src/renderer/api/index.ts`，加入 Deep Research 端点。
- 在 `src/renderer/pages/Chat/deepresearch` 下新建 Zustand Store 和工作台组件。
- 修改 `src/renderer/pages/Chat/ChatPanelMastra.tsx`，使“研究”标签页打开工作台。
- 仅为移除兼容路由而修改 `src/server/mastra/agents/team.ts` 和 `src/server/http/routes/chat.ts`。

验证：

- 在相关文件旁添加单元、迁移、Repository、工作流、路由、Store 和组件测试。
- 在 `src/server/deepresearch/test-fixtures` 下添加确定性测试夹具。

## 任务 1：共享契约、状态机、研究类型与预算

**文件：**

- 新建：src/shared/deepresearch/contracts.ts
- 新建：src/shared/deepresearch/events.ts
- 新建：src/shared/deepresearch/schemas.ts
- 新建：src/shared/deepresearch/index.ts
- 新建：src/server/deepresearch/domain/state-machine.ts
- 新建：src/server/deepresearch/domain/state-machine.test.ts
- 新建：src/server/deepresearch/domain/profiles.ts
- 新建：src/server/deepresearch/domain/profiles.test.ts
- 新建：src/server/deepresearch/domain/budgets.ts
- 新建：src/server/deepresearch/domain/budgets.test.ts
- 新建：src/server/deepresearch/domain/errors.ts

- [ ] **步骤 1：编写会失败的状态、研究类型与预算测试**

~~~ts
import { describe, expect, it } from 'vitest'
import { assertResearchTransition } from './state-machine'
import { getResearchBudget } from './budgets'
import { getResearchProfilePolicy } from './profiles'

describe('deep research domain', () => {
  it('accepts valid transitions and rejects terminal restarts', () => {
    expect(() => assertResearchTransition('queued', 'planning')).not.toThrow()
    expect(() => assertResearchTransition('completed', 'planning')).toThrowError('RESEARCH_INVALID_TRANSITION')
  })

  it('defines distinct market and academic requirements', () => {
    expect(getResearchProfilePolicy('market').requiredSections).toContain('market-sizing')
    expect(getResearchProfilePolicy('academic').requiredSections).toContain('methodology-review')
  })

  it('returns immutable deep limits', () => {
    const budget = getResearchBudget('deep')
    expect(budget.maxQuestions).toBe(14)
    expect(budget.maxIterations).toBe(3)
    expect(() => Object.assign(budget, { maxQuestions: 99 })).toThrow()
  })
})
~~~

- [ ] **步骤 2：运行测试并确认失败**

运行：npx vitest run src/server/deepresearch/domain/state-machine.test.ts src/server/deepresearch/domain/profiles.test.ts src/server/deepresearch/domain/budgets.test.ts

预期：失败，因为相关模块尚不存在。

- [ ] **步骤 3：实现共享契约与 Schema**

在 `contracts.ts` 中定义 `ResearchProfile`、`ResearchDepth`、`ResearchRunStatus`、`StartResearchInput`、`ResearchRunFilter`、`ResearchClarificationInput`、`ResearchBriefDto`、`ResearchRunDto`、`ResearchRunDetailDto`、`ResearchQuestionDto`、`ResearchCoverageDto`、`ResearchSearchQueryDto`、`ResearchSourceDto`、`ResearchSourceSnapshotDto`、`ResearchEvidenceDto`、`ResearchReportSectionDto`、`ResearchClaimDto`、`ResearchCitationDto`、`ResearchReportDto`、`ResearchQualityDto`、`ResearchBudgetDto`、`ResearchUsageDto`、`ResearchEventDto`、`ResearchArtifactDto` 和 `ResearchArtifactContent`。在 `events.ts` 中导出一个带判别字段的 `ResearchEvent` 联合类型，并将 `ResearchEventDto` 定义为其可安全 JSON 序列化的形式。在 `schemas.ts` 中实现 `startResearchSchema` 和 `clarificationSchema`。

~~~ts
export const startResearchSchema = z.object({
  sessionId: z.string().min(1).optional(),
  topic: z.string().trim().min(3).max(4000),
  profile: z.enum(['general', 'market', 'competitor', 'academic']),
  depth: z.enum(['standard', 'deep', 'exhaustive']),
  objective: z.string().trim().max(4000).optional(),
  audience: z.string().trim().max(500).optional(),
  geography: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  timeRange: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
  preferredDomains: z.array(z.string().trim().min(1)).max(30).optional(),
  excludedDomains: z.array(z.string().trim().min(1)).max(30).optional(),
  attachmentIds: z.array(z.string().min(1)).max(20).optional(),
  model: z.string().min(1).optional(),
})
~~~

实现显式状态转换映射，以及冻结的研究类型和预算对象。领域错误必须携带 `code`、`retryable` 和 `message`。

- [ ] **步骤 4：运行聚焦测试**

运行：npx vitest run src/server/deepresearch/domain

预期：通过。

- [ ] **步骤 5：提交领域基础实现**

~~~bash
git add src/shared/deepresearch src/server/deepresearch/domain
git commit -m "feat(deepresearch): add domain contracts and policies"
~~~

## 任务 2：数据库迁移与 Drizzle Schema

**文件：**

- 新建：scripts/migrations/008-deep-research-core.sql
- 修改：src/server/db/schema.ts
- 修改：src/server/db/migrations.test.ts

- [ ] **步骤 1：添加迁移测试预期**

扩展 `migrations.test.ts`，确保全新数据库包含 `008-deep-research-core` 版本以及以下数据表：

~~~ts
expect(tableNames).toEqual(expect.arrayContaining([
  'research_runs',
  'research_questions',
  'research_search_queries',
  'research_sources',
  'research_source_snapshots',
  'research_evidence',
  'research_report_sections',
  'research_claims',
  'research_citations',
  'research_quality_assessments',
  'research_events',
  'research_artifacts',
]))
~~~

同时断言 `research_events(run_id, sequence)`、`research_sources(run_id, canonical_url)`，以及每个 Run 内的所有 `idempotency_key` 均具有唯一索引。

- [ ] **步骤 2：运行迁移测试并确认失败**

运行：npx vitest run src/server/db/migrations.test.ts

预期：失败，因为迁移 008 及其数据表尚不存在。

- [ ] **步骤 3：创建 SQL 迁移**

迁移必须创建设计规格中的全部 12 张表。JSON 和枚举使用 `TEXT`，时间戳和布尔值使用 `INTEGER`，并为 Run 创建以下必需字段：

~~~sql
CREATE TABLE research_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  topic TEXT NOT NULL,
  profile TEXT NOT NULL,
  depth TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL,
  brief_json TEXT,
  budget_json TEXT NOT NULL,
  usage_json TEXT NOT NULL DEFAULT '{}',
  quality_json TEXT,
  workflow_run_id TEXT,
  report_artifact_id TEXT,
  resume_phase TEXT,
  executor_id TEXT,
  lease_expires_at INTEGER,
  heartbeat_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
~~~

每张子表都必须包含带 `ON DELETE CASCADE` 的 `run_id`。快照文本和证据文本保存在各自专用表中。为 Run 状态、问题父级/顺序、查询状态、来源选择、证据问题、章节序号、主张章节、引用序号、事件序列以及制品 Run/类型添加索引。

- [ ] **步骤 4：在 Drizzle Schema 中映射迁移结构**

添加字段名和索引完全对应的 `sqliteTable` 声明。使用与现有 `schema.ts` 风格一致的 `snake_case` 名称导出。

- [ ] **步骤 5：运行迁移测试与类型检查**

运行：npx vitest run src/server/db/migrations.test.ts

预期：通过。

运行：npm run typecheck

预期：通过。

- [ ] **步骤 6：提交数据库 Schema**

~~~bash
git add scripts/migrations/008-deep-research-core.sql src/server/db/schema.ts src/server/db/migrations.test.ts
git commit -m "feat(deepresearch): add persistent research schema"
~~~

## 任务 3：Repository、事件、租约与聚合读取

**文件：**

- 新建：src/server/db/repositories/deepresearch/research-run.repo.ts
- 新建：src/server/db/repositories/deepresearch/research-question.repo.ts
- 新建：src/server/db/repositories/deepresearch/research-source.repo.ts
- 新建：src/server/db/repositories/deepresearch/research-evidence.repo.ts
- 新建：src/server/db/repositories/deepresearch/research-report.repo.ts
- 新建：src/server/db/repositories/deepresearch/research-event.repo.ts
- 新建：src/server/db/repositories/deepresearch/repositories.test.ts

- [ ] **步骤 1：编写 Repository 测试**

测试创建、合法状态转换及事件写入、事件序列单调递增、租约获取、过期租约接管、规范 URL 唯一性、不可变快照、证据幂等插入、稳定引用序号和级联删除。

~~~ts
it('does not let two executors own one run', () => {
  const run = runRepo.create(input)
  expect(runRepo.acquireLease(run.id, 'worker-a', 10_000)).toBe(true)
  expect(runRepo.acquireLease(run.id, 'worker-b', 10_000)).toBe(false)
})

it('returns the existing evidence for the same idempotency key', () => {
  const first = evidenceRepo.upsertEvidence({ runId, idempotencyKey: 'q1:s1:0', passage: 'A' })
  const second = evidenceRepo.upsertEvidence({ runId, idempotencyKey: 'q1:s1:0', passage: 'A' })
  expect(second.id).toBe(first.id)
})
~~~

- [ ] **步骤 2：运行测试并确认失败**

运行：npx vitest run src/server/db/repositories/deepresearch/repositories.test.ts

预期：失败，因为 Repository 尚不存在。

- [ ] **步骤 3：实现 Repository**

使用 `getOrmDb`；当主数据库中的多行数据必须一同变更时使用 Drizzle 事务；使用 `uuidv4` ID、JSON 解码辅助函数以及显式 DTO 映射。在 `research-run.repo.ts` 中实现 `transitionWithEvent`，确保 Run 状态与对应事件在同一个主数据库事务中提交。

追加事件时，在同一事务中查询 `MAX(sequence)`，遇到唯一约束冲突时重试一次。通过一条条件 `UPDATE` 实现 `acquireLease`，仅当租约不存在、已经过期或已由同一执行器持有时才成功。

- [ ] **步骤 4：运行 Repository 与迁移测试**

运行：npx vitest run src/server/db/repositories/deepresearch src/server/db/migrations.test.ts

预期：通过。

- [ ] **步骤 5：提交 Repository 实现**

~~~bash
git add src/server/db/repositories/deepresearch
git commit -m "feat(deepresearch): persist runs evidence and events"
~~~

## 任务 4：模块门面与后台执行器

**文件：**

- 新建：src/server/deepresearch/deep-research.service.ts
- 新建：src/server/deepresearch/deep-research.service.test.ts
- 新建：src/server/deepresearch/executor.ts
- 新建：src/server/deepresearch/index.ts

- [ ] **步骤 1：使用假运行时编写生命周期测试**

~~~ts
it('persists before scheduling', async () => {
  const runtime = { start: vi.fn(async () => undefined) }
  const service = createDeepResearchService({ runtime })
  const run = await service.startResearch(validInput)
  expect(run.status).toBe('queued')
  expect(runtime.start).toHaveBeenCalledWith(run.id)
})

it('marks stale active runs interrupted during recovery', async () => {
  seedExpiredResearchingRun()
  await service.recoverInterruptedRuns()
  expect(await service.getRun(runId)).toMatchObject({ status: 'interrupted', resumePhase: 'researching' })
})
~~~

- [ ] **步骤 2：确认测试失败**

运行：npx vitest run src/server/deepresearch/deep-research.service.test.ts

预期：失败，因为服务和执行器尚不存在。

- [ ] **步骤 3：实现生命周期用例**

`DeepResearchService` 校验输入、创建状态为 `queued` 的 Run、发出 `research.run.created` 事件，并调度 `executor.start`，执行过程不与 HTTP 请求生命周期绑定。`cancelRun` 将状态设为 `cancelling`。`resumeRun` 接受 `interrupted` 和可重试的 `failed` 状态，清除终止错误字段并重新排队执行。`answerClarification` 在调用运行时恢复前先持久化答案。`src/server/deepresearch/index.ts` 只构造并导出一个 `deepResearchModule` 单例，使 HTTP 路由和启动恢复共享相同的 Repository、事件发布器、执行器和 Mastra 运行时。

执行器生成进程内唯一的执行器 ID，获取 30 秒租约，每 10 秒续租一次，调用运行时适配器，并且始终释放租约。执行器通过 `transitionWithEvent` 报告失败，并保留错误的可重试分类。

- [ ] **步骤 4：运行服务测试**

运行：npx vitest run src/server/deepresearch/deep-research.service.test.ts

预期：通过。

- [ ] **步骤 5：提交生命周期服务**

~~~bash
git add src/server/deepresearch/deep-research.service.ts src/server/deepresearch/deep-research.service.test.ts src/server/deepresearch/executor.ts src/server/deepresearch/index.ts
git commit -m "feat(deepresearch): add durable run lifecycle facade"
~~~

## 任务 5：专用 Mastra 运行时与骨架工作流

**文件：**

- 新建：src/server/mastra/deepresearch/mastra.ts
- 新建：src/server/mastra/deepresearch/workflow-context.ts
- 新建：src/server/mastra/deepresearch/workflow.ts
- 新建：src/server/mastra/deepresearch/workflow.test.ts
- 新建：src/server/mastra/deepresearch/agents/brief-planner.ts
- 新建：src/server/mastra/deepresearch/steps/load-run.ts
- 新建：src/server/mastra/deepresearch/steps/build-brief.ts
- 新建：src/server/mastra/deepresearch/steps/finalize-skeleton.ts

- [ ] **步骤 1：编写基于夹具的工作流测试**

假的 Brief Planner 返回固定的结构化研究简报。断言状态按 `queued -> planning -> completed_with_limitations` 转换，并持久化 `workflow_run_id`、研究简报、事件和骨架 Markdown 制品。再添加一个用例：Planner 将一个歧义标记为关键问题，此时 Run 进入 `awaiting_input`，Mastra Run 暂停；`answerClarification` 持久化回答，恢复后从 `planning` 继续且不会创建第二份简报。

- [ ] **步骤 2：运行测试并确认失败**

运行：npx vitest run src/server/mastra/deepresearch/workflow.test.ts

预期：失败，因为运行时尚不存在。

- [ ] **步骤 3：实现专用运行时**

解析受管理的数据路径，并使用 `LibSQLStore` 创建 `deep-research-runtime.db`。只注册 Deep Research Agent 和 `deep-research-v1`。导出包含 `start(runId)` 与 `resume(runId, resumeData)` 的 `DeepResearchRuntimeAdapter`。使用带类型的 `createStep` 边界构建工作流，并在完整链路组装完毕后一次性提交。

`build-brief` 步骤根据 `criticalClarifications` 分支：持久化问题、将领域 Run 转换为 `awaiting_input`、发出 `research.run.awaiting_input`，并使用 `runId` 与澄清问题 ID 调用 `suspend`。工作流返回已保存的 `resumePhase` 前，使用 `clarificationSchema` 校验恢复数据。每个步骤都接收 `runId`、加载当前领域状态、调用 `assertRunnable` 和 `assertBudgetAvailable`、使用幂等键持久化输出并返回类型化数据。测试运行时支持注入存储、Planner 和 Repository，因此不会调用真实模型。

- [ ] **步骤 4：运行工作流与服务测试**

运行：npx vitest run src/server/mastra/deepresearch src/server/deepresearch/deep-research.service.test.ts

预期：通过。

- [ ] **步骤 5：提交运行时骨架**

~~~bash
git add src/server/mastra/deepresearch
git commit -m "feat(deepresearch): add persistent Mastra workflow runtime"
~~~

## 任务 6：搜索、来源筛选、抓取与快照

**文件：**

- 新建：src/server/services/deepresearch/search-service.ts
- 新建：src/server/services/deepresearch/source-curator.ts
- 新建：src/server/services/deepresearch/content-service.ts
- 新建：src/server/services/deepresearch/retrieval.test.ts
- 新建：src/server/mastra/deepresearch/agents/query-planner.ts
- 新建：src/server/mastra/deepresearch/steps/plan-questions.ts
- 新建：src/server/mastra/deepresearch/steps/plan-queries.ts
- 新建：src/server/mastra/deepresearch/steps/execute-searches.ts
- 新建：src/server/mastra/deepresearch/steps/curate-sources.ts
- 新建：src/server/mastra/deepresearch/steps/fetch-sources.ts
- 修改：src/server/mastra/deepresearch/workflow.ts

- [ ] **步骤 1：编写确定性检索测试**

使用包含跟踪参数 URL、重复域名、重定向、第一手来源、过期来源、一次临时供应商故障、一次抓取失败、一次私有网络重定向以及页面内指令式文本的夹具。断言 URL 规范化、多样性、研究类型评分、有界并发、受截止时间限制的重试、SSRF 拒绝、失败持久化以及基于内容哈希的不可变快照。

- [ ] **步骤 2：确认失败**

运行：npx vitest run src/server/services/deepresearch/retrieval.test.ts

预期：失败，因为检索服务尚不存在。

- [ ] **步骤 3：实现检索服务**

`SearchService` 调用 `executeLegacyToolCapability`，传入调用方 `workflow`、真实的 `sessionId` 或 `runId`、`web_search`，以及受预算上限约束的结果数量。`ContentService` 调用 `web_fetch` 和 `web_extract`，使用现有 Tool Policy 校验初始 URL 与最终 URL，拒绝非 HTTP(S)、localhost、私有/链路本地地址范围及不安全重定向；使用 SHA-256 对规范化内容计算哈希并写入快照。`SourceCurator` 应用规范 URL 归一化、域名集中度上限和研究类型权重。

只对超时、限流和供应商不可用错误进行重试，最多执行两次指数退避重试，并受 Run 截止时间和剩余 Budget 约束。绝不持久化 Authorization Header、Cookie、密钥或本地路径。在所有 Agent Prompt 中都将抓取文本视为不可信来源数据；页面中的指令不得更改系统策略或工作流策略。使用模块内部的小型 `mapWithConcurrency` 辅助函数；它必须保持输入顺序，在取消后停止继续调度，并收集单项失败而不拒绝整个批次。

- [ ] **步骤 4：连接类型化工作流步骤**

Planner 输出必须满足 Zod Schema。执行前先持久化每个问题和查询。搜索与抓取事件必须包含计数和稳定 ID，绝不能包含页面原始内容。

- [ ] **步骤 5：运行聚焦测试**

运行：npx vitest run src/server/services/deepresearch/retrieval.test.ts src/server/mastra/deepresearch/workflow.test.ts

预期：通过。

- [ ] **步骤 6：提交检索实现**

~~~bash
git add src/server/services/deepresearch src/server/mastra/deepresearch
git commit -m "feat(deepresearch): add structured source retrieval"
~~~

## 任务 7：证据提取、覆盖度与缺口补全循环

**文件：**

- 新建：src/server/services/deepresearch/evidence-service.ts
- 新建：src/server/services/deepresearch/evidence-service.test.ts
- 新建：src/server/mastra/deepresearch/agents/evidence-analyst.ts
- 新建：src/server/mastra/deepresearch/agents/gap-analyst.ts
- 新建：src/server/mastra/deepresearch/steps/extract-evidence.ts
- 新建：src/server/mastra/deepresearch/steps/assess-coverage.ts
- 新建：src/server/mastra/deepresearch/steps/gap-fill-iteration.ts
- 修改：src/server/mastra/deepresearch/workflow.ts

- [ ] **步骤 1：编写证据与循环测试**

断言搜索摘要不能作为证据、证据段落长度受限、证据关联到唯一问题和快照、矛盾证据会被保留、高优先级但未覆盖的问题会生成后续查询，并且循环会在达到覆盖要求、信息增益过低、收到取消或达到 `maxIterations` 时停止。

- [ ] **步骤 2：确认失败**

运行：npx vitest run src/server/services/deepresearch/evidence-service.test.ts

预期：失败，因为证据服务尚不存在。

- [ ] **步骤 3：实现有大小边界的证据包**

按标题和字符偏移对快照分块。证据包包含来源元数据，以及不超过配置字符预算的内容块。使用 Schema 校验 Evidence Analyst 输出，要求包含 `passage`、`summary`、`stance`、`confidence`、`questionId`、`snapshotId` 和偏移量。

每个问题的覆盖度必须计算独立域名数、证据类别、第一手来源数、近期来源数、支持证据、反对证据以及单一来源依赖。

- [ ] **步骤 4：实现 Mastra `dountil` 缺口补全**

循环体接收覆盖度矩阵，只创建缺失查询，执行检索与证据提取，记录边际新增证据，递增 `usage.iterations`，并严格按照任务 1 定义的 Budget 策略停止。

- [ ] **步骤 5：运行证据与工作流测试**

运行：npx vitest run src/server/services/deepresearch/evidence-service.test.ts src/server/mastra/deepresearch/workflow.test.ts

预期：通过。

- [ ] **步骤 6：提交证据研究循环**

~~~bash
git add src/server/services/deepresearch/evidence-service.ts src/server/services/deepresearch/evidence-service.test.ts src/server/mastra/deepresearch
git commit -m "feat(deepresearch): add evidence ledger and gap filling"
~~~

## 任务 8：报告撰写、主张、引用、质量与制品

**文件：**

- 新建：src/server/services/deepresearch/citation-service.ts
- 新建：src/server/services/deepresearch/artifact-service.ts
- 新建：src/server/services/deepresearch/report-quality.test.ts
- 新建：src/server/mastra/deepresearch/agents/section-writer.ts
- 新建：src/server/mastra/deepresearch/agents/claim-extractor.ts
- 新建：src/server/mastra/deepresearch/agents/citation-verifier.ts
- 新建：src/server/mastra/deepresearch/agents/report-critic.ts
- 新建：src/server/mastra/deepresearch/steps/build-outline.ts
- 新建：src/server/mastra/deepresearch/steps/draft-sections.ts
- 新建：src/server/mastra/deepresearch/steps/extract-claims.ts
- 新建：src/server/mastra/deepresearch/steps/verify-citations.ts
- 新建：src/server/mastra/deepresearch/steps/repair-report.ts
- 新建：src/server/mastra/deepresearch/steps/assess-quality.ts
- 新建：src/server/mastra/deepresearch/steps/finalize-artifacts.ts
- 修改：src/server/mastra/deepresearch/workflow.ts

- [ ] **步骤 1：编写报告质量测试**

测试稳定引用序号、跨 Run 引用拒绝、无证据支持的重要主张、部分支持、矛盾信息、研究类型必需章节、`completed` 与 `completed_with_limitations` 的判定，以及 Markdown 和 JSON 输出。

~~~ts
expect(() => citationService.bind({ runId: 'a', claimId, evidenceIdFromRunB })).toThrowError('RESEARCH_CROSS_RUN_CITATION')
expect(assessQuality(reportWithUnsupportedCriticalClaim).releaseStatus).toBe('failed')
expect(assessQuality(reportAtBudgetWithDisclosedGaps).releaseStatus).toBe('completed_with_limitations')
~~~

- [ ] **步骤 2：确认失败**

运行：npx vitest run src/server/services/deepresearch/report-quality.test.ts

预期：失败，因为报告服务尚不存在。

- [ ] **步骤 3：实现报告流水线**

根据冻结的研究类型要求和规划章节构建大纲。通过类型化 Mastra `foreach` 步骤，以有界并发和逐章节证据白名单撰写各章节。提取主张前先持久化草稿。将每个事实性主张绑定到 Evidence ID，并按首次使用顺序分配序号。Verifier 输出包含状态和理由，但绝不修改被引用的证据原文。

只修复校验失败的句子。如果修复后的句子新增了没有 Evidence ID 的事实性主张，则拒绝该修复并保留限制说明。`assessQuality` 必须严格应用设计规格中的门禁：高优先级问题覆盖率 `>= 0.80`、事实性 Claim 引用覆盖率 `>= 0.90`、状态为 `supported` 或 `partially_supported` 的引用比例 `>= 0.90`、高重要性且无支持的 Claim 数量为 0；除非研究范围不允许，否则至少引用 3 个独立域名；矛盾披露率为 100%，必需章节覆盖率为 100%。

`ArtifactService` 使用服务端生成的名称和临时文件原子重命名，将文件写入受管理的 Deep Research 制品目录。导出经过验证的 Markdown、结构化 JSON、证据附录、参考文献列表、研究方法、限制说明和 Run 清单。

- [ ] **步骤 4：运行报告测试与基于夹具的端到端工作流测试**

运行：npx vitest run src/server/services/deepresearch/report-quality.test.ts src/server/mastra/deepresearch/workflow.test.ts

预期：通过，并生成完整的夹具报告和稳定引用。

- [ ] **步骤 5：提交经过验证的报告实现**

~~~bash
git add src/server/services/deepresearch src/server/mastra/deepresearch
git commit -m "feat(deepresearch): generate verified cited reports"
~~~

## 任务 9：HTTP API、SSE、功能状态与渲染端客户端

**文件：**

- 新建：src/server/http/routes/deep-research.ts
- 新建：src/server/http/routes/deep-research.test.ts
- 修改：src/server/config/config.ts
- 修改：src/server/http/app.ts
- 修改：src/renderer/api/index.ts

- [ ] **步骤 1：编写路由与功能开关测试**

覆盖始终可用的 `GET /status` 响应、启用时返回 201 的创建请求、禁用时拒绝 Run 端点、校验失败、列表/详情、事件分页、`Last-Event-ID` 重连、澄清、取消、恢复、Run 与制品关系以及结构化错误码。

- [ ] **步骤 2：确认失败**

运行：npx vitest run src/server/http/routes/deep-research.test.ts

预期：失败，因为路由和功能开关解析器尚不存在。

- [ ] **步骤 3：实现功能开关与 Hono 路由**

在 `src/server/config/config.ts` 中添加一个服务端解析函数：

~~~ts
export function isDeepResearchV2Enabled(): boolean {
  const value = readConfigValue('DEEP_RESEARCH_V2_ENABLED', 'false').value.toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}
~~~

始终注册 `GET /status`，并返回 `{ enabled, version: 'v2' }`。使用功能开关保护所有 `/runs` Handler，确保禁用模式无法创建或修改 V2 Run。使用 `startResearchSchema` 和 `clarificationSchema`。GET 事件流使用 Hono `streamSSE`，以持久化的 `sequence` 作为事件 ID 发送数据，随后订阅模块事件发布器。请求中止时关闭订阅。制品响应根据已存储的元数据设置 Content-Type 和 Content-Disposition。

按以下方式注册：

~~~ts
app.route('/api/v1/deep-research', deepResearchRoutes)
~~~

- [ ] **步骤 4：添加渲染端 API 方法**

使用共享 DTO 添加 `getStatus`、`start`、`list`、`get`、`listEvents`、`answerClarification`、`cancel`、`resume` 和制品 URL 辅助方法。保留现有 `apiFetch` 错误契约。当旧版服务端返回 404 时，`getStatus` 返回 `{ enabled: false, version: 'v2' }`，使渲染端在混合版本发布期间可以安全使用旧路径。

- [ ] **步骤 5：运行路由测试与类型检查**

运行：npx vitest run src/server/http/routes/deep-research.test.ts

预期：通过。

运行：npm run typecheck

预期：通过。

- [ ] **步骤 6：提交 API 接口面**

~~~bash
git add src/server/http/routes/deep-research.ts src/server/http/routes/deep-research.test.ts src/server/config/config.ts src/server/http/app.ts src/renderer/api/index.ts
git commit -m "feat(deepresearch): expose flagged run and event APIs"
~~~

## 任务 10：渲染端 Store 与事件归并

**文件：**

- 新建：src/renderer/pages/Chat/deepresearch/deep-research.types.ts
- 新建：src/renderer/pages/Chat/deepresearch/deep-research.store.ts
- 新建：src/renderer/pages/Chat/deepresearch/deep-research.store.test.ts

- [ ] **步骤 1：编写 Store 测试**

测试启动器默认值、启动与活动 Run 数据恢复、有序事件归并、重复事件抑制、轮询降级、重连游标、终态停止、取消、恢复、澄清以及错误保留。

- [ ] **步骤 2：确认失败**

运行：npx vitest run src/renderer/pages/Chat/deepresearch/deep-research.store.test.ts

预期：失败，因为 Store 尚不存在。

- [ ] **步骤 3：实现 Zustand Store**

状态包含 `draft`、`activeRunId`、`run`、`questions`、`sources`、`report`、`evidenceById`、`events`、`lastSequence`、`selectedView`、`selectedEvidenceId`、`loading` 和 `error`。Action 调用渲染端 API，并且只在 `sequence` 大于 `lastSequence` 时应用事件。

可用时使用 `EventSource` 获取实时进度；断开连接后降级为每两秒调用一次 `listEvents`。收到终态、`awaiting_input` 或制品事件后，始终刷新 Run 详情。

- [ ] **步骤 4：运行 Store 测试**

运行：npx vitest run src/renderer/pages/Chat/deepresearch/deep-research.store.test.ts

预期：通过。

- [ ] **步骤 5：提交渲染端状态实现**

~~~bash
git add src/renderer/pages/Chat/deepresearch/deep-research.types.ts src/renderer/pages/Chat/deepresearch/deep-research.store.ts src/renderer/pages/Chat/deepresearch/deep-research.store.test.ts
git commit -m "feat(deepresearch): add recoverable research UI state"
~~~

## 任务 11：Deep Research 工作台 UI

**文件：**

- 新建：src/renderer/pages/Chat/deepresearch/DeepResearchLauncher.tsx
- 新建：src/renderer/pages/Chat/deepresearch/DeepResearchRunView.tsx
- 新建：src/renderer/pages/Chat/deepresearch/ResearchProgress.tsx
- 新建：src/renderer/pages/Chat/deepresearch/ResearchQuestionTree.tsx
- 新建：src/renderer/pages/Chat/deepresearch/ResearchSourcesPanel.tsx
- 新建：src/renderer/pages/Chat/deepresearch/ResearchReportView.tsx
- 新建：src/renderer/pages/Chat/deepresearch/ResearchEvidencePanel.tsx
- 新建：src/renderer/pages/Chat/deepresearch/DeepResearchWorkbench.test.tsx
- 修改：src/renderer/styles/global.css

- [ ] **步骤 1：编写组件行为测试**

测试 4 个 Profile 控件、3 个 Depth 控件、输入校验、进度、问题覆盖度、已选择与已拒绝来源、报告引用点击、证据抽屉、澄清表单、取消、恢复、重试和导出。

- [ ] **步骤 2：确认失败**

运行：npx vitest run src/renderer/pages/Chat/deepresearch/DeepResearchWorkbench.test.tsx

预期：失败，因为组件尚不存在。

- [ ] **步骤 3：实现启动器与 Run 外壳**

Profile 和 Depth 使用紧凑的分段控件，范围设置使用标准输入控件，取消、恢复、重试和导出使用现有图标库提供的图标按钮。工作台是操作型工具，不是落地页：不使用 Hero、装饰性卡片或解释性的营销文案。

Run 视图使用稳定的标签页：概览、问题、来源、报告、证据、活动。报告引用使用行内引用样式的按钮，并调用 `selectEvidence(citation.evidenceId)`。

- [ ] **步骤 4：添加响应式布局**

桌面布局使用受约束的内容列和证据侧边面板。窄屏布局将面板堆叠在报告下方。为进度行、引用控件和来源表格设置稳定的最小/最大尺寸；不得让动态标签导致相邻控件位移。

- [ ] **步骤 5：运行 UI 测试与类型检查**

运行：npx vitest run src/renderer/pages/Chat/deepresearch

预期：通过。

运行：npm run typecheck

预期：通过。

- [ ] **步骤 6：提交工作台实现**

~~~bash
git add src/renderer/pages/Chat/deepresearch src/renderer/styles
git commit -m "feat(deepresearch): add research workbench"
~~~

## 任务 12：Chat 路由、Run 链接与旧版兼容

**文件：**

- 修改：src/renderer/pages/Chat/ChatPanelMastra.tsx
- 修改：src/renderer/pages/Chat/parts/tool-part.ts
- 新建：src/renderer/pages/Chat/deepresearch/ResearchRunPart.tsx
- 新建：src/renderer/pages/Chat/deepresearch/chat-routing.test.tsx
- 新建：src/server/http/routes/chat-research-routing.test.ts
- 修改：src/server/http/routes/chat.ts

- [ ] **步骤 1：编写路由与持久化消息部件测试**

断言启用状态下“研究”标签页渲染 `DeepResearchWorkbench`，且绝不发送 `x-bloom-agent: research`。断言禁用状态下保留旧版 Research Agent 请求。断言普通聊天、写作和编码 Header 不变。断言 `data-research-run` 部件经过 `slimParts`、页面重载后仍然保留，并可点击进入对应 Run；旧的 `data-workflow` 部件在重载后仍可渲染。

- [ ] **步骤 2：确认失败**

运行：npx vitest run src/renderer/pages/Chat/deepresearch/chat-routing.test.tsx src/server/http/routes/chat-research-routing.test.ts

预期：失败，因为“研究”仍直接路由到 `researchAgent`，并且 `data-research-run` 尚未渲染。

- [ ] **步骤 3：根据服务端状态接入“研究”标签页**

Chat 挂载时调用 `deepResearchApi.getStatus()`。启用后，选择“研究”会渲染 `DeepResearchWorkbench`，提交操作使用 `POST /api/v1/deep-research/runs`。禁用时，或者状态接口返回旧服务端降级结果时，保留当前的 `x-bloom-agent: research` 请求路径。

发布过渡阶段保留 `TEAM_AGENT_BY_TAB.research`。在 `src/server/http/routes/chat.ts` 中，V2 启用时使用 `RESEARCH_USE_DEEP_RESEARCH_API` 拒绝 `x-bloom-agent: research`；禁用时继续解析旧版 Research Agent。该服务端保护可避免旧渲染端在 V2 启用后启动浅层研究。

- [ ] **步骤 4：添加可持久化的 Research Run UI 部件**

`ResearchRunPart` 接收 `{ runId, title, status, artifactId }`，显示紧凑的状态行，并在 `DeepResearchWorkbench` 中打开该 Run。扩展 `slimParts` 与 assistant-part 渲染以支持 `data-research-run`，但不改变 `data-workflow` 的处理方式。通过现有 `POST /api/v1/chat/assistant` 端点持久化该部件；不要把报告正文复制到 Chat 消息中。

- [ ] **步骤 5：运行路由与 Chat 回归测试**

运行：npx vitest run src/renderer/pages/Chat/deepresearch/chat-routing.test.tsx src/server/http/routes/chat-research-routing.test.ts src/server/http/routes/chat-plan.test.ts

预期：通过。

- [ ] **步骤 6：提交 Chat 集成**

~~~bash
git add src/renderer/pages/Chat src/server/http/routes/chat.ts
git commit -m "feat(deepresearch): route research tab to durable runs"
~~~

## 任务 13：启动恢复与可观测性

**文件：**

- 新建：src/server/deepresearch/recovery.ts
- 新建：src/server/deepresearch/recovery.test.ts
- 修改：src/server/config/config.ts
- 修改：src/server/index.ts
- 修改：src/server/telemetry/metrics.ts
- 修改：src/server/mastra/deepresearch/workflow-context.ts

- [ ] **步骤 1：编写恢复测试**

创建以下夹具：一个租约已过期且存在对应暂停 Mastra Run 的 `researching` Run；一个已过期但没有 Mastra 状态的 Run；一个租约仍有效的 Run。断言只有已过期 Run 会被标记为中断，状态对账具有幂等性，`DEEP_RESEARCH_AUTO_RESUME=false` 时中断 Run 可由用户手动恢复，`DEEP_RESEARCH_AUTO_RESUME=true` 时每个符合条件的 Run 只入队一次。

- [ ] **步骤 2：确认失败**

运行：npx vitest run src/server/deepresearch/recovery.test.ts

预期：失败，因为恢复机制尚不存在。

- [ ] **步骤 3：在服务端监听前实现状态对账**

在 `src/server/config/config.ts` 中添加 `isDeepResearchAutoResumeEnabled()`，使用与 V2 开关相同的严格 `1/true/on` 解析规则，默认值为 `false`。在 `src/server/index.ts` 中将 `runMigrations().then(...)` 回调改为异步；`runMigrations()` 完成后等待 `deepResearchModule.recoverInterruptedRuns()`，然后才调用 `createHonoApp()` 和 `serve(...)`。比较领域状态、Lease、`workflow_run_id` 和 Mastra Run 状态。每次实际纠正只发出一个 `research.run.status_changed` 事件，并在调度自动恢复前使用幂等恢复命令键。

- [ ] **步骤 4：添加隐私安全的指标与 Trace**

为 Run 完成、带限制完成、取消、失败、恢复、搜索延迟、抓取延迟、选中来源数、证据数、主张验证、缺口迭代和端到端耗时添加计数器与直方图。Trace 属性包含 `research.run.id`、`workflow.run.id`、`profile`、`depth`、`phase` 和数值计数；绝不包含主题、查询、URL、来源文本、附件名称、报告正文或可能含有密钥的错误载荷。

- [ ] **步骤 5：运行恢复与遥测测试**

运行：npx vitest run src/server/deepresearch/recovery.test.ts src/server/telemetry

预期：通过。

- [ ] **步骤 6：提交恢复实现**

~~~bash
git add src/server/deepresearch/recovery.ts src/server/deepresearch/recovery.test.ts src/server/config/config.ts src/server/index.ts src/server/telemetry/metrics.ts src/server/mastra/deepresearch/workflow-context.ts
git commit -m "feat(deepresearch): recover and observe long research runs"
~~~

## 任务 14：评估、验收与受发布门禁控制的旧版退役

**文件：**

- 新建：src/server/deepresearch/test-fixtures/general.json
- 新建：src/server/deepresearch/test-fixtures/market.json
- 新建：src/server/deepresearch/test-fixtures/competitor.json
- 新建：src/server/deepresearch/test-fixtures/academic.json
- 新建：src/server/deepresearch/deep-research.acceptance.test.ts
- 修改：src/server/http/routes/deep-research.ts
- 修改：src/server/http/routes/chat.ts
- 修改：src/server/config/config.ts
- 修改：src/server/mastra/index.ts
- 修改：src/server/mastra/agents/team.ts
- 修改：src/server/mastra/tools.ts
- 修改：src/renderer/pages/Chat/ChatPanelMastra.tsx
- 发布门禁通过后删除：src/server/mastra/workflows/deep-research.ts
- 发布门禁通过后删除：src/server/mastra/agents/research-planner-agent.ts
- 发布门禁通过后删除：src/server/mastra/agents/research-writer-agent.ts

- [ ] **步骤 1：添加四个确定性验收夹具**

每个夹具包含需求输入、Planner 输出、搜索响应、抓取文档、预期必需章节、独立域名最小数量、预期矛盾信息和预期最终状态。夹具来源使用保留的示例域名，不包含真实的受版权保护文章。

- [ ] **步骤 2：编写端到端验收测试**

通过假适配器运行全部四种 Profile。断言问题策略、来源选择、证据台账、配置启用时的缺口补全、引用点击目标 ID、质量门禁、制品内容、取消、澄清暂停/恢复和重启恢复。断言每个展示的引用都解析到同一 Run 中的 Evidence ID，并且已完成报告中不存在高重要性且无支持的 Claim。

- [ ] **步骤 3：运行完整自动化验证**

运行：npm test

预期：通过。

运行：npm run typecheck

预期：通过。

运行：npm run build

预期：通过。

- [ ] **步骤 4：执行基于夹具的运行时 UI 验证**

使用夹具适配器并设置 `DEEP_RESEARCH_V2_ENABLED=true` 启动应用。完成一个 Standard 夹具 Run；在 `researching` 阶段重载渲染端；打开一个报告引用；取消第二个 Run；回答一个澄清问题；恢复一个中断的 Run。截取桌面和窄屏截图，确认不存在文字裁切、控件重叠、空白视图或失效引用。

- [ ] **步骤 5：执行独立的 Live Web 冒烟测试**

使用常规 Capability Broker 和已启用的搜索供应商，运行一个 Standard 通用研究主题。当主题复杂度合理时，验证至少规划 8 个问题、发现超过 3 个来源、抓取失败或限制已持久化、Evidence 导航准确、执行可在边界内完成，并能导出 Markdown 和 JSON。由于实时供应商和网页内容不稳定，该冒烟测试为手动测试，与确定性 CI 分开执行。

- [ ] **步骤 6：应用发布退役门禁**

只有在步骤 1 至 5 全部通过、产品发布已将 V2 选为唯一“研究”体验，并且持久化 `data-workflow` 渲染通过回归测试后，才能退役旧路径。随后移除 `DEEP_RESEARCH_V2_ENABLED` 降级分支，使 `GET /status` 返回 `enabled: true`；使用 `RESEARCH_USE_DEEP_RESEARCH_API` 拒绝所有 `x-bloom-agent: research` 请求；移除 `researchAgent` 和 `TEAM_AGENT_BY_TAB.research`；移除旧版研究角色工具映射；从 `src/server/mastra/index.ts` 移除旧 Planner/Writer/Workflow 注册，并删除三个旧版执行文件。保留 `WorkflowSteps` 及其 `research-writer` 显示标签，以兼容历史消息。

运行：rg -n "DEEP_RESEARCH_V2_ENABLED|researchAgent|research-planner|research-writer|deepResearchWorkflow" src

预期：不存在可执行导入、注册、Agent 定义或功能开关分支；唯一允许的匹配是渲染端中的历史显示标签或兼容性测试。

- [ ] **步骤 7：退役后运行最终验证**

运行：npm test

预期：通过。

运行：npm run typecheck

预期：通过。

运行：npm run build

预期：通过。

- [ ] **步骤 8：提交验收与退役变更**

~~~bash
git add src/server/deepresearch src/server/http/routes src/server/config/config.ts src/server/mastra src/renderer/pages/Chat
git commit -m "test(deepresearch): verify profiles and retire legacy execution"
~~~

## 最终设计规格覆盖检查

| 设计规格章节 | 实施覆盖 |
|---|---|
| 1. 决策摘要 | 任务 1 至 14 保持独立限界上下文的决策。 |
| 2. 背景与问题 | 任务 5 至 8 使用持久化、证据优先的研究流程替代浅层四步路径。 |
| 3. 目标 | 任务 1 至 14 覆盖持久化 Run、研究类型专属研究、经验证引用、工作台体验和导出。 |
| 4. 非目标 | 任务 5、8 和 12 避免引入第二套通用 Agent Runtime、动态 Agent Network 编排以及 PDF/DOCX 研究逻辑。 |
| 5. 架构原则 | 任务 1、3 至 8 和 13 实现确定性边界、先证据后成文、有界递归以及只追加事件。 |
| 6. 模块边界与目录 | 由文件映射以及任务 1、4、5、9 和 12 覆盖。 |
| 7. 公共类型 | 任务 1 定义后续引用的所有 Facade、API、Event、渲染端和制品契约。 |
| 8. 研究类型 | 任务 1、8 和 14 实现并验证 general、market、competitor 和 academic 策略。 |
| 9. 深度与预算 | 任务 1、6、7 和 13 强制执行限制、截止时间、并发和使用量报告。 |
| 10. 数据模型 | 任务 2 和 3 持久化完整台账；任务 8 完成报告、主张、引用、质量和制品写入。 |
| 11. 研究工作流 | 任务 5 至 8 实现规划、检索、证据、缺口补全、撰写、验证和最终化。 |
| 12. Agent/服务职责拆分 | 任务 5 至 8 保持模型工作聚焦，并由确定性服务掌握权威逻辑。 |
| 13. Mastra Runtime | 任务 5、7、8 和 13 覆盖专用 LibSQL 状态、`foreach`、`dountil`、暂停/恢复和状态对账。 |
| 14. 模块 Facade | 任务 4、9 和 13 将单例 Facade 设为唯一服务端入口。 |
| 15. HTTP API | 任务 9 覆盖状态、类 CRUD Run 操作、SSE 重连、澄清、生命周期命令和制品。 |
| 16. 事件协议 | 任务 1、3、9 和 10 定义、持久化、流式发送、去重和归并稳定事件。 |
| 17. Chat 与 UI 集成 | 任务 10 至 12 提供启动器、工作台、证据导航、Run 链接、刷新恢复和旧版渲染。 |
| 18. 引用与客观性规则 | 任务 6 至 8 和 14 拒绝将搜索摘要作为证据、保留矛盾、绑定准确段落并披露限制。 |
| 19. 质量模型 | 任务 8 实现精确发布门禁；任务 14 对其进行端到端验证。 |
| 20. 失败、取消与恢复 | 任务 3 至 8 和 13 覆盖失败持久化、有界重试、取消边界、Lease、中断、恢复和幂等性。 |
| 21. 安全与隐私 | 任务 1、6 至 9 和 13 覆盖服务端 ID、Tool Policy、SSRF 与重定向检查、不可信内容、受管理制品和遥测脱敏。 |
| 22. 可观测性与评估 | 任务 13 和 14 添加隐私安全指标、Trace、确定性夹具和独立 Live Web 冒烟测试。 |
| 23. 测试策略 | 每个任务都从聚焦测试开始；任务 14 运行单元、集成、UI、类型检查、构建、夹具运行时和实时冒烟检查。 |
| 24. 迁移与兼容 | 任务 9、12 和 14 实现状态开关、回退阶段、永久历史渲染兼容和受发布门禁控制的退役。 |
| 25. 交付切片 | 执行顺序将任务 1 至 14 映射到切片 1 至 5，并设置验证检查点。 |
| 26. 验收标准 | 任务 14 验证全部 12 项验收结果。 |
| 27. 备选方案 | 任务 5 和 12 落实选定的固定工作流与独立 API，而不采用已否决的单 Agent 或 Chat 流式设计。 |
| 28. 参考资料 | 设计规格继续作为 GPT Researcher、Mastra 和 BloomAI 外部架构参考的来源；实施过程不加入复制的外部代码。 |

## 执行顺序

将任务 1 至 5 作为切片 1，任务 6 和 7 作为切片 2，任务 8 作为切片 3，任务 9 至 12 作为切片 4，任务 13 和 14 作为切片 5。前一切片通过聚焦测试、类型检查和构建检查点之前，不得开始后续切片。


## 任务并行执行分析

本计划以可持久化的研究台账、稳定的共享契约和可恢复的工作流为核心。因此，并行化必须服从既有切片门禁：前一切片的聚焦测试、类型检查和构建检查点未通过前，不得开始后一切片。这里的“可并行”是指可以由不同实现者在独立分支或 Worktree 中同时完成并最终安全集成；它不等同于可以提前阅读、准备测试数据或编写不接入主干的草稿。

### 总体结论

- 任务 1、2、3 是必须顺序完成的基础链。共享契约、数据库结构和 Repository 的任一变化都会影响后续所有层，不能作为完整任务并行实施。
- 任务 3 完成且接口冻结后，任务 4（模块门面与后台执行器）和任务 5（Mastra 运行时与工作流骨架）是唯一推荐进行完整任务级并行的组合。
- 任务 6、7、8 都围绕同一个研究工作流逐层增加能力，并共同修改 `src/server/mastra/deepresearch/workflow.ts`，必须顺序完成。
- 任务 9、10、11、12 存在明确的服务端 API 到状态管理、再到 UI 与 Chat 集成的依赖链。可以进行有限的内部子任务并行，但不建议将完整任务并行交付。
- 任务 13 和任务 14 是恢复、验收、退役的最终收束阶段，应严格顺序执行；旧路径删除只能发生在全部回归通过之后。

### 任务级依赖与并行判断

| 任务 | 前置条件 | 是否可与其他完整任务并行 | 判断与约束 |
|---|---|---|---|
| 1. 共享契约、状态机、研究类型与预算 | 无 | 否 | 为数据库、运行时、HTTP、事件和渲染端提供权威类型与状态机；必须先冻结。 |
| 2. 数据库迁移与 Drizzle Schema | 任务 1 | 否 | 依赖任务 1 的枚举、DTO 和持久化语义；可提前准备迁移草案，但不得在契约未冻结时合并。 |
| 3. Repository、事件、租约与聚合读取 | 任务 1、2 | 否 | 直接消费数据表与共享契约，并为运行时、门面和恢复提供持久化边界。 |
| 4. 模块门面与后台执行器 | 任务 3 | 可以，与任务 5 受控并行 | 开工前需冻结 Run 生命周期、事件发布、运行时适配器和恢复责任的接口；文件职责与任务 5 基本分离。 |
| 5. Mastra 运行时与工作流骨架 | 任务 1、3 | 可以，与任务 4 受控并行 | 可先基于接口实现运行时骨架；最终服务集成测试需等待任务 4 的门面与执行器可用。 |
| 6. 检索、来源筛选、抓取与快照 | 任务 5 | 否 | 产出来源、抓取和快照数据，供证据层消费；是 `workflow.ts` 的第一段业务扩展。 |
| 7. 证据、覆盖度与缺口补全循环 | 任务 6 | 否 | 依赖任务 6 的来源与快照，且修改同一 `workflow.ts`；不能与任务 6 作为完整任务并行。 |
| 8. 报告、主张、引用、质量与制品 | 任务 7 | 否 | 依赖证据和覆盖度结果生成正式报告，并继续修改同一工作流。 |
| 9. HTTP API、SSE、Feature Flag 与 Renderer API | 任务 4、稳定 DTO | 不建议 | 在切片门禁下需要等待前序工作流能力稳定；任务内部可将服务端路由与 Renderer API 按冻结契约分工。 |
| 10. Zustand Store | 任务 9 | 不建议 | 消费 Renderer API 与事件协议；只能提前并行编写纯事件 reducer 和夹具测试。 |
| 11. Workbench UI | 任务 10 | 不建议 | 依赖 Store 的状态、action 和 selector；可用 Mock Store 提前完成纯展示组件和布局。 |
| 12. Chat 路由、Run 部件与兼容 | 任务 9、11 | 不建议 | 需要稳定状态 API 和 Workbench；可提前编写 Mock 下的路由测试，最终集成必须等待任务 9 与 11。 |
| 13. 恢复与可观测性 | 任务 3、4、5 | 否 | 需要租约、事件、门面、执行器和运行时的稳定语义；虽然实现依赖较早完成，仍须遵守切片 5 门禁。 |
| 14. 夹具、验收与旧版退役 | 任务 1 至 13 | 否 | 是最终集成与发布门禁；退役旧路径、删除文件和全量验证只能最后完成。 |

### 推荐并发安排

1. **切片 1：顺序完成任务 1 -> 2 -> 3。** 任务 1 完成后可并行进行任务 2 的迁移方案评审和测试数据准备，但实现与合并必须等待契约冻结。任务 3 完成后，先以小提交冻结 Repository 与运行时适配接口。
2. **切片 1 收束：受控并行任务 4 || 5。** 任务 4 负责 `src/server/deepresearch/`、`src/server/services/deepresearch/` 中的门面和执行器；任务 5 负责 `src/server/mastra/deepresearch/` 中的运行时与骨架工作流。由单一责任人维护跨边界的 adapter 契约，并在二者合并后执行端到端集成测试。
3. **切片 2：顺序完成任务 6 -> 7。** 可以在单个任务内部按检索服务、Agent 提示词、步骤测试等维度分工，但 `workflow.ts` 必须指定单一合并责任人。
4. **切片 3：单独完成任务 8。** 报告、质量门禁和制品写入直接消费任务 7 的证据结果，不应与前一任务交叉合并。
5. **切片 4：顺序完成任务 9 -> 10 -> 11 -> 12。** 允许在冻结 API 后并行准备 Renderer DTO、Store 的纯 reducer 测试、Mock Store 下的展示组件与 Chat 路由测试；这些准备工作不应绕过最终接入顺序。
6. **切片 5：顺序完成任务 13 -> 14。** 任务 14 的确定性夹具内容可提前作为非执行性资产准备，但验收运行、Feature Flag 切换和旧版执行路径退役必须等待任务 13、全量回归和发布门禁全部完成。

### 高风险文件冲突与所有权

| 文件或目录 | 涉及任务 | 协作要求 |
|---|---|---|
| `src/server/mastra/deepresearch/workflow.ts` | 5、6、7、8 | 指定单一 owner 顺序合并，禁止并行任务各自直接改动后再批量合并。 |
| `src/server/mastra/deepresearch/workflow-context.ts` | 5、13 | 先冻结 context 字段和恢复语义；任务 13 以增量方式扩展。 |
| `src/server/config/config.ts` | 9、13、14 | Feature Flag、恢复配置和退役删除共用该文件，按任务顺序合并。 |
| `src/server/http/routes/deep-research.ts` | 9、14 | API 实现与最终验收/退役在同一文件，任务 14 只能在任务 9 稳定后修改。 |
| `src/renderer/pages/Chat/ChatPanelMastra.tsx` | 12、14 | Chat 集成与旧路径退役存在直接冲突，任务 14 最后处理。 |
| `src/renderer/pages/Chat/deepresearch/` | 10、11、12 | Store、Workbench 与 Chat 接入通过明确的 selector/action 接口协作，避免跨任务重构。 |
| `src/server/mastra/index.ts`、`agents/team.ts`、`tools.ts` | 5、14 | 运行时注册与旧执行路径清理共享集成边界，任务 14 负责最终删除。 |

### 并行协作规则

- 每个并行包使用独立 Worktree 或分支；共享接口先以小而可审查的提交冻结，再允许下游实现开始接入。
- 对高冲突文件指定单一 owner。其他实现者通过新增模块、测试或接口适配提交协作，避免多分支同时重写同一文件。
- 并行任务完成后先合并共同契约和低冲突模块，再合并集成点；每一个合并波次运行该切片要求的聚焦测试、`npm run typecheck` 和构建检查。
- 不将“可提前准备测试、夹具、Mock 或布局”记作“可以并行完成整个任务”。任何需要真实运行时、真实 API 或真实 Store 的最终验证，仍以本计划的顺序依赖为准。
