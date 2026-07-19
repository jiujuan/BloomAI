import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchBriefDto, ResearchQualityDto, StartResearchInput } from '@shared/deepresearch/contracts'
import { createCheckpointCursor } from '@server/deepresearch/domain/checkpoint-replay'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import { createContentService } from '@server/services/deepresearch/content-service'
import { EvidenceService } from '@server/services/deepresearch/evidence-service'
import { createExecuteSearchesStep } from './execute-searches'
import { createFetchSourcesStep } from './fetch-sources'
import { createExtractEvidenceStep } from './extract-evidence'
import { createFinalizeArtifactsStep } from './finalize-artifacts'
import { createLoadRunStep } from './load-run'
import { bindWorkflowExecution, clearWorkflowExecution, getWorkflowExecution } from './checkpoint-replay'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
const boundRunIds = new Set<string>()

const input: StartResearchInput = {
  topic: 'Checkpoint recovery fixtures',
  profile: 'market',
  depth: 'deep',
  objective: 'Verify durable replay boundaries without duplicate provider work.',
}

const brief: ResearchBriefDto = {
  title: input.topic,
  objective: input.objective ?? null,
  audience: null,
  scope: input.topic,
  assumptions: [],
  plannedSections: [],
  criticalClarificationIds: [],
}

const quality: ResearchQualityDto = {
  releaseStatus: 'completed',
  highPriorityQuestionCoverage: 1,
  factualClaimCitationCoverage: 1,
  supportedCitationCoverage: 1,
  independentCitedDomainCount: 2,
  contradictionDisclosureCoverage: 1,
  requiredSectionCoverage: 1,
  limitations: [],
  assessorVersion: 'checkpoint-recovery-test',
}

async function loadRepositories() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../../db/client')
  await client.runMigrations()
  const { researchRunRepo } = await import('../../../db/repositories/deepresearch/research-run.repo')
  const { researchAttemptRepo } = await import('../../../db/repositories/deepresearch/research-attempt.repo')
  const { researchCheckpointRepo } = await import('../../../db/repositories/deepresearch/research-checkpoint.repo')
  const { researchCoverageAssessmentRepo } = await import('../../../db/repositories/deepresearch/research-coverage-assessment.repo')
  const { researchQuestionRepo } = await import('../../../db/repositories/deepresearch/research-question.repo')
  const { researchReportRepo } = await import('../../../db/repositories/deepresearch/research-report.repo')
  const { researchEventRepo } = await import('../../../db/repositories/deepresearch/research-event.repo')
  const { researchEvidenceRepo } = await import('../../../db/repositories/deepresearch/research-evidence.repo')
  const { researchSourceRepo } = await import('../../../db/repositories/deepresearch/research-source.repo')
  const { researchIterationRepo } = await import('../../../db/repositories/deepresearch/research-iteration.repo')
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

function createRun(repositories: Awaited<ReturnType<typeof loadRepositories>>) {
  return repositories.researchRunRepo.create({
    input,
    budget: {
      maxQuestions: 14,
      maxIterations: 3,
      maxSearchQueries: 48,
      maxNormalizedSources: 50,
      maxFetchedSources: 36,
      searchConcurrency: 2,
      fetchConcurrency: 2,
      maxDurationMs: 30 * 60 * 1000,
    },
  })
}

function activateAttempt(
  repositories: Awaited<ReturnType<typeof loadRepositories>>,
  runId: string,
  cursorPhase: string,
) {
  const current = repositories.researchRunRepo.get(runId)!
  if (current.status === 'queued') repositories.researchRunRepo.transitionWithEvent(runId, 'planning', { phase: 'planning' })
  const attempt = repositories.researchAttemptRepo.create({ runId, trigger: 'initial' })
  const executorId = 'checkpoint-recovery-test'
  const ownershipToken = 'checkpoint-recovery-token:' + attempt.id
  expect(repositories.researchAttemptRepo.acquireLease(attempt.id, executorId, ownershipToken, 60_000)).toBe(true)
  bindWorkflowExecution(runId, {
    attemptId: attempt.id,
    executorId,
    ownershipToken,
    resumeCursor: createCheckpointCursor(repositories.researchRunRepo.get(runId)!, cursorPhase),
  })
  boundRunIds.add(runId)
  return attempt
}

function createQuestion(repositories: Awaited<ReturnType<typeof loadRepositories>>, runId: string) {
  return repositories.researchQuestionRepo.create({
    runId,
    ordinal: 1,
    question: 'Which durable boundary prevents duplicate provider work?',
    intent: 'comparison',
    requiredEvidenceTypes: ['official-statistics'],
    priority: 'high',
    status: 'researching',
  })
}

