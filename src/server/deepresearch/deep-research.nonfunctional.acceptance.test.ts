import { describe, expect, it, vi } from 'vitest'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { getResearchBudget } from './domain/budgets'
import { decideIteration } from './domain/iteration-decision'
import { createBoundedPersistentIterationStep } from '../mastra/deepresearch/steps/gap-fill-iteration'

const usage = {
  questions: 0,
  iterations: 0,
  searchQueries: 0,
  normalizedSources: 0,
  fetchedSources: 0,
  tokens: 0,
  providerCostUsd: 0,
  startedAt: null,
  deadlineAt: null,
}

const actionableAssessment = {
  questionId: 'question-1',
  score: 0.25,
  verdict: 'limited',
  limitation: null,
  gaps: [{ code: 'MISSING_PRIMARY_SOURCE', severity: 'high', remediable: true, remediation: 'search_primary', recommendedSearchIntent: 'search_primary' }],
}

function runForDepth(depth: 'standard' | 'deep' | 'exhaustive'): ResearchRunDto {
  const budget = getResearchBudget(depth)
  return {
    id: `nfr-${depth}`,
    sessionId: null,
    topic: 'Frozen nonfunctional acceptance fixture',
    profile: 'general',
    depth,
    status: 'researching',
    phase: 'gap_filling',
    progress: 50,
    brief: null,
    workflowRunId: null,
    budget: { ...budget },
    usage: { ...usage, searchQueries: budget.maxSearchQueries },
    quality: null,
    reportArtifactId: null,
    resumePhase: null,
    error: null,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
  }
}

function iterationInput(runId: string) {
  return {
    runId,
    brief: null,
    coverageComplete: false,
    marginalNewEvidenceCount: 0,
    cancelled: false,
    iterations: 0,
    maxIterations: 0,
    iterationId: null,
    queryIds: [],
    sourceIds: [],
    stopDecision: null,
    limitations: [],
  }
}

describe('Deep Research nonfunctional acceptance matrix', () => {
  it.each(['standard', 'deep', 'exhaustive'] as const)(
    'cost boundary: frozen %s fixture stops before Search, Fetch, or Model dispatch when its hard budget is exhausted',
    async (depth) => {
      const run = runForDepth(depth)
      const stopDecisions: unknown[] = []
      const repositories = {
        researchRunRepo: { get: vi.fn(() => run) },
        researchCoverageAssessmentRepo: { getLatest: vi.fn(() => null) },
        researchIterationRepo: {
          list: vi.fn(() => []),
          listStopDecisions: vi.fn(() => []),
          recordStopDecision: vi.fn(({ stopReason }) => {
            stopDecisions.push(stopReason)
            return { decision: stopReason }
          }),
        },
      } as any
      const fakeModel = { plan: vi.fn(async () => [{ questionId: 'question-1', query: 'must not execute', intent: 'search_primary' }]) }
      const fakeSearch = { search: vi.fn(async () => []) }
      const fakeFetch = { fetch: vi.fn(async () => []) }
      const fakeEvidence = { extract: vi.fn(async () => ({ createdCount: 0, coverage: [] })) }
      const step = createBoundedPersistentIterationStep({
        repositories,
        gapAnalyst: fakeModel,
        searchService: fakeSearch,
        sourceCurator: { curate: vi.fn(() => ({ selected: [] })) },
        contentService: fakeFetch,
        evidenceService: fakeEvidence,
      } as any)

      const result = await (step as any).execute({ inputData: iterationInput(run.id) })

      expect(result).toMatchObject({ stopDecision: 'stop_budget', iterationId: null })
      expect(stopDecisions).toHaveLength(1)
      expect(stopDecisions[0]).toMatchObject({ decision: 'stop_budget', matchedRule: 'budget_exhausted' })
      expect(fakeModel.plan).not.toHaveBeenCalled()
      expect(fakeSearch.search).not.toHaveBeenCalled()
      expect(fakeFetch.fetch).not.toHaveBeenCalled()
      expect(fakeEvidence.extract).not.toHaveBeenCalled()
      expect(run.usage.searchQueries).toBeLessThanOrEqual(run.budget.maxSearchQueries)
    },
  )

  it.each([
    ['coverage reached', { assessments: [{ ...actionableAssessment, verdict: 'covered', score: 1, gaps: [] }], queryCandidates: [] }, 'stop_covered'],
    ['hard budget exhausted', { assessments: [actionableAssessment], usage: { ...usage, searchQueries: 1 }, budget: { ...getResearchBudget('standard'), maxSearchQueries: 1 }, queryCandidates: [] }, 'stop_budget'],
    ['two consecutive no-gain iterations', { assessments: [actionableAssessment], budget: { ...getResearchBudget('deep'), maxIterations: 4 }, usage: { ...usage, iterations: 2 }, iterations: [{ ordinal: 1, status: 'completed', decision: null, completedAt: 1, materialGain: false }, { ordinal: 2, status: 'completed', decision: null, completedAt: 2, materialGain: false }], queryCandidates: [{ questionId: 'question-1', query: 'frozen query', intent: 'search_primary' }] }, 'stop_no_material_gain'],
    ['no actionable gap', { assessments: [actionableAssessment], queryCandidates: [] }, 'stop_no_actionable_gaps'],
    ['cancellation requested', { assessments: [actionableAssessment], cancellationRequested: true, queryCandidates: [{ questionId: 'question-1', query: 'frozen query', intent: 'search_primary' }] }, 'stop_cancelled'],
    ['maximum iterations reached', { assessments: [actionableAssessment], budget: { ...getResearchBudget('standard'), maxIterations: 1 }, usage: { ...usage, iterations: 1 }, iterations: [{ ordinal: 1, status: 'completed', decision: null, completedAt: 1, materialGain: true }], queryCandidates: [{ questionId: 'question-1', query: 'frozen query', intent: 'search_primary' }] }, 'stop_max_iterations'],
  ] as const)('termination: %s resolves to %s without creating another iteration', (_label, overrides, expectedDecision) => {
    const result = decideIteration(Object.assign({
      assessments: [],
      previousAssessment: null,
      iterations: [],
      budget: getResearchBudget('standard'),
      usage,
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [],
    }, overrides) as any)

    expect(result).toMatchObject({ shouldCreateIteration: false, decision: { decision: expectedDecision } })
  })
})
