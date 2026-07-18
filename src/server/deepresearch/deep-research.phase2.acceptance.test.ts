import { describe, expect, it } from 'vitest'
import { decideIteration } from './domain/iteration-decision'
import { projectResearchRunCapabilities, resolveResearchRunTransition } from './domain/state-machine'

const budget = {
  maxQuestions: 4,
  maxIterations: 3,
  maxSearchQueries: 4,
  maxNormalizedSources: 4,
  maxFetchedSources: 4,
  searchConcurrency: 1,
  fetchConcurrency: 1,
  maxDurationMs: 60_000,
}

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

describe('Deep Research Phase 2 release-gate acceptance', () => {
  it('keeps cancellation terminal during a finalize race and never exposes resume', () => {
    expect(resolveResearchRunTransition({
      from: 'cancelling',
      to: 'completed',
      cancellationRequested: true,
    })).toBe('cancelled')
    expect(projectResearchRunCapabilities({ status: 'cancelled' })).toMatchObject({
      canCancel: false,
      canResume: false,
      canRetry: false,
    })
  })

  it('stops before dispatch when a hard budget is exhausted', () => {
    const result = decideIteration({
      assessments: [],
      previousAssessment: null,
      iterations: [],
      budget,
      usage: { ...usage, searchQueries: budget.maxSearchQueries },
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [],
    })

    expect(result).toMatchObject({
      shouldCreateIteration: false,
      decision: { decision: 'stop_budget', matchedRule: 'budget_exhausted' },
    })
  })

  it('stops a bounded loop after two no-gain iterations without invoking a provider', () => {
    const result = decideIteration({
      assessments: [{ verdict: 'limited', gaps: [{ remediable: true, remediation: 'search_primary', severity: 'high', code: 'MISSING_PRIMARY_SOURCE' }] }],
      iterations: [
        { ordinal: 1, status: 'completed', decision: null, completedAt: 1, materialGain: false },
        { ordinal: 2, status: 'completed', decision: null, completedAt: 2, materialGain: false },
      ],
      budget: { ...budget, maxIterations: 4 },
      usage: { ...usage, iterations: 2 },
      reservations: [],
      cancellationRequested: false,
      queryCandidates: [{ questionId: 'q-1', query: 'safe frozen fixture', searchIntent: 'search_primary' }],
    } as any)

    expect(result).toMatchObject({
      shouldCreateIteration: false,
      decision: { decision: 'stop_no_material_gain', matchedRule: 'no_material_gain' },
    })
  })
})