function createSourceAndSnapshot(repositories: Awaited<ReturnType<typeof loadRepositories>>, runId: string) {
  const source = repositories.researchSourceRepo.createSource({
    runId,
    canonicalUrl: 'https://checkpoint.fixture.test/source',
    domain: 'checkpoint.fixture.test',
    title: 'Checkpoint fixture',
    sourceType: 'official-statistics',
    selectionStatus: 'selected',
    scores: { score: 1 },
  })
  const content = 'A'.repeat(180) + ' durable source observation.'
  const snapshot = repositories.researchSourceRepo.createSnapshot({
    runId,
    sourceId: source.id,
    contentHash: 'checkpoint-snapshot:' + runId,
    content,
    metadata: {},
    fetchedAt: Date.now(),
    parserVersion: 'checkpoint-test-v1',
    finalUrl: source.canonicalUrl,
    httpStatus: 200,
    idempotencyKey: 'checkpoint-snapshot:' + runId,
  })
  return { source, snapshot, content }
}

describe('Deep Research checkpoint cursor recovery', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-checkpoint-recovery-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    for (const runId of boundRunIds) clearWorkflowExecution(runId)
    boundRunIds.clear()
    const client = await import('../../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('does not repeat a completed provider query when the process fails before the batch update/checkpoint boundary', async () => {
    const repositories = await loadRepositories()
    const run = createRun(repositories)
    const question = createQuestion(repositories, run.id)
    const query = repositories.researchQuestionRepo.createSearchQuery({
      runId: run.id,
      questionId: question.id,
      iteration: 0,
      query: 'checkpoint provider query',
      idempotencyKey: 'checkpoint-search:' + run.id,
    })
    activateAttempt(repositories, run.id, 'searching')

    const requestedQueryIds: string[][] = []
    let failAfterDurableProviderResult = true
    const searchService = {
      search: vi.fn(async (_run: unknown, queries: Array<{ id: string }>, options: { onExecution?: (execution: any) => void }) => {
        requestedQueryIds.push(queries.map((candidate) => candidate.id))
        for (const candidate of queries) {
          options.onExecution?.({ queryId: candidate.id, provider: 'fixture', candidates: [], error: null })
        }
        if (failAfterDurableProviderResult) throw new Error('fault: query persisted before phase checkpoint')
        return []
      }),
    }
    const step = createExecuteSearchesStep({ repositories, searchService: searchService as any })

    await expect((step as any).execute({ inputData: { runId: run.id, brief } })).rejects.toThrow('query persisted')
    expect(repositories.researchQuestionRepo.getSearchQuery(query.id)).toMatchObject({ status: 'completed', provider: 'fixture' })

    failAfterDurableProviderResult = false
    await (step as any).execute({ inputData: { runId: run.id, brief } })

    expect(requestedQueryIds).toEqual([[query.id], []])
    expect(repositories.researchCheckpointRepo.list(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkpointKey: 'workflow:searching:v1', resumeCursor: expect.objectContaining({ nextPhase: 'curating_sources' }) }),
    ]))
  })

  it('reuses a persisted snapshot after a fault before the fetch phase checkpoint without calling web providers again', async () => {
    const repositories = await loadRepositories()
    const run = createRun(repositories)
    const { source } = createSourceAndSnapshot(repositories, run.id)
    activateAttempt(repositories, run.id, 'fetching')
    const executeTool = vi.fn(async () => {
      throw new Error('web provider must not be called for a persisted snapshot')
    })
    const contentService = createContentService({
      repositories: { researchSourceRepo: repositories.researchSourceRepo, researchEventRepo: repositories.researchEventRepo },
      executeTool,
      sleep: async () => {},
      lookup: async () => ['93.184.216.34'],
    })
    const step = createFetchSourcesStep({ repositories, contentService })

    await (step as any).execute({ inputData: { runId: run.id, brief, sourceIds: [source.id] } })

    expect(executeTool).not.toHaveBeenCalled()
    expect(repositories.researchSourceRepo.listSnapshots(run.id)).toHaveLength(1)
    expect(repositories.researchCheckpointRepo.list(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkpointKey: 'workflow:fetching:v1', resumeCursor: expect.objectContaining({ nextPhase: 'extracting_evidence' }) }),
    ]))
  })

  it('does not re-invoke the evidence analyst when evidence was persisted before coverage assessment', async () => {
    const repositories = await loadRepositories()
    const run = createRun(repositories)
    const question = createQuestion(repositories, run.id)
    const { snapshot, content } = createSourceAndSnapshot(repositories, run.id)
    repositories.researchEvidenceRepo.upsertEvidence({
      runId: run.id,
      questionId: question.id,
      snapshotId: snapshot.id,
      passage: content.slice(0, 120),
      summary: 'Persisted evidence proves the analyst completed this snapshot before the fault.',
      stance: 'supporting',
      confidence: 0.9,
      startOffset: 0,
      endOffset: 120,
      idempotencyKey: 'checkpoint-evidence:' + run.id,
    })
    activateAttempt(repositories, run.id, 'extracting_evidence')
    const analyst = { analyze: vi.fn(async () => []) }
    const evidenceService = new EvidenceService({
      analyst,
      sourceRepo: repositories.researchSourceRepo,
      evidenceRepo: repositories.researchEvidenceRepo,
      questionRepo: repositories.researchQuestionRepo,
    })
    const step = createExtractEvidenceStep({ repositories, evidenceService })

    await (step as any).execute({ inputData: { runId: run.id, brief } })

    expect(analyst.analyze).not.toHaveBeenCalled()
    expect(repositories.researchEvidenceRepo.list(run.id)).toHaveLength(1)
    expect(repositories.researchCheckpointRepo.list(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkpointKey: 'workflow:extracting_evidence:v1', resumeCursor: expect.objectContaining({ nextPhase: 'assessing_coverage' }) }),
    ]))
  })

  it('reuses the durable iteration stop decision before outline construction without calling the gap planner again', async () => {
    const repositories = await loadRepositories()
    const run = createRun(repositories)
    activateAttempt(repositories, run.id, 'gap_filling')
    const { planIteration } = await import('./plan-iteration')
    const state = {
      runId: run.id,
      brief: researchBriefSchema.parse(brief),
      coverageComplete: false,
      marginalNewEvidenceCount: 0,
      cancelled: false,
      iterations: 0,
      maxIterations: run.budget.maxIterations,
    }
    const gapAnalyst = { plan: vi.fn(async () => []) }

    const first = await planIteration(state, { repositories, gapAnalyst })
    const replay = await planIteration(first, { repositories, gapAnalyst })

    expect(first.stopDecision).toBe('stop_no_actionable_gaps')
    expect(replay.stopDecision).toBe('stop_no_actionable_gaps')
    expect(gapAnalyst.plan).toHaveBeenCalledTimes(1)
    expect(repositories.researchIterationRepo.listStopDecisions(run.id)).toHaveLength(1)
  })

  it('registers an existing report artifact after a fault without regenerating or translating it', async () => {
    const repositories = await loadRepositories()
    const run = createRun(repositories)
    repositories.researchRunRepo.transitionWithEvent(run.id, 'planning', { phase: 'planning' })
    repositories.researchRunRepo.transitionWithEvent(run.id, 'researching', { phase: 'researching' })
    repositories.researchRunRepo.transitionWithEvent(run.id, 'synthesizing', { phase: 'synthesizing' })
    repositories.researchRunRepo.transitionWithEvent(run.id, 'verifying', { phase: 'verifying' })
    activateAttempt(repositories, run.id, 'finalizing_artifacts')
    repositories.researchRunRepo.setQuality(run.id, quality)
    const report = repositories.researchReportRepo.upsertArtifact({
      runId: run.id,
      type: 'report_markdown',
      fileName: 'report.md',
      contentType: 'text/markdown',
      storagePath: 'already-generated/report.md',
      sizeBytes: 12,
      idempotencyKey: 'existing-report:' + run.id,
    })
    repositories.researchReportRepo.upsertArtifact({
      runId: run.id,
      type: 'report_markdown_zh_cn',
      fileName: 'report.zh-CN.md',
      contentType: 'text/markdown',
      storagePath: 'already-generated/report.zh-CN.md',
      sizeBytes: 12,
      idempotencyKey: 'existing-report-zh:' + run.id,
    })
    const artifactService = { write: vi.fn(), writeChineseMarkdown: vi.fn() }
    const reportTranslator = { translate: vi.fn() }
    const step = createFinalizeArtifactsStep({ repositories, artifactService: artifactService as any, reportTranslator: reportTranslator as any })

    await (step as any).execute({ inputData: { runId: run.id } })

    expect(artifactService.write).not.toHaveBeenCalled()
    expect(artifactService.writeChineseMarkdown).not.toHaveBeenCalled()
    expect(reportTranslator.translate).not.toHaveBeenCalled()
    expect(repositories.researchRunRepo.get(run.id)).toMatchObject({ reportArtifactId: report.id, status: 'completed', phase: 'report_complete' })
  })

  it('rejects an incompatible workflow cursor in load-run and restarts from the planning boundary', async () => {
    const repositories = await loadRepositories()
    const run = createRun(repositories)
    const attempt = repositories.researchAttemptRepo.create({ runId: run.id, trigger: 'manual_resume' })
    const executorId = 'checkpoint-recovery-test'
    const ownershipToken = 'incompatible-cursor:' + attempt.id
    expect(repositories.researchAttemptRepo.acquireLease(attempt.id, executorId, ownershipToken, 60_000)).toBe(true)
    const incompatibleCursor = {
      ...createCheckpointCursor(run, 'finalizing_artifacts'),
      workflowVersion: 'deep-research-v0',
    }
    const step = createLoadRunStep(repositories)

    await (step as any).execute({ inputData: {
      runId: run.id,
      attempt: { attemptId: attempt.id, executorId, ownershipToken, resumeCursor: incompatibleCursor },
    } })

    expect(getWorkflowExecution(run.id)?.resumeCursor).toMatchObject({ nextPhase: 'planning' })
    expect(repositories.researchRunRepo.get(run.id)).toMatchObject({ status: 'planning', phase: 'planning' })
  })
})