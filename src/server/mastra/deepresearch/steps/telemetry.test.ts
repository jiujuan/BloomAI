import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { createExecuteSearchesStep } from './execute-searches'
import { createFinalizeArtifactsStep } from './finalize-artifacts'
import {
  recordDeepResearchCompletion,
  recordDeepResearchE2EDuration,
  recordDeepResearchSearchLatency,
  traceDeepResearchPhase,
} from '@server/telemetry/metrics'

vi.mock('@server/telemetry/metrics', () => ({
  deepResearchTraceAttributes: vi.fn((context) => context),
  recordDeepResearchCompletion: vi.fn(),
  recordDeepResearchE2EDuration: vi.fn(),
  recordDeepResearchFailure: vi.fn(),
  recordDeepResearchSearchLatency: vi.fn(),
  setDeepResearchSpanCounts: vi.fn(),
  traceDeepResearchPhase: vi.fn(async (_phase, _context, operation) => operation({ setAttributes: vi.fn(), setStatus: vi.fn(), end: vi.fn() })),
}))

const budget = {
  maxQuestions: 1,
  maxIterations: 1,
  maxSearchQueries: 1,
  maxNormalizedSources: 1,
  maxFetchedSources: 1,
  searchConcurrency: 1,
  fetchConcurrency: 1,
  maxDurationMs: 60_000,
}

function run(overrides: Partial<ResearchRunDto> = {}): ResearchRunDto {
  return {
    id: overrides.id ?? 'run-1',
    sessionId: null,
    topic: 'private topic',
    profile: 'general',
    depth: 'standard',
    status: overrides.status ?? 'planning',
    phase: overrides.phase ?? 'planning',
    progress: 0,
    brief: null,
    workflowRunId: 'workflow-1',
    budget,
    usage: {
      questions: 0,
      iterations: 0,
      searchQueries: 0,
      normalizedSources: 0,
      fetchedSources: 0,
      tokens: 0,
      providerCostUsd: 0,
      startedAt: null,
      deadlineAt: null,
    },
    quality: null,
    reportArtifactId: null,
    resumePhase: null,
    error: null,
    createdAt: Date.now() - 1_000,
    updatedAt: Date.now() - 1_000,
    completedAt: null,
    ...overrides,
  }
}

describe('Deep Research workflow telemetry wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records privacy-safe search latency from the execute-searches step', async () => {
    const currentRun = run({ id: 'search-run', status: 'planning', phase: 'planning' })
    const repositories = {
      researchRunRepo: { get: vi.fn(() => currentRun) },
      researchQuestionRepo: {
        listSearchQueries: vi.fn(() => [{ id: 'query-1', query: 'private query', status: 'queued' }]),
        updateSearchQuery: vi.fn(),
      },
      researchEventRepo: { append: vi.fn() },
    } as any
    const searchService = {
      search: vi.fn(async () => [{ queryId: 'query-1', provider: 'test', candidates: [{ queryId: 'query-1', title: 'T', url: 'https://example.invalid/private', snippet: 'private' }] }]),
    }
    const step = createExecuteSearchesStep({ repositories, searchService } as any)

    await (step as any).execute({ inputData: { runId: currentRun.id, brief: { title: 'T', objective: null, audience: null, scope: 'S', assumptions: [], plannedSections: [], criticalClarificationIds: [] } } })

    expect(traceDeepResearchPhase).toHaveBeenCalledWith('searching', expect.objectContaining({ researchRunId: 'search-run', workflowRunId: 'workflow-1', counts: { queries: 1 } }), expect.any(Function))
    expect(recordDeepResearchSearchLatency).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ researchRunId: 'search-run', workflowRunId: 'workflow-1', counts: { queries: 1 } }))
    expect(recordDeepResearchSearchLatency).not.toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ topic: expect.anything() }))
  })

  it('records completion and e2e duration from finalization', async () => {
    const currentRun = run({
      id: 'final-run',
      status: 'verifying',
      phase: 'verifying',
      quality: {
        releaseStatus: 'completed_with_limitations',
        highPriorityQuestionCoverage: 1,
        factualClaimCitationCoverage: 1,
        supportedCitationCoverage: 1,
        independentCitedDomainCount: 1,
        contradictionDisclosureCoverage: 1,
        requiredSectionCoverage: 1,
        limitations: ['limited evidence'],
        assessorVersion: 'test',
      },
    })
    const repositories = {
      researchRunRepo: {
        get: vi.fn(() => currentRun),
        setReportArtifactId: vi.fn(),
        transitionWithEvent: vi.fn(),
      },
      researchQuestionRepo: { list: vi.fn(() => []) },
      researchReportRepo: { listArtifacts: vi.fn(() => []), listSections: vi.fn(() => []), listClaims: vi.fn(() => []), listCitations: vi.fn(() => []) },
      researchEvidenceRepo: { list: vi.fn(() => []) },
      researchSourceRepo: { listSources: vi.fn(() => []), listSnapshots: vi.fn(() => []) },
      researchEventRepo: { append: vi.fn() },
    } as any
    const artifactService = { write: vi.fn(() => [{ id: 'artifact-1', type: 'report_markdown' }]), writeChineseMarkdown: vi.fn(() => ({ id: 'artifact-zh', type: 'report_markdown_zh_cn' })) }
    const reportTranslator = { translate: vi.fn(async () => '# \u4e2d\u6587\u62a5\u544a\n') }
    const step = createFinalizeArtifactsStep({ repositories, artifactService, reportTranslator } as any)

    await (step as any).execute({ inputData: { runId: currentRun.id } })

    expect(reportTranslator.translate).toHaveBeenCalledOnce()
    expect(artifactService.writeChineseMarkdown).toHaveBeenCalledWith('final-run', '# \u4e2d\u6587\u62a5\u544a\n')
    expect(recordDeepResearchCompletion).toHaveBeenCalledWith('completed_with_limitations', expect.objectContaining({ researchRunId: 'final-run', workflowRunId: 'workflow-1', counts: { limitations: 1 } }))
    expect(recordDeepResearchE2EDuration).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ researchRunId: 'final-run', workflowRunId: 'workflow-1' }))
  })
})
