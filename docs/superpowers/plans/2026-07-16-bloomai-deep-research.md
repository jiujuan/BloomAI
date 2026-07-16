# BloomAI Deep Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent, durable, evidence-driven Deep Research module and connect the Chat Research tab to it.

**Architecture:** BloomAI owns research domain state, evidence, reports, events, and artifacts in the main SQLite database. A dedicated persistent Mastra instance orchestrates bounded workflow steps; deterministic services own retrieval, curation, budgets, state transitions, citations, and recovery. Chat and HTTP consume a stable DeepResearchModule facade.

**Tech Stack:** TypeScript, Hono, Drizzle SQLite, Mastra 1.49, LibSQLStore, Zod, Zustand, React 18, AI SDK 6, Vitest.

---

## File Map

Shared contracts:

- Create src/shared/deepresearch/contracts.ts for JSON-safe DTOs and enums.
- Create src/shared/deepresearch/events.ts for stable event unions.
- Create src/shared/deepresearch/schemas.ts for Zod API validation.
- Create src/shared/deepresearch/index.ts as the shared export boundary.

Server module and adapters:

- Create src/server/deepresearch/domain/state-machine.ts, budgets.ts, profiles.ts, quality.ts, and errors.ts.
- Create scripts/migrations/008-deep-research-core.sql and extend src/server/db/schema.ts.
- Create focused repositories under src/server/db/repositories/deepresearch.
- Create deterministic services under src/server/services/deepresearch.
- Create a dedicated runtime under src/server/mastra/deepresearch.
- Create src/server/deepresearch/deep-research.service.ts and index.ts as the public facade.
- Create src/server/http/routes/deep-research.ts and register it in src/server/http/app.ts.

Renderer:

- Extend src/renderer/api/index.ts with Deep Research endpoints.
- Create the Zustand store and workbench components under src/renderer/pages/Chat/deepresearch.
- Modify src/renderer/pages/Chat/ChatPanelMastra.tsx to make the Research tab open the workbench.
- Modify src/server/mastra/agents/team.ts and src/server/http/routes/chat.ts only for compatibility routing removal.

Verification:

- Add unit, migration, repository, workflow, route, store, and component tests next to the relevant files.
- Add deterministic fixtures under src/server/deepresearch/test-fixtures.

## Task 1: Shared Contracts, State Machine, Profiles, and Budgets

**Files:**

- Create: src/shared/deepresearch/contracts.ts
- Create: src/shared/deepresearch/events.ts
- Create: src/shared/deepresearch/schemas.ts
- Create: src/shared/deepresearch/index.ts
- Create: src/server/deepresearch/domain/state-machine.ts
- Create: src/server/deepresearch/domain/state-machine.test.ts
- Create: src/server/deepresearch/domain/profiles.ts
- Create: src/server/deepresearch/domain/profiles.test.ts
- Create: src/server/deepresearch/domain/budgets.ts
- Create: src/server/deepresearch/domain/budgets.test.ts
- Create: src/server/deepresearch/domain/errors.ts

- [ ] **Step 1: Write failing state, profile, and budget tests**

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

- [ ] **Step 2: Run the tests and verify failure**

Run: npx vitest run src/server/deepresearch/domain/state-machine.test.ts src/server/deepresearch/domain/profiles.test.ts src/server/deepresearch/domain/budgets.test.ts

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement shared contracts and schemas**

Define ResearchProfile, ResearchDepth, ResearchRunStatus, StartResearchInput, ResearchRunFilter, ResearchClarificationInput, ResearchBriefDto, ResearchRunDto, ResearchRunDetailDto, ResearchQuestionDto, ResearchCoverageDto, ResearchSearchQueryDto, ResearchSourceDto, ResearchSourceSnapshotDto, ResearchEvidenceDto, ResearchReportSectionDto, ResearchClaimDto, ResearchCitationDto, ResearchReportDto, ResearchQualityDto, ResearchBudgetDto, ResearchUsageDto, ResearchEventDto, ResearchArtifactDto, and ResearchArtifactContent in contracts.ts. Export one discriminated ResearchEvent union in events.ts and make ResearchEventDto its JSON-safe serialized form. Implement startResearchSchema and clarificationSchema in schemas.ts.

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

Implement the explicit transition map and frozen profile and budget objects. Domain errors must carry code, retryable, and message.

- [ ] **Step 4: Run focused tests**

Run: npx vitest run src/server/deepresearch/domain

Expected: PASS.

- [ ] **Step 5: Commit the domain foundation**

~~~bash
git add src/shared/deepresearch src/server/deepresearch/domain
git commit -m "feat(deepresearch): add domain contracts and policies"
~~~

## Task 2: Database Migration and Drizzle Schema

**Files:**

- Create: scripts/migrations/008-deep-research-core.sql
- Modify: src/server/db/schema.ts
- Modify: src/server/db/migrations.test.ts

- [ ] **Step 1: Add migration expectations**

Extend migrations.test.ts so a fresh database contains version 008-deep-research-core and these tables:

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

Also assert unique indexes for research_events(run_id, sequence), research_sources(run_id, canonical_url), and every idempotency_key within its Run.

