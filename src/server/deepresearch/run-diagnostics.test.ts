import { describe, expect, it, vi } from 'vitest'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { buildResearchRunDiagnostics, recordProductionRunDiagnosticEvents } from './run-diagnostics'

const run = (overrides: Partial<ResearchRunDto> = {}): ResearchRunDto => ({
  id: 'run-diagnostics', sessionId: null, topic: 'private topic', profile: 'market', depth: 'deep', status: 'completed_with_limitations', phase: 'report_complete', progress: 100,
  brief: null, workflowRunId: 'workflow-1', budget: { maxQuestions: 3, maxIterations: 2, maxSearchQueries: 8, maxNormalizedSources: 8, maxFetchedSources: 4, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 10_000 },
  usage: { questions: 1, iterations: 1, searchQueries: 1, normalizedSources: 2, fetchedSources: 1, tokens: 0, providerCostUsd: 0, startedAt: 1, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 2, completedAt: 3,
  modelSelectionSnapshot: { requestedModelId: null, selectedModelId: 'configured-model', providerId: 'provider-1', providerKind: 'openai', selectionSource: 'deep_research_setting', settingsKey: 'deep_research_model', modelContractVersion: 'v1', resolvedAt: 1 },
  ...overrides,
})

describe('Run diagnostics', () => {
  it('aggregates quality signals without retaining source bodies or provider credentials', () => {
    const diagnostics = buildResearchRunDiagnostics({
      run: run(),
      questions: [{ id: 'q1', runId: 'run-diagnostics', parentQuestionId: null, ordinal: 1, question: 'Private question', intent: 'market', requiredEvidenceTypes: [], priority: 'high', status: 'limited', coverage: null }],
      searchQueries: [{ id: 'query-1', runId: 'run-diagnostics', questionId: 'q1', iteration: 1, query: 'private search', intent: 'market', sourceTargets: [], provider: 'test', status: 'completed', resultCount: 2, error: null, candidates: [], idempotencyKey: 'query-1', createdAt: 1, completedAt: 2 }],
      sources: [{ id: 'source-1', runId: 'run-diagnostics', canonicalUrl: 'https://source.example/a', originalUrl: 'https://source.example/a', domain: 'source.example', title: 'Source', author: null, publisher: null, publishedAt: null, sourceType: 'company_official', selectionStatus: 'selected', scores: { finalScore: 0.8 } }],
      snapshots: [{ id: 'snapshot-1', runId: 'run-diagnostics', sourceId: 'source-1', contentHash: 'hash', content: 'secret source body', metadata: { extraction: { rawCharacters: 2000, mainCharacters: 1400, rejectionReasons: [] } }, fetchedAt: 2, parserVersion: 'v1', finalUrl: 'https://source.example/a', httpStatus: 200 }],
      evidence: [{ questionId: 'q1' }], sections: [], claims: [], citations: [], quality: null,
      candidateAssessments: [{ id: 'candidate-1', runId: 'run-diagnostics', questionId: 'q1', queryId: 'query-1', candidateKey: 'key', canonicalUrl: 'https://source.example/a', originalUrl: 'https://source.example/a', domain: 'source.example', title: 'Source', snippet: 'ignored', category: 'company-official-site', scoringMethod: 'keyword-fallback', scoreBreakdown: { relevance: 0.8, authority: 0.8, recency: 0.8, independence: 0.8, fetchability: 0.8, final: 0.8 }, reasons: [], rejectionReasons: [], selectionStatus: 'selected', createdAt: 1, updatedAt: 1 }],
      events: [], attempts: [], coverageAssessments: [],
    })
    expect(diagnostics.coverage).toMatchObject({ highPriorityCoverage: 0, evidenceCount: 1 })
    expect(diagnostics.fetch.snapshots[0]).not.toHaveProperty('content')
    expect(JSON.stringify(diagnostics)).not.toContain('secret source body')
    expect(JSON.stringify(diagnostics)).not.toContain('api_key')
  })

  it('writes each production anomaly once and excludes legacy deterministic Runs', () => {
    const append = vi.fn()
    const repositories = { researchEventRepo: { append, list: vi.fn(() => []) } }
    const questions = [{ id: 'q1', runId: 'run-diagnostics', parentQuestionId: null, ordinal: 1, question: 'q', intent: 'i', requiredEvidenceTypes: [], priority: 'high' as const, status: 'limited' as const, coverage: null }]
    recordProductionRunDiagnosticEvents(repositories, run(), 'finalizing_artifacts', [
      { kind: 'tokens_zero' },
      { kind: 'source_scores_uniform', scores: [0.5, 0.5] },
      { kind: 'gap_fill_no_new_sources', iteration: 2, newSourceCount: 0 },
      { kind: 'high_priority_coverage_zero', questions },
    ])
    expect(append.mock.calls.map(([event]) => event.payload.code)).toEqual(['tokens_zero', 'source_scores_uniform', 'gap_fill_no_new_sources', 'high_priority_coverage_zero'])
    append.mockClear()
    recordProductionRunDiagnosticEvents(repositories, run({ modelSelectionSnapshot: null }), 'finalizing_artifacts', [{ kind: 'tokens_zero' }])
    expect(append).not.toHaveBeenCalled()
  })
})
