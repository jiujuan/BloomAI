import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LibSQLStore } from '@mastra/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchProfile, StartResearchInput } from '@shared/deepresearch/contracts'
import { getResearchBudget } from './domain/budgets'
import { createDeepResearchExecutor } from './executor'
import { createDeepResearchMastraRuntime } from '../mastra/deepresearch/mastra'
import { createContentService } from '../services/deepresearch/content-service'
import { createSearchService } from '../services/deepresearch/search-service'
import { SourceCurator } from '../services/deepresearch/source-curator'

interface FixtureDocument {
  url: string
  title: string
  text: string
  headings: string[]
}

interface AcceptanceFixture {
  input: StartResearchInput
  planner: {
    title: string
    objective: string
    audience: string
    scope: string
    assumptions: string[]
    plannedSections: string[]
    criticalClarifications: Array<{
      question: string
      intent: string
      priority: 'critical'
      requiredEvidenceTypes: string[]
    }>
  }
  searchResponses: Array<{ title: string; url: string; snippet: string }>
  documents: FixtureDocument[]
  requiredSections: string[]
  expectedQuestionIntents: string[]
  minimumIndependentDomains: number
  expectedContradictions: Array<{ left: string; right: string; sourceUrls: string[] }>
  expectedFinalStatus: string
}

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let stores: LibSQLStore[]
let runtimes: Array<ReturnType<typeof createDeepResearchMastraRuntime>>

function readFixture(profile: ResearchProfile): AcceptanceFixture {
  const filePath = path.join(process.cwd(), 'src', 'server', 'deepresearch', 'test-fixtures', profile + '.json')
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as AcceptanceFixture
}

async function loadTestContext() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const { researchRunRepo } = await import('../db/repositories/deepresearch/research-run.repo')
  const { researchAttemptRepo } = await import('../db/repositories/deepresearch/research-attempt.repo')
  const { researchCheckpointRepo } = await import('../db/repositories/deepresearch/research-checkpoint.repo')
  const { researchCoverageAssessmentRepo } = await import('../db/repositories/deepresearch/research-coverage-assessment.repo')
  const { researchQuestionRepo } = await import('../db/repositories/deepresearch/research-question.repo')
  const { researchReportRepo } = await import('../db/repositories/deepresearch/research-report.repo')
  const { researchEventRepo } = await import('../db/repositories/deepresearch/research-event.repo')
  const { researchEvidenceRepo } = await import('../db/repositories/deepresearch/research-evidence.repo')
  const { researchSourceRepo } = await import('../db/repositories/deepresearch/research-source.repo')
  const { createDeepResearchService } = await import('./deep-research.service')

  return {
    client,
    createDeepResearchService,
    researchRunRepo,
    researchAttemptRepo,
    researchCheckpointRepo,
    researchCoverageAssessmentRepo,
    researchQuestionRepo,
    researchReportRepo,
    researchEventRepo,
    researchEvidenceRepo,
    researchSourceRepo,
  }
}

type TestContext = Awaited<ReturnType<typeof loadTestContext>>

function createStorage() {
  const storage = new LibSQLStore({
    id: 'deep-research-acceptance-' + Math.random().toString(36).slice(2),
    url: ':memory:',
  })
  stores.push(storage)
  return storage
}

function createFixtureRuntime(repositories: TestContext, fixture: AcceptanceFixture) {
  const documents = new Map(fixture.documents.map((document) => [document.url, document]))
  let searchCallCount = 0
  const initialSearchCallLimit = getResearchBudget(fixture.input.depth).maxQuestions
  const executeTool = vi.fn(async ({ toolId, input }: { toolId: string; input: Record<string, unknown> }) => {
    if (toolId === 'web_search') {
      const results = searchCallCount < initialSearchCallLimit ? fixture.searchResponses.slice(0, 1) : fixture.searchResponses
      searchCallCount += 1
      return { output: { provider: 'acceptance-fixture', results } }
    }

    const url = typeof input.url === 'string' ? input.url : ''
    const document = documents.get(url)
    if (!document) throw new Error('Unexpected fixture URL: ' + url)
    if (toolId === 'web_fetch') return { output: { finalUrl: url, status: 200, content: document.text } }
    if (toolId === 'web_extract') return { output: { finalUrl: url, title: document.title, text: document.text, headings: document.headings } }
    throw new Error('Unexpected fixture tool: ' + toolId)
  })
  const planner = { plan: vi.fn(async () => fixture.planner) }
  const runtime = createDeepResearchMastraRuntime({
    dataDir,
    storage: createStorage(),
    planner,
    repositories,
    searchService: createSearchService({ executeTool, sleep: async () => {} }),
    sourceCurator: new SourceCurator(),
    contentService: createContentService({
      repositories: { researchSourceRepo: repositories.researchSourceRepo, researchEventRepo: repositories.researchEventRepo },
      executeTool,
      sleep: async () => {},
      lookup: async () => ['93.184.216.34'],
    }),
  })
  runtimes.push(runtime)
  return { runtime, planner }
}