- [ ] **Step 2: Run migration tests and verify failure**

Run: npx vitest run src/server/db/migrations.test.ts

Expected: FAIL because migration 008 and its tables are absent.

- [ ] **Step 3: Create the SQL migration**

The migration must create all twelve tables from the specification. Use TEXT for JSON and enums, INTEGER for timestamps and booleans, and the following required run columns:

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

Each child table must include run_id with ON DELETE CASCADE. Snapshot and evidence text remain in dedicated tables. Add indexes for run status, question parent/order, query status, source selection, evidence question, section ordinal, claim section, citation ordinal, event sequence, and artifact run/type.

- [ ] **Step 4: Mirror the migration in Drizzle schema**

Add sqliteTable declarations with matching column names and indexes. Export them using snake_case names consistent with the existing schema.ts style.

- [ ] **Step 5: Run migration and type checks**

Run: npx vitest run src/server/db/migrations.test.ts

Expected: PASS.

Run: npm run typecheck

Expected: PASS.

- [ ] **Step 6: Commit the schema**

~~~bash
git add scripts/migrations/008-deep-research-core.sql src/server/db/schema.ts src/server/db/migrations.test.ts
git commit -m "feat(deepresearch): add persistent research schema"
~~~

## Task 3: Repositories, Events, Lease, and Aggregate Reads

**Files:**

- Create: src/server/db/repositories/deepresearch/research-run.repo.ts
- Create: src/server/db/repositories/deepresearch/research-question.repo.ts
- Create: src/server/db/repositories/deepresearch/research-source.repo.ts
- Create: src/server/db/repositories/deepresearch/research-evidence.repo.ts
- Create: src/server/db/repositories/deepresearch/research-report.repo.ts
- Create: src/server/db/repositories/deepresearch/research-event.repo.ts
- Create: src/server/db/repositories/deepresearch/repositories.test.ts

- [ ] **Step 1: Write repository tests**

Test creation, legal transition plus event, monotonic event sequence, lease acquisition, expired lease takeover, canonical URL uniqueness, immutable snapshots, idempotent evidence insertion, stable citation ordinals, and cascade deletion.

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

- [ ] **Step 2: Run tests and verify failure**

Run: npx vitest run src/server/db/repositories/deepresearch/repositories.test.ts

Expected: FAIL because repositories do not exist.

- [ ] **Step 3: Implement repositories**

Use getOrmDb, Drizzle transactions where multiple main-database rows must change together, uuidv4 IDs, JSON decode helpers, and explicit DTO mapping. Implement transitionWithEvent in research-run.repo.ts so run status and its event commit in one main-database transaction.

Implement event append by selecting MAX(sequence) inside the same transaction and retry once on the unique constraint. Implement acquireLease with one conditional UPDATE that succeeds only when lease is absent, expired, or already owned by the same executor.

- [ ] **Step 4: Run repository and migration tests**

Run: npx vitest run src/server/db/repositories/deepresearch src/server/db/migrations.test.ts

Expected: PASS.

- [ ] **Step 5: Commit repositories**

~~~bash
git add src/server/db/repositories/deepresearch
git commit -m "feat(deepresearch): persist runs evidence and events"
~~~

## Task 4: Module Facade and Background Executor

**Files:**

- Create: src/server/deepresearch/deep-research.service.ts
- Create: src/server/deepresearch/deep-research.service.test.ts
- Create: src/server/deepresearch/executor.ts
- Create: src/server/deepresearch/index.ts

- [ ] **Step 1: Write lifecycle tests with a fake runtime**

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

- [ ] **Step 2: Verify the tests fail**

Run: npx vitest run src/server/deepresearch/deep-research.service.test.ts

Expected: FAIL because service and executor are absent.

- [ ] **Step 3: Implement lifecycle use cases**

DeepResearchService validates input, creates a queued Run, emits research.run.created, and schedules executor.start without binding execution to the HTTP request. cancelRun sets cancelling. resumeRun accepts interrupted and retryable failed states, clears terminal error fields, and queues execution. answerClarification persists the answer before calling runtime resume. src/server/deepresearch/index.ts constructs and exports exactly one deepResearchModule singleton so HTTP routes and startup recovery share the same repositories, publisher, executor, and Mastra runtime.

Executor generates a process-unique executor ID, acquires a 30-second lease, renews every 10 seconds, invokes the runtime adapter, and always releases the lease. It reports failures through transitionWithEvent and preserves retryable classification.

- [ ] **Step 4: Run service tests**

Run: npx vitest run src/server/deepresearch/deep-research.service.test.ts

Expected: PASS.

- [ ] **Step 5: Commit lifecycle services**

~~~bash
git add src/server/deepresearch/deep-research.service.ts src/server/deepresearch/deep-research.service.test.ts src/server/deepresearch/executor.ts src/server/deepresearch/index.ts
git commit -m "feat(deepresearch): add durable run lifecycle facade"
~~~

## Task 5: Dedicated Mastra Runtime and Skeleton Workflow

**Files:**

