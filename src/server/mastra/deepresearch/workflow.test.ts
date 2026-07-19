import fs from 'fs'
import os from 'os'
import path from 'path'
import { LibSQLStore } from '@mastra/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchModelSelectionSnapshot, StartResearchInput } from '@shared/deepresearch/contracts'
import type { MastraModelConfig } from '@mastra/core/llm'
import { createLlmDeepResearchAdapters, type LlmDeepResearchAdapters } from './llm-adapters'
import { createDeepResearchExecutor } from '../../deepresearch/executor'
import { createDeepResearchService } from '../../deepresearch/deep-research.service'
import { createDeepResearchMastraRuntime } from './mastra'
import { createContentService } from '@server/services/deepresearch/content-service'
import { createSearchService } from '@server/services/deepresearch/search-service'
import { SourceCurator } from '@server/services/deepresearch/source-curator'
import { planIteration } from './steps/plan-iteration'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let stores: LibSQLStore[]
let runtimes: Array<ReturnType<typeof createDeepResearchMastraRuntime>>

const input: StartResearchInput = {
  topic: 'Enterprise AI assistant market',
  profile: 'market',
  depth: 'deep',
  objective: 'Compare the market and leading vendors.',
}

async function loadTestContext() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  const { researchRunRepo } = await import('../../db/repositories/deepresearch/research-run.repo')
  const { researchAttemptRepo } = await import('../../db/repositories/deepresearch/research-attempt.repo')
  const { researchCheckpointRepo } = await import('../../db/repositories/deepresearch/research-checkpoint.repo')
  const { researchCoverageAssessmentRepo } = await import('../../db/repositories/deepresearch/research-coverage-assessment.repo')
  const { researchQuestionRepo } = await import('../../db/repositories/deepresearch/research-question.repo')
  const { researchReportRepo } = await import('../../db/repositories/deepresearch/research-report.repo')
  const { researchEventRepo } = await import('../../db/repositories/deepresearch/research-event.repo')
  const { researchEvidenceRepo } = await import('../../db/repositories/deepresearch/research-evidence.repo')
  const { researchSourceRepo } = await import('../../db/repositories/deepresearch/research-source.repo')
  const { researchIterationRepo } = await import('../../db/repositories/deepresearch/research-iteration.repo')

  return {
    client,
    researchRunRepo,
    researchAttemptRepo,
    researchCheckpointRepo,
    researchCoverageAssessmentRepo,
    researchQuestionRepo,
    researchReportRepo,
    researchEventRepo,
    researchEvidenceRepo,
    researchSourceRepo,
    researchIterationRepo,
  }
}

function createRetrievalServices(repositories: Awaited<ReturnType<typeof loadTestContext>>) {
  const executeTool = vi.fn(async ({ toolId, input }: { toolId: string; input: Record<string, unknown> }) => {
    const url = typeof input.url === 'string' ? input.url : 'https://www.example.test/research'
    if (toolId === 'web_search') {
      return {
        output: {
          provider: 'fixture-search',
          results: [
            { title: 'Official enterprise AI assistant market data', url: 'https://a.fixture.gov/research?utm_source=fixture', snippet: 'Official market data and methodology for enterprise AI assistants.' },
            { title: 'Official enterprise AI assistant market survey', url: 'https://b.fixture.gov/research', snippet: 'Official market survey and methodology for enterprise AI assistants.' },
            { title: 'Official enterprise AI assistant benchmark', url: 'https://c.fixture.gov/research', snippet: 'Official benchmark methodology for enterprise AI assistants.' },
          ],
        },
      }
    }
    if (toolId === 'web_fetch') return { output: { finalUrl: url, status: 200, content: 'The official fixture source publishes a measured 2026 enterprise AI assistant market observation, documents its collection method, and states that buyers evaluate deployment fit, governance requirements, and vendor capabilities before adoption.' } }
    if (toolId === 'web_extract') return { output: { finalUrl: url, title: 'Fixture source', text: 'The official fixture source publishes a measured 2026 enterprise AI assistant market observation, documents its collection method, and states that buyers evaluate deployment fit, governance requirements, and vendor capabilities before adoption.', headings: ['Overview'] } }
    throw new Error('Unexpected tool: ' + toolId)
  })
  return {
    executeTool,
    searchService: createSearchService({ executeTool, sleep: async () => {} }),
    sourceCurator: new SourceCurator(),
    contentService: createContentService({
      repositories: { researchSourceRepo: repositories.researchSourceRepo, researchEventRepo: repositories.researchEventRepo },
      executeTool,
      sleep: async () => {},
      lookup: async () => ['93.184.216.34'],
    }),
  }
}

