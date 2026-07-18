import { describe, expect, it } from 'vitest'
import type { ResearchBudgetDto, ResearchCoverageAssessmentV2Dto, ResearchIterationDto, ResearchUsageDto } from '@shared/deepresearch/contracts'
import { decideIteration } from './iteration-decision'

const budget: ResearchBudgetDto = {
  maxQuestions: 10,
  maxIterations: 3,
  maxSearchQueries: 8,
  maxNormalizedSources: 10,
  maxFetchedSources: 8,
  maxTokens: 1_000,
  maxProviderCostUsd: 5,
  searchConcurrency: 1,
  fetchConcurrency: 1,
  maxDurationMs: 60_000,
}

const usage: ResearchUsageDto = {
  questions: 1,
  iterations: 0,
  searchQueries: 0,
  normalizedSources: 0,
  fetchedSources: 0,
  tokens: 0,
  providerCostUsd: 0,
  startedAt: 1,
  deadlineAt: null,
}

function assessment(overrides: Partial<ResearchCoverageAssessmentV2Dto> = {}): ResearchCoverageAssessmentV2Dto {
  return {
    policyVersion: 'v2',
    profile: 'market',
    questionId: 'q-1',
    inputFingerprint: 'assessment:q-1',
    score: 0.4,
    verdict: 'uncovered',
    dimensions: {
      evidenceSufficiency: 0,
      independentCorroboration: 0,
      authority: 0,
      recency: 0,
      requiredEvidenceTypes: 0,
      contradictionHandling: 0,
    },
    sourceCounts: { evidence: 0, distinctSources: 0, independentDomains: 0, primaryOrAuthoritative: 0, recent: 0 },
    support: { supporting: 0, contradicting: 0, contextual: 0 },
    gaps: [{
      code: 'NO_EVIDENCE',
      severity: 'critical',
      remediable: true,
      remediation: 'search_primary',
      recommendedSearchIntent: 'official source',
    }],
    limitation: null,
    suggestedSearchIntents: ['official source'],
    materialGain: null,
    assessedAt: 1,
    ...overrides,
  }
}

function history(material: boolean): Pick<ResearchIterationDto, 'ordinal' | 'status' | 'decision' | 'completedAt'> & { materialGain?: boolean } {
  return { ordinal: material ? 1 : 2, status: 'completed', decision: 'continue', completedAt: 1, materialGain: material }
}

describe('iteration decisions', () => {
  it('stops an initially covered assessment without creating an iteration', () => {
    const result = decideIteration({
      assessments: [assessment({ verdict: 'covered', score: 1, gaps: [], suggestedSearchIntents: [] })],
      previousAssessment: null,
      iterations: [],
      budget,
      usage,
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [],
    })

    expect(result).toMatchObject({
      shouldCreateIteration: false,
      decision: { decision: 'stop_covered', matchedRule: 'coverage_reached' },
    })
  })

  it('stops before dispatch when a critical remediable gap cannot reserve its budget', () => {
    const result = decideIteration({
      assessments: [assessment()],
      previousAssessment: null,
      iterations: [],
      budget: { ...budget, maxSearchQueries: 0 },
      usage,
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [{ questionId: 'q-1', query: 'official q-1 source', intent: 'official source' }],
    })

    expect(result).toMatchObject({
      shouldCreateIteration: false,
      decision: { decision: 'stop_budget', matchedRule: 'budget_exhausted' },
    })
    expect(result.limitationCodes).toContain('BUDGET_EXHAUSTED')
  })

  it('stops after two consecutive completed iterations without material gain', () => {
    const result = decideIteration({
      assessments: [assessment()],
      previousAssessment: assessment(),
      iterations: [history(false), { ...history(false), ordinal: 1 }],
      budget,
      usage,
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [{ questionId: 'q-1', query: 'official q-1 source', intent: 'official source' }],
    })

    expect(result.decision).toMatchObject({ decision: 'stop_no_material_gain', matchedRule: 'no_material_gain' })
  })

  it('stops when gaps exist but no executable query candidate exists', () => {
    const result = decideIteration({
      assessments: [assessment()],
      previousAssessment: null,
      iterations: [],
      budget,
      usage,
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [],
    })

    expect(result.decision).toMatchObject({ decision: 'stop_no_actionable_gaps', matchedRule: 'no_actionable_gaps' })
  })

  it('gives cancellation priority over coverage and every other stop condition', () => {
    const result = decideIteration({
      assessments: [assessment({ verdict: 'covered', score: 1, gaps: [] })],
      previousAssessment: null,
      iterations: [{ ...history(false), ordinal: 3 }],
      budget: { ...budget, maxIterations: 0 },
      usage,
      reservations: [],
      cancellationRequested: true,
      queryCandidates: [],
    })

    expect(result.decision).toMatchObject({ decision: 'stop_cancelled', matchedRule: 'cancellation_requested' })
  })

  it('treats maximum iterations as a hard stop and never creates a plan', () => {
    const result = decideIteration({
      assessments: [assessment()],
      previousAssessment: null,
      iterations: [{ ...history(true), ordinal: 3 }],
      budget: { ...budget, maxIterations: 3 },
      usage: { ...usage, iterations: 2 },
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [{ questionId: 'q-1', query: 'official q-1 source', intent: 'official source' }],
    })

    expect(result).toMatchObject({
      shouldCreateIteration: false,
      decision: { decision: 'stop_max_iterations', matchedRule: 'max_iterations' },
    })
  })

  it('sorts actionable work deterministically and excludes blocked or unremediable gaps', () => {
    const result = decideIteration({
      assessments: [
        assessment({ questionId: 'q-b', gaps: [{ code: 'NO_EVIDENCE', severity: 'high', remediable: true, remediation: 'search_primary', recommendedSearchIntent: 'first' }] }),
        assessment({ questionId: 'q-a', gaps: [
          { code: 'NO_EVIDENCE', severity: 'critical', remediable: true, remediation: 'search_primary', recommendedSearchIntent: 'second' },
          { code: 'SINGLE_DOMAIN', severity: 'critical', remediable: false, remediation: 'disclose_limitation', recommendedSearchIntent: null },
        ] }),
        assessment({ questionId: 'q-c', verdict: 'blocked' }),
      ],
      previousAssessment: null,
      iterations: [],
      budget,
      usage,
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [
        { questionId: 'q-b', query: 'b query', intent: 'first' },
        { questionId: 'q-a', query: 'z query', intent: 'second' },
        { questionId: 'q-a', query: 'a query', intent: 'second' },
        { questionId: 'q-c', query: 'blocked query', intent: 'official source' },
      ],
    })

    expect(result.plan?.targets.map((target) => [target.questionId, target.query])).toEqual([
      ['q-a', 'a query'],
      ['q-a', 'z query'],
      ['q-b', 'b query'],
    ])
  })
})