- Create: src/server/mastra/deepresearch/mastra.ts
- Create: src/server/mastra/deepresearch/workflow-context.ts
- Create: src/server/mastra/deepresearch/workflow.ts
- Create: src/server/mastra/deepresearch/workflow.test.ts
- Create: src/server/mastra/deepresearch/agents/brief-planner.ts
- Create: src/server/mastra/deepresearch/steps/load-run.ts
- Create: src/server/mastra/deepresearch/steps/build-brief.ts
- Create: src/server/mastra/deepresearch/steps/finalize-skeleton.ts

- [ ] **Step 1: Write a fixture-backed workflow test**

The fake Brief Planner returns a fixed structured brief. Assert queued -> planning -> completed_with_limitations, persisted workflow_run_id, brief, events, and a skeleton Markdown artifact. Add a second case where the planner marks one ambiguity critical: the Run becomes awaiting_input, the Mastra Run suspends, answerClarification persists the answer, and resume continues from planning without creating a second brief.

- [ ] **Step 2: Run and verify failure**

Run: npx vitest run src/server/mastra/deepresearch/workflow.test.ts

Expected: FAIL because the runtime does not exist.

- [ ] **Step 3: Implement the dedicated runtime**

Resolve a managed data path and create deep-research-runtime.db with LibSQLStore. Register only Deep Research agents and deep-research-v1. Export a DeepResearchRuntimeAdapter with start(runId) and resume(runId, resumeData). Build the workflow with typed createStep boundaries and commit it once after the full chain is assembled.

The build-brief step branches on criticalClarifications: persist the questions, transition the Domain Run to awaiting_input, emit research.run.awaiting_input, and call suspend with runId plus clarification IDs. Resume data is validated with clarificationSchema before the workflow returns to the saved resumePhase. Every step receives runId, loads current domain state, calls assertRunnable and assertBudgetAvailable, persists output with idempotency keys, and returns typed data. The test runtime accepts injected storage, planner, and repositories so it never calls a real model.

- [ ] **Step 4: Run workflow and service tests**

Run: npx vitest run src/server/mastra/deepresearch src/server/deepresearch/deep-research.service.test.ts

Expected: PASS.

- [ ] **Step 5: Commit the runtime skeleton**

~~~bash
git add src/server/mastra/deepresearch
git commit -m "feat(deepresearch): add persistent Mastra workflow runtime"
~~~

## Task 6: Search, Source Curation, Fetching, and Snapshots

**Files:**

- Create: src/server/services/deepresearch/search-service.ts
- Create: src/server/services/deepresearch/source-curator.ts
- Create: src/server/services/deepresearch/content-service.ts
- Create: src/server/services/deepresearch/retrieval.test.ts
- Create: src/server/mastra/deepresearch/agents/query-planner.ts
- Create: src/server/mastra/deepresearch/steps/plan-questions.ts
- Create: src/server/mastra/deepresearch/steps/plan-queries.ts
- Create: src/server/mastra/deepresearch/steps/execute-searches.ts
- Create: src/server/mastra/deepresearch/steps/curate-sources.ts
- Create: src/server/mastra/deepresearch/steps/fetch-sources.ts
- Modify: src/server/mastra/deepresearch/workflow.ts

- [ ] **Step 1: Write deterministic retrieval tests**

Use fixtures containing tracking URLs, duplicate domains, redirects, primary sources, stale sources, one transient provider failure, one failed fetch, a private-network redirect, and instruction-like text inside a page. Assert canonicalization, diversity, profile scoring, bounded concurrency, deadline-bounded retry, SSRF rejection, persisted failures, and immutable content-hash snapshots.

- [ ] **Step 2: Verify failure**

Run: npx vitest run src/server/services/deepresearch/retrieval.test.ts

Expected: FAIL because retrieval services are absent.

- [ ] **Step 3: Implement retrieval services**

SearchService calls executeLegacyToolCapability with caller workflow, the real sessionId or runId, web_search, and a budget-capped result limit. ContentService calls web_fetch and web_extract, validates the initial and final URL with the existing Tool Policy, rejects non-http(s), localhost, private/link-local ranges, and unsafe redirects, hashes normalized content with SHA-256, and writes snapshots. SourceCurator applies canonical URL normalization, domain concentration caps, and profile weights.

Retry only timeout, rate-limit, and provider-unavailable failures with at most two exponential-backoff attempts, capped by the Run deadline and remaining Budget. Never persist Authorization headers, cookies, secrets, or local paths. Treat fetched text as untrusted source data in every Agent prompt; page instructions cannot change system or workflow policy. Use a small mapWithConcurrency helper local to the module. It must preserve input order, stop scheduling after cancellation, and collect per-item failures without rejecting the entire batch.

- [ ] **Step 4: Wire typed workflow steps**

Planner output must satisfy Zod schemas. Persist each question and query before execution. Search and fetch events must include counts and stable IDs, never raw page content.

- [ ] **Step 5: Run focused tests**

Run: npx vitest run src/server/services/deepresearch/retrieval.test.ts src/server/mastra/deepresearch/workflow.test.ts

Expected: PASS.

- [ ] **Step 6: Commit retrieval**

~~~bash
git add src/server/services/deepresearch src/server/mastra/deepresearch
git commit -m "feat(deepresearch): add structured source retrieval"
~~~

## Task 7: Evidence Extraction, Coverage, and Gap-Filling Loop