function createStorage() {
  const storage = new LibSQLStore({
    id: 'deep-research-workflow-test-' + Math.random().toString(36).slice(2),
    url: ':memory:',
  })
  stores.push(storage)
  return storage
}

describe('Deep Research Mastra report workflow', () => {
  it('uses the snapshotted LLM factory by default while tests inject fakes explicitly', async () => {
    const repositories = await loadTestContext()
    const retrieval = createRetrievalServices(repositories)
    const snapshot: ResearchModelSelectionSnapshot = {
      requestedModelId: null,
      selectedModelId: 'configured-text-model',
      providerId: 'configured-provider',
      providerKind: 'openai-compatible',
      selectionSource: 'deep_research_setting',
      settingsKey: 'deep_research_model',
      modelContractVersion: 'v1',
      resolvedAt: 1,
    }
    const planner = { plan: vi.fn(async () => ({
      title: 'Enterprise AI assistant market research',
      objective: 'Compare the market and leading vendors.',
      audience: null,
      scope: 'Enterprise market',
      assumptions: [],
      plannedSections: ['executive-summary'],
      criticalClarifications: [{
        question: 'Which geography should the comparison cover?',
        intent: 'scope',
        priority: 'critical' as const,
        requiredEvidenceTypes: ['official-statistics'],
      }],
    })) }
    const llmAdapterFactory = vi.fn((_: Parameters<typeof createLlmDeepResearchAdapters>[0]) => ({ planner }) as unknown as LlmDeepResearchAdapters)
    const researchModelResolver = vi.fn(async () => ({}) as MastraModelConfig)
    const runtime = createDeepResearchMastraRuntime({
      dataDir,
      storage: createStorage(),
      repositories,
      llmAdapterFactory,
      researchModelResolver,
      ...retrieval,
    })
    runtimes.push(runtime)
    const run = repositories.researchRunRepo.create({
      input,
      budget: {
        maxQuestions: 2,
        maxIterations: 1,
        maxSearchQueries: 2,
        maxNormalizedSources: 2,
        maxFetchedSources: 2,
        searchConcurrency: 1,
        fetchConcurrency: 1,
        maxDurationMs: 60_000,
      },
      modelSelectionSnapshot: snapshot,
    })

    const attempt = repositories.researchAttemptRepo.create({ runId: run.id, trigger: 'initial' })
    await runtime.start({
      runId: run.id,
      attemptId: attempt.id,
      ownershipToken: 'production-composition-token',
      signal: new AbortController().signal,
      resumeCursor: { version: 1, nextPhase: 'research', iteration: 3 },
    })

    expect(researchModelResolver).toHaveBeenCalledWith(snapshot)
    expect(llmAdapterFactory).toHaveBeenCalledWith(expect.objectContaining({ model: {}, usageReporter: expect.any(Function), traceReporter: expect.any(Function) }))
    const factoryOptions = llmAdapterFactory.mock.calls[0]?.[0] as Parameters<typeof createLlmDeepResearchAdapters>[0]
    await factoryOptions.traceReporter?.({
      stage: 'brief_planning', attempt: 1,
      inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64), inputCharacters: 120, outputCharacters: 40,
      durationMs: 30, parseStatus: 'valid', retryReason: null, errorCode: null, errorCategory: null,
    })
    expect(repositories.researchAttemptRepo.get(attempt.id)?.modelTraces).toEqual([expect.objectContaining({
      stage: 'brief_planning', iteration: 3, inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64),
    })])
    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(repositories.researchRunRepo.get(run.id)).toMatchObject({
      status: 'awaiting_input',
      phase: 'awaiting_clarification',
    })
  })

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepresearch-workflow-'))
    originalEnv = { ...process.env }
    stores = []
    runtimes = []
  })

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.mastra.shutdown()))
    await Promise.all(stores.map((storage) => storage.close()))
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('replays a persisted budget stop without invoking the follow-up planner or creating another audit record', async () => {
    const repositories = await loadTestContext()
    const run = repositories.researchRunRepo.create({
      input,
      budget: {
        maxQuestions: 14,
        maxIterations: 3,
        maxSearchQueries: 0,
        maxNormalizedSources: 50,
        maxFetchedSources: 36,
        searchConcurrency: 6,
        fetchConcurrency: 5,
        maxDurationMs: 30 * 60 * 1000,
      },
    })
    const gapAnalyst = { plan: vi.fn(async () => [{ questionId: 'unreachable', query: 'must not execute', intent: 'primary_source' as const, sourceTargets: ['official source'], dedupeKey: 'unreachable-query' }]) }
    const state = {
      runId: run.id,
      brief: { title: run.topic, objective: null, audience: null, scope: run.topic, definition: null, timeframe: null, geography: null, deliverables: [], assumptions: [], plannedSections: [], questions: [], criticalClarificationIds: [] },
      coverageComplete: false,
      marginalNewEvidenceCount: 0,
      cancelled: false,
      iterations: 0,
      maxIterations: run.budget.maxIterations,
    }

    const first = await planIteration(state, { repositories, gapAnalyst })
    const replay = await planIteration(first, { repositories, gapAnalyst })

    expect(first.stopDecision).toBe('stop_budget')
    expect(replay.stopDecision).toBe('stop_budget')
    expect(gapAnalyst.plan).not.toHaveBeenCalled()
    expect(repositories.researchIterationRepo.list(run.id)).toHaveLength(0)
    expect(repositories.researchIterationRepo.listStopDecisions(run.id)).toHaveLength(1)
    expect(repositories.researchIterationRepo.listStopDecisions(run.id)[0].decision).toMatchObject({
      decision: 'stop_budget',
      matchedRule: 'budget_exhausted',
      limitations: expect.any(Array),
    })
  })

  it('replays a persisted no-actionable-gaps stop without reinvoking the gap-planning provider', async () => {
    const repositories = await loadTestContext()
    const run = repositories.researchRunRepo.create({
      input,
      budget: {
        maxQuestions: 14,
        maxIterations: 3,
        maxSearchQueries: 48,
        maxNormalizedSources: 50,
        maxFetchedSources: 36,
        searchConcurrency: 6,
        fetchConcurrency: 5,
        maxDurationMs: 30 * 60 * 1000,
      },
    })
    const gapAnalyst = { plan: vi.fn(async () => []) }
    const state = {
      runId: run.id,
      brief: { title: run.topic, objective: null, audience: null, scope: run.topic, definition: null, timeframe: null, geography: null, deliverables: [], assumptions: [], plannedSections: [], questions: [], criticalClarificationIds: [] },
      coverageComplete: false,
      marginalNewEvidenceCount: 0,
      cancelled: false,
      iterations: 0,
      maxIterations: run.budget.maxIterations,
    }

    const first = await planIteration(state, { repositories, gapAnalyst })
    const replay = await planIteration(first, { repositories, gapAnalyst })

    expect(first.stopDecision).toBe('stop_no_actionable_gaps')
    expect(replay.stopDecision).toBe('stop_no_actionable_gaps')
    expect(gapAnalyst.plan).toHaveBeenCalledTimes(1)
    expect(repositories.researchIterationRepo.list(run.id)).toHaveLength(0)
    expect(repositories.researchIterationRepo.listStopDecisions(run.id)).toHaveLength(1)
  })

  it('persists a verified cited report with Markdown and JSON artifacts', async () => {
    const repositories = await loadTestContext()
    const planner = {
      plan: vi.fn(async () => ({
        title: 'Enterprise AI assistant market research',
        objective: 'Compare the market and leading vendors.',
        audience: 'Product strategy team',
        scope: 'US enterprise AI assistant market in 2026',
        assumptions: ['Public sources only'],
        plannedSections: ['executive-summary', 'market-definition', 'competitive-structure'],
        criticalClarifications: [],
      })),
    }
    const retrieval = createRetrievalServices(repositories)
    const gapAnalyst = {
      plan: vi.fn(async (currentRun: { topic: string }, questions: Array<{ id: string; question: string; priority: string; coverage: { gaps: string[] } | null }>) => questions
        .filter((question) => question.priority === 'high' || question.priority === 'critical')
        .map((question) => ({ questionId: question.id, query: currentRun.topic + ' ' + question.question + ' follow-up official evidence', intent: 'primary_source' as const, sourceTargets: ['official source'], dedupeKey: 'follow-up:' + question.id }))),
    }
    const runtime = createDeepResearchMastraRuntime({
      dataDir,
      storage: createStorage(),
      planner,
      gapAnalyst,
      repositories,
      ...retrieval,
    })
    runtimes.push(runtime)
    const run = repositories.researchRunRepo.create({
      input,
      budget: {
        maxQuestions: 14,
        maxIterations: 3,
        maxSearchQueries: 48,
        maxNormalizedSources: 50,
        maxFetchedSources: 36,
        searchConcurrency: 6,
        fetchConcurrency: 5,
        maxDurationMs: 30 * 60 * 1000,
      },
    })

    await runtime.start({
      runId: run.id,
      attemptId: 'workflow-test:' + run.id,
      ownershipToken: 'workflow-test-token',
      signal: new AbortController().signal,
      resumeCursor: null,
    })

    const detail = repositories.researchRunRepo.getDetail(run.id)!
    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(detail).toMatchObject({
      status: 'completed_with_limitations',
      phase: 'report_complete',
      workflowRunId: expect.any(String),
      brief: {
        title: 'Enterprise AI assistant market research',
        plannedSections: ['executive-summary', 'market-definition', 'competitive-structure'],
      },
    })
    expect(detail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.brief.completed' }),
      expect.objectContaining({ type: 'research.run.completed' }),
      expect.objectContaining({ type: 'research.artifact.created' }),
    ]))
    expect(detail.questions.length).toBeGreaterThan(0)
    expect(detail.coverageAssessments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        attemptId: expect.any(String),
        iterationId: null,
        policyVersion: 'v2',
        questionAssessments: expect.arrayContaining([expect.objectContaining({ dimensions: expect.any(Object), gaps: expect.any(Array) })]),
        coverageProjections: expect.arrayContaining([expect.objectContaining({ questionId: expect.any(String) })]),
      }),
    ]))
    expect(detail.searchQueries.length).toBeGreaterThan(0)
    const persistedIterations = repositories.researchIterationRepo.list(run.id)
    expect(persistedIterations.length).toBeGreaterThanOrEqual(1)
    expect(persistedIterations.length).toBeLessThanOrEqual(run.budget.maxIterations)
    expect(persistedIterations.every((iteration) => iteration.status === 'completed' || iteration.status === 'stopped')).toBe(true)
    expect(persistedIterations.every((iteration) => typeof iteration.coverageAfter.materialGain === 'boolean')).toBe(true)
    const settledIterations = persistedIterations.filter((iteration) => iteration.status === 'completed')
    expect(settledIterations).not.toHaveLength(0)
    expect(settledIterations.every((iteration) =>
      (iteration.plan?.settlement?.spent.fetchedSources ?? Number.POSITIVE_INFINITY) <= (iteration.plan?.reservation.fetchedSources ?? -1),
    )).toBe(true)
    const iterationCheckpoints = repositories.researchCheckpointRepo.list(run.id)
    expect(iterationCheckpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkpointKey: expect.stringMatching(/^iteration:\d+:retrieval-planned$/) }),
      expect.objectContaining({ checkpointKey: expect.stringMatching(/^iteration:\d+:assessment-completed$/) }),
      expect.objectContaining({ checkpointKey: expect.stringMatching(/^iteration:stop:/) }),
    ]))
    expect(repositories.researchIterationRepo.listStopDecisions(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: expect.objectContaining({ matchedRule: expect.any(String), limitations: expect.any(Array) }) }),
    ]))
    expect(gapAnalyst.plan).toHaveBeenCalled()
    expect(detail.sources.length).toBeGreaterThan(0)
    expect(detail.snapshots.length).toBeGreaterThan(0)
    expect(detail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.evidence.extracted' }),
      expect.objectContaining({ type: 'research.coverage.assessment_completed' }),
      expect.objectContaining({ type: 'research.checkpoint.completed', payload: expect.objectContaining({ checkpointKey: 'coverage:assessment:v2' }) }),
      expect.objectContaining({ type: 'research.coverage.assessed' }),
      expect.objectContaining({ type: 'research.section.drafted' }),
      expect.objectContaining({ type: 'research.claim.verified' }),
      expect.objectContaining({ type: 'research.quality.assessed' }),
    ]))
    expect(detail.report?.sections).toHaveLength(10)
    expect(detail.report?.claims.filter((claim) => claim.kind === 'factual').every((claim) => detail.report!.citations.some((citation) => citation.claimId === claim.id))).toBe(true)
    expect(detail.report?.citations.map((citation) => citation.ordinal)).toEqual([...detail.report!.citations.keys()].map((index) => index + 1))
    expect(detail.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'report_markdown', fileName: 'report.md', contentType: 'text/markdown' }),
      expect.objectContaining({ type: 'report_json', fileName: 'report.json', contentType: 'application/json' }),
    ]))
    const reportPath = path.join(dataDir, 'deepresearch', 'runs', run.id, 'report.md')
    expect(fs.readFileSync(reportPath, 'utf8')).toContain('# Enterprise AI assistant market research')
  })

  it('suspends for a critical clarification then resumes planning without creating a second brief', async () => {
    const repositories = await loadTestContext()
    const planner = {
      plan: vi.fn(async () => ({
        title: 'Enterprise AI assistant market research',
        objective: 'Compare the market and leading vendors.',
        audience: 'Product strategy team',
        scope: 'Enterprise market',
        assumptions: [],
        plannedSections: ['executive-summary'],
        criticalClarifications: [{
          question: 'Which geography should the comparison cover?',
          intent: 'scope',
          priority: 'critical' as const,
          requiredEvidenceTypes: ['official-statistics'],
        }],
      })),
    }
    const retrieval = createRetrievalServices(repositories)
    const runtime = createDeepResearchMastraRuntime({
      dataDir,
      storage: createStorage(),
      planner,
      repositories,
      ...retrieval,
    })
    runtimes.push(runtime)
    const executor = createDeepResearchExecutor({ runtime, executorId: 'workflow-test-executor' })
    const service = createDeepResearchService({ runtime: executor })
    const run = repositories.researchRunRepo.create({
      input,
      budget: {
        maxQuestions: 14,
        maxIterations: 3,
        maxSearchQueries: 48,
        maxNormalizedSources: 50,
        maxFetchedSources: 36,
        searchConcurrency: 6,
        fetchConcurrency: 5,
        maxDurationMs: 30 * 60 * 1000,
      },
    })

    const attempt = repositories.researchAttemptRepo.create({ runId: run.id, trigger: 'initial' })
    const suspended = await executor.start(run.id)
    const awaitingDetail = repositories.researchRunRepo.getDetail(run.id)!

    expect(suspended).toBe(true)
    expect(awaitingDetail).toMatchObject({
      status: 'awaiting_input',
      phase: 'awaiting_clarification',
      resumePhase: 'planning',
      brief: { criticalClarificationIds: [expect.any(String)] },
    })
    expect(awaitingDetail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.run.awaiting_input' }),
    ]))

    const clarificationId = awaitingDetail.brief!.criticalClarificationIds[0]
    await service.answerClarification(run.id, {
      clarificationId,
      answer: 'Focus on the United States market.',
    })
    await vi.waitFor(() => {
      expect(repositories.researchRunRepo.get(run.id)).toMatchObject({
        status: 'completed_with_limitations',
        phase: 'report_complete',
      })
      expect(repositories.researchAttemptRepo.get(attempt.id)).toMatchObject({ status: 'succeeded' })
    })

    const resumedDetail = repositories.researchRunRepo.getDetail(run.id)!
    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(resumedDetail.brief).toEqual(awaitingDetail.brief)
    expect(resumedDetail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'research.clarification.answered',
        payload: { clarificationId, answer: 'Focus on the United States market.' },
      }),
      expect.objectContaining({ type: 'research.run.completed' }),
    ]))
  })
})
