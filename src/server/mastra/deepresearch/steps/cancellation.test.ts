import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResearchReportSectionDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { createBuildBriefStep } from './build-brief'
import { createDraftSectionsStep } from './draft-sections'
import { createFinalizeArtifactsStep } from './finalize-artifacts'
import { executeIterationRetrieval } from './execute-iteration-retrieval'
import { bindWorkflowExecution, clearWorkflowExecution } from './checkpoint-replay'

function createRun(overrides: Partial<ResearchRunDto> = {}): ResearchRunDto {
  return {
    id: 'cancel-step-run', sessionId: null, topic: 'Cancellation boundary', profile: 'general', depth: 'standard',
    status: 'planning', phase: 'planning', progress: 10, brief: null, workflowRunId: null,
    budget: { maxQuestions: 10, maxIterations: 1, maxSearchQueries: 10, maxNormalizedSources: 10, maxFetchedSources: 10, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
    usage: { questions: 0, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
    quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 0, updatedAt: 0, completedAt: null,
    ...overrides,
  }
}

function bindCancelledSignal(runId: string, controller: AbortController): void {
  bindWorkflowExecution(runId, { attemptId: 'attempt-' + runId, ownershipToken: 'owner-' + runId, signal: controller.signal, resumeCursor: null })
}

afterEach(() => clearWorkflowExecution('cancel-step-run'))

describe('Deep Research cancellation step boundaries', () => {
  it('planning stops after an aborted planner return without persisting a brief or starting queries', async () => {
    const controller = new AbortController()
    const run = createRun()
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), setBrief: vi.fn() },
      researchQuestionRepo: { create: vi.fn() },
      researchEventRepo: { append: vi.fn() },
    } as any
    const planner = {
      plan: vi.fn(async (_run: ResearchRunDto, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return { title: 'Cancelled plan', objective: null, audience: null, scope: 'scope', assumptions: [], plannedSections: ['summary'], criticalClarifications: [] }
      }),
    }
    bindCancelledSignal(run.id, controller)

    const step = createBuildBriefStep({ repositories, planner })
    await expect((step as any).execute({ inputData: { runId: run.id } })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(planner.plan).toHaveBeenCalledTimes(1)
    expect(repositories.researchRunRepo.setBrief).not.toHaveBeenCalled()
    expect(repositories.researchQuestionRepo.create).not.toHaveBeenCalled()
    expect(repositories.researchEventRepo.append).not.toHaveBeenCalled()
  })

  it('drafting stops after an aborted writer return without saving a section or invoking another provider', async () => {
    const controller = new AbortController()
    const run = createRun({ status: 'researching', phase: 'drafting_sections' })
    const section: ResearchReportSectionDto = { id: 'section-1', runId: run.id, ordinal: 1, title: 'summary', purpose: 'summary', draft: null, verifiedText: null, status: 'planned' }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run) },
      researchReportRepo: { listSections: vi.fn(() => [section]), updateSection: vi.fn() },
      researchQuestionRepo: { list: vi.fn(() => []) },
      researchEvidenceRepo: { list: vi.fn(() => []) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const writer = {
      draft: vi.fn(async (_input: unknown, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return 'must not persist'
      }),
    }
    bindCancelledSignal(run.id, controller)

    const step = createDraftSectionsStep({ repositories, writer })
    await expect((step as any).execute({ inputData: { runId: run.id, sectionId: section.id } })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(writer.draft).toHaveBeenCalledTimes(1)
    expect(repositories.researchReportRepo.updateSection).not.toHaveBeenCalled()
    expect(repositories.researchEventRepo.append).not.toHaveBeenCalled()
  })

  it('iteration retrieval stops at the post-search safety boundary without fetching or persisting follow-up effects', async () => {
    const controller = new AbortController()
    const run = createRun({ status: 'researching', phase: 'gap_filling' })
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run) },
      researchIterationRepo: { get: vi.fn(() => ({ id: 'iteration-1', ordinal: 1, plan: { reservation: { fetchedSources: 1 } } })), update: vi.fn() },
      researchQuestionRepo: {
        listSearchQueries: vi.fn(() => [{ id: 'query-1', iteration: 1, query: 'safe fixture query', status: 'queued', idempotencyKey: 'query-key', candidates: [] }]),
        updateSearchQuery: vi.fn(),
      },
      researchSourceRepo: { getByCanonicalUrl: vi.fn(), createSource: vi.fn(), getSource: vi.fn() },
      researchEventRepo: { append: vi.fn() },
    } as any
    const searchService = {
      search: vi.fn(async (_run: ResearchRunDto, _requests: unknown[], options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return []
      }),
    }
    const contentService = { fetch: vi.fn() }
    const sourceCurator = { curate: vi.fn(() => ({ selected: [] })) }
    bindCancelledSignal(run.id, controller)

    await expect(executeIterationRetrieval({
      runId: run.id,
      brief: { title: 'Cancellation boundary', objective: null, audience: null, scope: 'fixture', definition: null, timeframe: null, geography: null, deliverables: [], assumptions: [], plannedSections: [], questions: [], criticalClarificationIds: [] },
      coverageComplete: false,
      marginalNewEvidenceCount: 0,
      cancelled: false,
      iterations: 0,
      maxIterations: 1,
      iterationId: 'iteration-1',
      queryIds: ['query-1'],
      sourceIds: [],
      stopDecision: null,
      limitations: [],
    }, { repositories, searchService, sourceCurator, contentService } as any)).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(searchService.search).toHaveBeenCalledTimes(1)
    expect(contentService.fetch).not.toHaveBeenCalled()
    expect(repositories.researchQuestionRepo.updateSearchQuery).not.toHaveBeenCalled()
    expect(repositories.researchIterationRepo.update).not.toHaveBeenCalled()
    expect(repositories.researchEventRepo.append).not.toHaveBeenCalled()
  })

  it('fetch return racing with cancellation never records fetch completion or starts downstream work', async () => {
    const controller = new AbortController()
    const run = createRun({ status: 'researching', phase: 'gap_filling' })
    const source = { id: 'source-1', runId: run.id, canonicalUrl: 'https://fixture.example/source', originalUrl: 'https://fixture.example/source', domain: 'fixture.example', title: 'Frozen source' }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run) },
      researchIterationRepo: { get: vi.fn(() => ({ id: 'iteration-1', ordinal: 1, plan: { reservation: { fetchedSources: 1 } } })), update: vi.fn() },
      researchQuestionRepo: {
        listSearchQueries: vi.fn(() => [{ id: 'query-1', iteration: 1, query: 'frozen query', status: 'completed', candidates: [{ title: source.title, url: source.originalUrl, snippet: 'fixture' }] }]),
        updateSearchQuery: vi.fn(),
      },
      researchSourceRepo: { getByCanonicalUrl: vi.fn(() => source), createSource: vi.fn(), getSource: vi.fn(() => source) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const contentService = {
      fetch: vi.fn(async (_run: ResearchRunDto, sources: unknown[], options?: { signal?: AbortSignal }) => {
        expect(sources).toEqual([source])
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return [{ sourceId: source.id, status: 'fetched' }]
      }),
    }
    bindCancelledSignal(run.id, controller)

    await expect(executeIterationRetrieval({
      runId: run.id,
      brief: { title: 'Cancellation boundary', objective: null, audience: null, scope: 'fixture', definition: null, timeframe: null, geography: null, deliverables: [], assumptions: [], plannedSections: [], questions: [], criticalClarificationIds: [] },
      coverageComplete: false,
      marginalNewEvidenceCount: 0,
      cancelled: false,
      iterations: 0,
      maxIterations: 1,
      iterationId: 'iteration-1',
      queryIds: ['query-1'],
      sourceIds: [],
      stopDecision: null,
      limitations: [],
    }, {
      repositories,
      searchService: { search: vi.fn() },
      sourceCurator: { curate: vi.fn(() => ({ selected: [{ canonicalUrl: source.canonicalUrl, url: source.originalUrl, domain: source.domain, title: source.title, sourceType: 'web', score: 1, queryId: 'query-1' }] })) },
      contentService,
    } as any)).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(contentService.fetch).toHaveBeenCalledTimes(1)
    expect(repositories.researchEventRepo.append).not.toHaveBeenCalled()
    expect(repositories.researchIterationRepo.update).not.toHaveBeenCalled()
  })

  it('finalization stops after an aborted translator return without writing artifacts or completing the run', async () => {
    const controller = new AbortController()
    const run = createRun({
      status: 'verifying', phase: 'finalizing_artifacts',
      quality: { releaseStatus: 'completed', highPriorityQuestionCoverage: 1, factualClaimCitationCoverage: 1, supportedCitationCoverage: 1, independentCitedDomainCount: 1, contradictionDisclosureCoverage: 1, requiredSectionCoverage: 1, limitations: [], assessorVersion: 'test' },
    })
    const markdownArtifact = { id: 'report-en', runId: run.id, type: 'report_markdown', fileName: 'report.md', contentType: 'text/markdown', content: '# English report', createdAt: 0 }
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), setReportArtifactId: vi.fn(), transitionWithEvent: vi.fn() },
      researchQuestionRepo: { list: vi.fn(() => []) },
      researchEvidenceRepo: { list: vi.fn(() => []) },
      researchSourceRepo: { listSources: vi.fn(() => []), listSnapshots: vi.fn(() => []) },
      researchReportRepo: { listArtifacts: vi.fn(() => [markdownArtifact]), listSections: vi.fn(() => []), listClaims: vi.fn(() => []), listCitations: vi.fn(() => []) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const artifactService = { write: vi.fn(), writeChineseMarkdown: vi.fn() }
    const reportTranslator = {
      translate: vi.fn(async (_input: unknown, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal)
        controller.abort()
        return '# 不应写入'
      }),
    }
    bindCancelledSignal(run.id, controller)

    const step = createFinalizeArtifactsStep({ repositories, artifactService: artifactService as any, reportTranslator })
    await expect((step as any).execute({ inputData: { runId: run.id } })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })

    expect(reportTranslator.translate).toHaveBeenCalledTimes(1)
    expect(artifactService.write).not.toHaveBeenCalled()
    expect(artifactService.writeChineseMarkdown).not.toHaveBeenCalled()
    expect(repositories.researchRunRepo.setReportArtifactId).not.toHaveBeenCalled()
    expect(repositories.researchRunRepo.transitionWithEvent).not.toHaveBeenCalled()
    expect(repositories.researchEventRepo.append).not.toHaveBeenCalled()
  })
})