**Files:**

- Create: src/server/services/deepresearch/evidence-service.ts
- Create: src/server/services/deepresearch/evidence-service.test.ts
- Create: src/server/mastra/deepresearch/agents/evidence-analyst.ts
- Create: src/server/mastra/deepresearch/agents/gap-analyst.ts
- Create: src/server/mastra/deepresearch/steps/extract-evidence.ts
- Create: src/server/mastra/deepresearch/steps/assess-coverage.ts
- Create: src/server/mastra/deepresearch/steps/gap-fill-iteration.ts
- Modify: src/server/mastra/deepresearch/workflow.ts

- [ ] **Step 1: Write evidence and loop tests**

Assert that snippets are rejected as evidence, passages remain bounded, evidence is linked to one question and snapshot, contradictory evidence is retained, high-priority uncovered questions generate follow-up queries, and the loop stops on coverage, low information gain, cancellation, or maxIterations.

- [ ] **Step 2: Verify failure**

Run: npx vitest run src/server/services/deepresearch/evidence-service.test.ts

Expected: FAIL because evidence services are absent.

- [ ] **Step 3: Implement bounded evidence packets**

Chunk snapshots by headings and character offsets. Evidence packets contain source metadata and chunks up to a configured character budget. Validate Evidence Analyst output with a schema requiring passage, summary, stance, confidence, questionId, snapshotId, and offsets.

Coverage per question must calculate independent domains, evidence categories, primary-source count, recent-source count, supporting evidence, contradicting evidence, and single-source dependency.

- [ ] **Step 4: Implement Mastra `dountil` gap filling**

The loop body accepts the coverage matrix, creates only missing queries, executes retrieval and evidence extraction, records marginal new evidence, increments usage.iterations, and stops under the exact Budget policy from Task 1.

- [ ] **Step 5: Run evidence and workflow tests**

Run: npx vitest run src/server/services/deepresearch/evidence-service.test.ts src/server/mastra/deepresearch/workflow.test.ts

Expected: PASS.

- [ ] **Step 6: Commit evidence research loop**

~~~bash
git add src/server/services/deepresearch/evidence-service.ts src/server/services/deepresearch/evidence-service.test.ts src/server/mastra/deepresearch
git commit -m "feat(deepresearch): add evidence ledger and gap filling"
~~~

## Task 8: Report Drafting, Claims, Citations, Quality, and Artifacts

**Files:**

- Create: src/server/services/deepresearch/citation-service.ts
- Create: src/server/services/deepresearch/artifact-service.ts
- Create: src/server/services/deepresearch/report-quality.test.ts
- Create: src/server/mastra/deepresearch/agents/section-writer.ts
- Create: src/server/mastra/deepresearch/agents/claim-extractor.ts
- Create: src/server/mastra/deepresearch/agents/citation-verifier.ts
- Create: src/server/mastra/deepresearch/agents/report-critic.ts
- Create: src/server/mastra/deepresearch/steps/build-outline.ts
- Create: src/server/mastra/deepresearch/steps/draft-sections.ts
- Create: src/server/mastra/deepresearch/steps/extract-claims.ts
- Create: src/server/mastra/deepresearch/steps/verify-citations.ts
- Create: src/server/mastra/deepresearch/steps/repair-report.ts
- Create: src/server/mastra/deepresearch/steps/assess-quality.ts
- Create: src/server/mastra/deepresearch/steps/finalize-artifacts.ts
- Modify: src/server/mastra/deepresearch/workflow.ts

- [ ] **Step 1: Write report quality tests**

Test stable citation ordinals, cross-run rejection, unsupported important claims, partial support, contradictions, profile required sections, completed versus completed_with_limitations, and Markdown plus JSON output.

~~~ts
expect(() => citationService.bind({ runId: 'a', claimId, evidenceIdFromRunB })).toThrowError('RESEARCH_CROSS_RUN_CITATION')
expect(assessQuality(reportWithUnsupportedCriticalClaim).releaseStatus).toBe('failed')
expect(assessQuality(reportAtBudgetWithDisclosedGaps).releaseStatus).toBe('completed_with_limitations')
~~~

- [ ] **Step 2: Verify failure**

Run: npx vitest run src/server/services/deepresearch/report-quality.test.ts

Expected: FAIL because reporting services are absent.

- [ ] **Step 3: Implement report pipeline**

Build the outline from the frozen profile requirements plus planned sections. Draft sections through a typed Mastra foreach step with bounded concurrency and per-section evidence allowlists. Persist drafts before claim extraction. Bind each factual claim to Evidence IDs and assign ordinals in first-use order. Verifier output includes status and rationale but never changes the quoted evidence.

Repair only failed sentences. If a repaired sentence adds a factual claim without an Evidence ID, reject it and keep the limitation. assessQuality applies the specification gates exactly: high-priority question coverage >= 0.80, factual Claim citation coverage >= 0.90, supported or partially_supported citations >= 0.90, zero high-importance unsupported Claims, at least three independent cited domains unless scope forbids it, 100% contradiction disclosure, and 100% required-section coverage.