function createRun(repositories: TestContext, input: StartResearchInput) {
  return repositories.researchRunRepo.create({ input, budget: { ...getResearchBudget(input.depth) } })
}

describe('Deep Research deterministic acceptance fixtures', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepresearch-acceptance-'))
    originalEnv = { ...process.env }
    stores = []
    runtimes = []
  })

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.mastra.shutdown()))
    await Promise.all(stores.map((storage) => storage.close()))
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it.each<ResearchProfile>(['general', 'market', 'competitor', 'academic'])('runs the %s profile through the complete evidence and report pipeline', async (profile) => {
    const fixture = readFixture(profile)
    const repositories = await loadTestContext()
    const { runtime, planner } = createFixtureRuntime(repositories, fixture)
    const run = createRun(repositories, fixture.input)

    await runtime.start({
      runId: run.id,
      attemptId: 'acceptance:' + run.id,
      ownershipToken: 'acceptance-token',
      signal: new AbortController().signal,
      resumeCursor: null,
    })

    const detail = repositories.researchRunRepo.getDetail(run.id)!
    expect(detail).toMatchObject({
      id: run.id,
      status: fixture.expectedFinalStatus,
      phase: 'report_complete',
      brief: {
        title: fixture.planner.title,
        objective: fixture.planner.objective,
        audience: fixture.planner.audience,
        scope: fixture.planner.scope,
        assumptions: fixture.planner.assumptions,
        plannedSections: fixture.planner.plannedSections,
      },
    })
    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(detail.questions.map((question) => question.intent)).toEqual(expect.arrayContaining(fixture.expectedQuestionIntents))
    expect(detail.searchQueries.length).toBeGreaterThan(0)
    expect(detail.sources.filter((source) => source.selectionStatus === 'selected')).toHaveLength(fixture.searchResponses.length)
    expect(new Set(detail.sources.filter((source) => source.selectionStatus === 'selected').map((source) => source.domain)).size).toBeGreaterThanOrEqual(fixture.minimumIndependentDomains)
    expect(detail.snapshots).toHaveLength(fixture.documents.length)
    expect(detail.evidence.length).toBeGreaterThan(0)
    expect(detail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.evidence.extracted' }),
      expect.objectContaining({ type: 'research.coverage.assessed' }),
      expect.objectContaining({ type: 'research.iteration.started', phase: 'gap_filling' }),
      expect.objectContaining({ type: 'research.quality.assessed' }),
      expect.objectContaining({ type: 'research.artifact.created' }),
    ]))

    const sectionTitles = detail.report!.sections.map((section) => section.title)
    expect(sectionTitles).toEqual(expect.arrayContaining(fixture.requiredSections))
    const evidenceById = new Map(detail.evidence.map((evidence) => [evidence.id, evidence]))
    for (const citation of detail.report!.citations) {
      const evidence = evidenceById.get(citation.evidenceId)
      expect(citation.runId).toBe(run.id)
      expect(evidence).toMatchObject({ id: citation.evidenceId, runId: run.id })
    }
    expect(detail.report!.claims
      .filter((claim) => claim.importance === 'high' || claim.importance === 'critical')
      .every((claim) => claim.verificationStatus !== 'unsupported')).toBe(true)
    expect(detail.quality?.releaseStatus).not.toBe('failed')

    for (const contradiction of fixture.expectedContradictions) {
      expect(detail.snapshots.filter((snapshot) => contradiction.sourceUrls.includes(snapshot.finalUrl)).map((snapshot) => snapshot.content).join('\n')).toContain(contradiction.left)
      expect(detail.snapshots.filter((snapshot) => contradiction.sourceUrls.includes(snapshot.finalUrl)).map((snapshot) => snapshot.content).join('\n')).toContain(contradiction.right)
    }

    expect(detail.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'report_markdown', fileName: 'report.md', contentType: 'text/markdown' }),
      expect.objectContaining({ type: 'report_json', fileName: 'report.json', contentType: 'application/json' }),
    ]))
    const markdownArtifact = detail.artifacts.find((artifact) => artifact.type === 'report_markdown')!
    const jsonArtifact = detail.artifacts.find((artifact) => artifact.type === 'report_json')!
    expect(fs.readFileSync(repositories.researchReportRepo.getStoredArtifact(run.id, markdownArtifact.id)!.storagePath, 'utf8')).toContain('# ' + fixture.planner.title)
    expect(JSON.parse(fs.readFileSync(repositories.researchReportRepo.getStoredArtifact(run.id, jsonArtifact.id)!.storagePath, 'utf8'))).toMatchObject({ runId: run.id, title: fixture.planner.title, quality: detail.quality, sections: expect.any(Array), claims: expect.any(Array), citations: expect.any(Array), questions: expect.any(Array) })
  })

  it('cancels a queued run and persists a cancellation event', async () => {
    const fixture = readFixture('general')
    const repositories = await loadTestContext()
    const runtime = { start: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) }
    const service = repositories.createDeepResearchService({ runtime })
    const run = createRun(repositories, fixture.input)

    await expect(service.cancelRun(run.id)).resolves.toMatchObject({ status: 'cancelling', phase: 'cancelling' })
    expect(repositories.researchRunRepo.getDetail(run.id)!.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.run.cancellation_requested', phase: 'cancelling', payload: { reason: null } }),
    ]))
  })

  it('pauses for a critical clarification and resumes the same run', async () => {
    const fixture = readFixture('market')
    fixture.planner.criticalClarifications = [{
      question: 'Which synthetic geography should the comparison cover?',
      intent: 'scope',
      priority: 'critical',
      requiredEvidenceTypes: ['official-statistics'],
    }]
    const repositories = await loadTestContext()
    const { runtime, planner } = createFixtureRuntime(repositories, fixture)
    const executor = createDeepResearchExecutor({ runtime, executorId: 'acceptance-executor' })
    const service = repositories.createDeepResearchService({ runtime: executor })
    const run = createRun(repositories, fixture.input)
    repositories.researchAttemptRepo.create({ runId: run.id, trigger: 'initial' })

    const suspended = await executor.start(run.id)
    const waiting = repositories.researchRunRepo.getDetail(run.id)!
    expect(suspended).toBe(true)
    expect(waiting).toMatchObject({ status: 'awaiting_input', phase: 'awaiting_clarification', resumePhase: 'planning' })
    const clarificationId = waiting.brief!.criticalClarificationIds[0]

    await service.answerClarification(run.id, { clarificationId, answer: 'Use the synthetic global scope.' })
    await vi.waitFor(() => {
      const resumed = repositories.researchRunRepo.get(run.id)
      expect(resumed).toMatchObject({ phase: 'report_complete' })
      expect(['completed', 'completed_with_limitations']).toContain(resumed!.status)
    })

    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(repositories.researchRunRepo.getDetail(run.id)!.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.clarification.answered', payload: { clarificationId, answer: 'Use the synthetic global scope.' } }),
      expect.objectContaining({ type: 'research.run.completed' }),
    ]))
  })

  it('marks an expired active Attempt and Run interrupted during restart recovery', async () => {
    const fixture = readFixture('general')
    const repositories = await loadTestContext()
    const runtime = { start: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) }
    const service = repositories.createDeepResearchService({ runtime })
    const run = createRun(repositories, fixture.input)
    repositories.researchRunRepo.transitionWithEvent(run.id, 'planning', { phase: 'planning' })
    repositories.researchRunRepo.transitionWithEvent(run.id, 'researching', { phase: 'researching' })
    const attempt = repositories.researchAttemptRepo.create({ runId: run.id, trigger: 'initial' })
    expect(repositories.researchAttemptRepo.acquireLease(attempt.id, 'acceptance-worker', 'acceptance-lease', 1_000, 1_000)).toBe(true)

    const recovery = await service.recoverInterruptedRuns(2_001)

    expect(recovery.interrupted).toEqual(expect.arrayContaining([expect.objectContaining({ id: run.id })]))
    expect(repositories.researchRunRepo.get(run.id)).toMatchObject({ status: 'interrupted', phase: 'interrupted' })
    expect(repositories.researchAttemptRepo.get(attempt.id)).toMatchObject({ status: 'interrupted', leaseExpiresAt: null })
    expect(repositories.researchRunRepo.getDetail(run.id)!.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'research.run.interrupted', payload: { reason: 'attempt_lease_expired', attemptId: attempt.id } }),
    ]))
  })
})