ArtifactService writes under the managed Deep Research artifact directory using server-generated names and atomic temporary-file rename. Export verified Markdown, structured JSON, evidence appendix, reference list, research method, limitations, and run manifest.

- [ ] **Step 4: Run report and end-to-end fixture workflow tests**

Run: npx vitest run src/server/services/deepresearch/report-quality.test.ts src/server/mastra/deepresearch/workflow.test.ts

Expected: PASS with a completed fixture report and stable citations.

- [ ] **Step 5: Commit verified reporting**

~~~bash
git add src/server/services/deepresearch src/server/mastra/deepresearch
git commit -m "feat(deepresearch): generate verified cited reports"
~~~

## Task 9: HTTP API, SSE, Feature Status, and Renderer Client

**Files:**

- Create: src/server/http/routes/deep-research.ts
- Create: src/server/http/routes/deep-research.test.ts
- Modify: src/server/config/config.ts
- Modify: src/server/http/app.ts
- Modify: src/renderer/api/index.ts

- [ ] **Step 1: Write route and feature-flag tests**

Cover the always-available GET /status response, 201 creation when enabled, rejection of Run endpoints when disabled, validation failure, list/detail, event pagination, Last-Event-ID reconnect, clarification, cancel, resume, run-artifact relationship, and structured error codes.

- [ ] **Step 2: Verify failure**

Run: npx vitest run src/server/http/routes/deep-research.test.ts

Expected: FAIL because routes and the flag parser are absent.

- [ ] **Step 3: Implement the flag and Hono routes**

Add one server-side parser in src/server/config/config.ts:

~~~ts
export function isDeepResearchV2Enabled(): boolean {
  const value = readConfigValue('DEEP_RESEARCH_V2_ENABLED', 'false').value.toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}
~~~

GET /status is always registered and returns { enabled, version: 'v2' }. Guard all /runs handlers with the flag so disabled mode cannot create or mutate V2 Runs. Use startResearchSchema and clarificationSchema. GET stream uses Hono streamSSE, sends persisted sequence as event ID, then subscribes to the module event publisher. Close the subscription on request abort. Artifact responses set content type and content disposition from stored metadata.

Register with:

~~~ts
app.route('/api/v1/deep-research', deepResearchRoutes)
~~~

- [ ] **Step 4: Add renderer API methods**

Add getStatus, start, list, get, listEvents, answerClarification, cancel, resume, and artifact URL helpers using shared DTOs. Preserve the existing apiFetch error contract. getStatus returns { enabled: false, version: 'v2' } on a 404 from an older server so the renderer safely uses the legacy path during mixed-version rollout.

- [ ] **Step 5: Run route tests and typecheck**

Run: npx vitest run src/server/http/routes/deep-research.test.ts

Expected: PASS.

Run: npm run typecheck

Expected: PASS.

- [ ] **Step 6: Commit API surface**

~~~bash
git add src/server/http/routes/deep-research.ts src/server/http/routes/deep-research.test.ts src/server/config/config.ts src/server/http/app.ts src/renderer/api/index.ts
git commit -m "feat(deepresearch): expose flagged run and event APIs"
~~~

## Task 10: Renderer Store and Event Reduction

**Files:**

- Create: src/renderer/pages/Chat/deepresearch/deep-research.types.ts
- Create: src/renderer/pages/Chat/deepresearch/deep-research.store.ts
- Create: src/renderer/pages/Chat/deepresearch/deep-research.store.test.ts

- [ ] **Step 1: Write store tests**

Test launcher defaults, start and active Run hydration, ordered event reduction, duplicate event suppression, polling fallback, reconnect cursor, terminal stop, cancel, resume, clarification, and error retention.

- [ ] **Step 2: Verify failure**

Run: npx vitest run src/renderer/pages/Chat/deepresearch/deep-research.store.test.ts

Expected: FAIL because the store is absent.

- [ ] **Step 3: Implement the Zustand store**

State includes draft, activeRunId, run, questions, sources, report, evidenceById, events, lastSequence, selectedView, selectedEvidenceId, loading, and error. Actions call the renderer API and apply events only when sequence is greater than lastSequence.

Use EventSource for live progress when available and a two-second listEvents fallback after disconnect. Always refresh Run detail after terminal, awaiting_input, or artifact events.

- [ ] **Step 4: Run store tests**

Run: npx vitest run src/renderer/pages/Chat/deepresearch/deep-research.store.test.ts

Expected: PASS.

- [ ] **Step 5: Commit renderer state**

~~~bash
git add src/renderer/pages/Chat/deepresearch/deep-research.types.ts src/renderer/pages/Chat/deepresearch/deep-research.store.ts src/renderer/pages/Chat/deepresearch/deep-research.store.test.ts
git commit -m "feat(deepresearch): add recoverable research UI state"
~~~

## Task 11: Deep Research Workbench UI

**Files:**

- Create: src/renderer/pages/Chat/deepresearch/DeepResearchLauncher.tsx
- Create: src/renderer/pages/Chat/deepresearch/DeepResearchRunView.tsx
- Create: src/renderer/pages/Chat/deepresearch/ResearchProgress.tsx
- Create: src/renderer/pages/Chat/deepresearch/ResearchQuestionTree.tsx
- Create: src/renderer/pages/Chat/deepresearch/ResearchSourcesPanel.tsx
- Create: src/renderer/pages/Chat/deepresearch/ResearchReportView.tsx
- Create: src/renderer/pages/Chat/deepresearch/ResearchEvidencePanel.tsx
- Create: src/renderer/pages/Chat/deepresearch/DeepResearchWorkbench.test.tsx
- Modify: src/renderer/styles/global.css

- [ ] **Step 1: Write component behavior tests**

Test four Profile controls, three Depth controls, validation, progress, question coverage, selected versus rejected sources, report citation click, evidence drawer, clarification form, cancel, resume, retry, and export.

- [ ] **Step 2: Verify failure**

Run: npx vitest run src/renderer/pages/Chat/deepresearch/DeepResearchWorkbench.test.tsx

Expected: FAIL because the components are absent.

- [ ] **Step 3: Implement the launcher and run shell**

Use compact segmented controls for Profile and Depth, standard inputs for scope, and icon buttons with existing icon library for cancel, resume, retry, and export. The workbench is an operational tool, not a landing page: no hero, decorative cards, or explanatory marketing copy.

Run View uses stable tabs: Overview, Questions, Sources, Report, Evidence, Activity. Report citations are buttons styled as inline references and call selectEvidence(citation.evidenceId).

- [ ] **Step 4: Add responsive layout**

Desktop uses a constrained content column plus evidence side panel. Narrow view stacks the panel below the report. Give progress rows, citation controls, and source tables stable min/max dimensions; do not let dynamic labels shift neighboring controls.

- [ ] **Step 5: Run UI tests and typecheck**

Run: npx vitest run src/renderer/pages/Chat/deepresearch

Expected: PASS.

Run: npm run typecheck

Expected: PASS.

- [ ] **Step 6: Commit the workbench**

~~~bash
git add src/renderer/pages/Chat/deepresearch src/renderer/styles
git commit -m "feat(deepresearch): add research workbench"
~~~

## Task 12: Chat Routing, Run Links, and Legacy Compatibility

**Files:**

- Modify: src/renderer/pages/Chat/ChatPanelMastra.tsx
- Modify: src/renderer/pages/Chat/parts/tool-part.ts
- Create: src/renderer/pages/Chat/deepresearch/ResearchRunPart.tsx
- Create: src/renderer/pages/Chat/deepresearch/chat-routing.test.tsx
- Create: src/server/http/routes/chat-research-routing.test.ts
- Modify: src/server/http/routes/chat.ts

- [ ] **Step 1: Write routing and persisted-part tests**

Assert that enabled status makes the Research tab render DeepResearchWorkbench and never send x-bloom-agent: research. Assert disabled status preserves the legacy Research Agent request. Assert ordinary chat, writing, and coding headers are unchanged. Assert data-research-run parts survive slimParts, reload, and click-through to the matching Run, while old data-workflow parts still render after reload.

- [ ] **Step 2: Verify failure**

Run: npx vitest run src/renderer/pages/Chat/deepresearch/chat-routing.test.tsx src/server/http/routes/chat-research-routing.test.ts

Expected: FAIL because Research still routes directly to researchAgent and data-research-run is not rendered.

- [ ] **Step 3: Integrate the Research tab behind server status**

On Chat mount, call deepResearchApi.getStatus(). When enabled, selecting Research renders DeepResearchWorkbench and submission uses POST /api/v1/deep-research/runs. When disabled or when status returns the older-server fallback, preserve the current x-bloom-agent: research request path.

Keep TEAM_AGENT_BY_TAB.research during the rollout phase. In src/server/http/routes/chat.ts, reject x-bloom-agent: research with RESEARCH_USE_DEEP_RESEARCH_API when V2 is enabled; when disabled, continue resolving the legacy research Agent. This server guard prevents stale renderers from starting shallow research after V2 is enabled.

- [ ] **Step 4: Add the persisted Research Run UI part**

ResearchRunPart receives { runId, title, status, artifactId }, displays a compact status row, and opens that Run in DeepResearchWorkbench. Extend slimParts and assistant-part rendering for data-research-run without changing data-workflow handling. Persist the part through the existing POST /api/v1/chat/assistant endpoint; do not copy report text into Chat messages.

- [ ] **Step 5: Run routing and Chat regression tests**

Run: npx vitest run src/renderer/pages/Chat/deepresearch/chat-routing.test.tsx src/server/http/routes/chat-research-routing.test.ts src/server/http/routes/chat-plan.test.ts

Expected: PASS.

- [ ] **Step 6: Commit Chat integration**

~~~bash
git add src/renderer/pages/Chat src/server/http/routes/chat.ts
git commit -m "feat(deepresearch): route research tab to durable runs"
~~~

## Task 13: Startup Recovery and Observability

**Files:**

- Create: src/server/deepresearch/recovery.ts
- Create: src/server/deepresearch/recovery.test.ts
- Modify: src/server/config/config.ts
- Modify: src/server/index.ts
- Modify: src/server/telemetry/metrics.ts
- Modify: src/server/mastra/deepresearch/workflow-context.ts

- [ ] **Step 1: Write recovery tests**

Create fixtures for an expired researching lease with a matching suspended Mastra Run, an expired Run with no Mastra state, and a still-valid lease. Assert only expired runs are interrupted, reconciliation is idempotent, DEEP_RESEARCH_AUTO_RESUME=false leaves interrupted Runs resumable by the user, and DEEP_RESEARCH_AUTO_RESUME=true queues each eligible Run exactly once.

- [ ] **Step 2: Verify failure**

Run: npx vitest run src/server/deepresearch/recovery.test.ts

Expected: FAIL because recovery is absent.

- [ ] **Step 3: Implement reconciliation before server listen**

Add isDeepResearchAutoResumeEnabled() to src/server/config/config.ts with the same strict 1/true/on parser as the V2 flag and a false default. In src/server/index.ts, make the runMigrations().then(...) callback async, await deepResearchModule.recoverInterruptedRuns() after runMigrations() resolves, and only then call createHonoApp() and serve(...). Compare Domain status, Lease, workflow_run_id, and Mastra Run state. Emit one research.run.status_changed event per actual correction and use an idempotent recovery command key before auto-resume scheduling.

- [ ] **Step 4: Add privacy-safe metrics and traces**

Add counters and histograms for run completion, limitations, cancellation, failure, resume, search latency, fetch latency, sources selected, evidence count, claim verification, gap iterations, and end-to-end duration. Trace attributes contain research.run.id, workflow.run.id, profile, depth, phase, and numeric counts; they never contain topic, queries, URLs, source text, attachment names, report text, or error payloads that may contain secrets.

- [ ] **Step 5: Run recovery and telemetry tests**

Run: npx vitest run src/server/deepresearch/recovery.test.ts src/server/telemetry

Expected: PASS.

- [ ] **Step 6: Commit recovery**

~~~bash
git add src/server/deepresearch/recovery.ts src/server/deepresearch/recovery.test.ts src/server/config/config.ts src/server/index.ts src/server/telemetry/metrics.ts src/server/mastra/deepresearch/workflow-context.ts
git commit -m "feat(deepresearch): recover and observe long research runs"
~~~

## Task 14: Evaluation, Acceptance, and Release-Gated Legacy Retirement

**Files:**

- Create: src/server/deepresearch/test-fixtures/general.json
- Create: src/server/deepresearch/test-fixtures/market.json
- Create: src/server/deepresearch/test-fixtures/competitor.json
- Create: src/server/deepresearch/test-fixtures/academic.json
- Create: src/server/deepresearch/deep-research.acceptance.test.ts
- Modify: src/server/http/routes/deep-research.ts
- Modify: src/server/http/routes/chat.ts
- Modify: src/server/config/config.ts
- Modify: src/server/mastra/index.ts
- Modify: src/server/mastra/agents/team.ts
- Modify: src/server/mastra/tools.ts
- Modify: src/renderer/pages/Chat/ChatPanelMastra.tsx
- Delete after the release gate passes: src/server/mastra/workflows/deep-research.ts
- Delete after the release gate passes: src/server/mastra/agents/research-planner-agent.ts
- Delete after the release gate passes: src/server/mastra/agents/research-writer-agent.ts

- [ ] **Step 1: Add four deterministic acceptance fixtures**

Each fixture contains intake, planner output, search responses, fetched documents, expected required sections, minimum independent domains, expected contradictions, and expected final status. Fixture sources use reserved example domains and contain no live copyrighted articles.

- [ ] **Step 2: Write end-to-end acceptance tests**

Run all four Profiles through fake adapters. Assert question policy, source selection, evidence ledger, gap filling where configured, citation click target IDs, quality gates, artifact content, cancellation, clarification suspend/resume, and restart recovery. Assert every displayed citation resolves to an Evidence ID from the same Run and no high-importance unsupported Claim appears in a completed report.

- [ ] **Step 3: Run the full automated verification**

Run: npm test

Expected: PASS.

Run: npm run typecheck

Expected: PASS.

Run: npm run build

Expected: PASS.

- [ ] **Step 4: Perform fixture-backed runtime UI verification**

Start the application with fixture adapters and DEEP_RESEARCH_V2_ENABLED=true. Complete one Standard fixture Run, reload the renderer during researching, open a report citation, cancel a second Run, answer a clarification, and resume an interrupted Run. Capture desktop and narrow screenshots and verify no clipped text, overlapping controls, blank views, or broken citations.

- [ ] **Step 5: Perform the separate Live Web smoke test**

With the normal Capability Broker and an enabled search provider, run one Standard general research topic. Verify at least eight planned questions when the topic warrants them, more than three discovered sources, persisted fetch failures or limitations, exact Evidence navigation, bounded completion, and a Markdown plus JSON export. This smoke test is manual and separate from deterministic CI because live providers and web content are not stable.

- [ ] **Step 6: Apply the release retirement gate**

Retire the legacy path only after Steps 1-5 pass, the product release has selected V2 as the only Research experience, and persisted data-workflow rendering passes its regression test. Then remove the DEEP_RESEARCH_V2_ENABLED fallback branch, make GET /status return enabled: true, reject all x-bloom-agent: research requests with RESEARCH_USE_DEEP_RESEARCH_API, remove researchAgent and TEAM_AGENT_BY_TAB.research, remove the legacy research role tool mapping, remove old planner/writer/workflow registration from src/server/mastra/index.ts, and delete the three legacy execution files. Keep WorkflowSteps and its research-writer display label for historical messages.

Run: rg -n "DEEP_RESEARCH_V2_ENABLED|researchAgent|research-planner|research-writer|deepResearchWorkflow" src

Expected: no executable imports, registrations, Agent definitions, or flag branches; the only permitted match is a historical display label or compatibility test under the renderer.

- [ ] **Step 7: Run final verification after retirement**

Run: npm test

Expected: PASS.

Run: npm run typecheck

Expected: PASS.

Run: npm run build

Expected: PASS.

- [ ] **Step 8: Commit acceptance and retirement**

~~~bash
git add src/server/deepresearch src/server/http/routes src/server/config/config.ts src/server/mastra src/renderer/pages/Chat
git commit -m "test(deepresearch): verify profiles and retire legacy execution"
~~~

## Final Spec Coverage Check

| Spec section | Implementation coverage |
|---|---|
| 1. Decision summary | Tasks 1-14 preserve the standalone bounded-context decision. |
| 2. Background and problem | Tasks 5-8 replace the shallow four-step path with durable evidence-first research. |
| 3. Goals | Tasks 1-14 cover durable runs, profile-specific research, verified citations, workbench UX, and exports. |
| 4. Non-goals | Tasks 5, 8, and 12 avoid a second generic Agent Runtime, dynamic Agent Network orchestration, and PDF/DOCX research logic. |
| 5. Architecture principles | Tasks 1, 3-8, and 13 implement deterministic boundaries, evidence before prose, bounded recursion, and append-only events. |
| 6. Module boundary and directory | File Map plus Tasks 1, 4, 5, 9, and 12. |
| 7. Public types | Task 1 defines every Facade, API, Event, renderer, and artifact contract referenced later. |
| 8. Research Profiles | Tasks 1, 8, and 14 implement and verify general, market, competitor, and academic policies. |
| 9. Depth and Budget | Tasks 1, 6, 7, and 13 enforce limits, deadlines, concurrency, and usage reporting. |
| 10. Data model | Tasks 2 and 3 persist the full ledger; Task 8 completes report, claim, citation, quality, and artifact writes. |
| 11. Research workflow | Tasks 5-8 implement planning, retrieval, evidence, gap filling, writing, verification, and finalization. |
| 12. Agent/service split | Tasks 5-8 keep model work narrow and deterministic services authoritative. |
| 13. Mastra Runtime | Tasks 5, 7, 8, and 13 cover dedicated LibSQL state, foreach, dountil, suspend/resume, and reconciliation. |
| 14. Module Facade | Tasks 4, 9, and 13 make the singleton Facade the only server entry point. |
| 15. HTTP API | Task 9 covers status, CRUD-like Run operations, SSE reconnect, clarification, lifecycle commands, and artifacts. |
| 16. Event Protocol | Tasks 1, 3, 9, and 10 define, persist, stream, deduplicate, and reduce stable events. |
| 17. Chat and UI integration | Tasks 10-12 provide launcher, workbench, evidence navigation, Run links, refresh recovery, and legacy rendering. |
| 18. Citation and objectivity rules | Tasks 6-8 and 14 reject snippets, preserve contradictions, bind exact passages, and disclose limitations. |
| 19. Quality model | Task 8 implements exact release gates; Task 14 verifies them end to end. |
| 20. Failure, cancellation, and recovery | Tasks 3-8 and 13 cover persisted failures, bounded retry, cancellation boundaries, Lease, interruption, resume, and idempotency. |
| 21. Security and privacy | Tasks 1, 6-9, and 13 cover server IDs, Tool Policy, SSRF and redirect checks, untrusted content, managed artifacts, and telemetry redaction. |
| 22. Observability and evaluation | Tasks 13 and 14 add privacy-safe metrics, traces, deterministic fixtures, and a separate Live Web smoke. |
| 23. Test strategy | Every task starts with focused tests; Task 14 runs unit, integration, UI, typecheck, build, fixture runtime, and live smoke checks. |
| 24. Migration and compatibility | Tasks 9, 12, and 14 implement the status flag, rollback phase, permanent historical rendering, and release-gated retirement. |
| 25. Delivery slices | Execution Order maps Tasks 1-14 to Slices 1-5 with verification checkpoints. |
| 26. Acceptance criteria | Task 14 exercises all twelve acceptance outcomes. |
| 27. Alternatives | Tasks 5 and 12 enforce the selected fixed workflow and standalone API instead of rejected single-Agent or Chat-stream designs. |
| 28. References | The design spec remains the source of external GPT Researcher, Mastra, and BloomAI architecture references; implementation adds no copied external code. |

## Execution Order

Execute Tasks 1 through 5 as Slice 1, Tasks 6 and 7 as Slice 2, Task 8 as Slice 3, Tasks 9 through 12 as Slice 4, and Tasks 13 and 14 as Slice 5. Do not begin a later Slice until the previous Slice passes its focused tests, typecheck, and build checkpoint.
