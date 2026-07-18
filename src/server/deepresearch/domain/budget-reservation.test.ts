import { describe, expect, it } from 'vitest'
import type { ResearchBudgetDto, ResearchUsageDto } from '@shared/deepresearch/contracts'
import { reserveBudget, settleBudgetReservation } from './budget-reservation'

const budget: ResearchBudgetDto = {
  maxQuestions: 10,
  maxIterations: 3,
  maxSearchQueries: 4,
  maxNormalizedSources: 10,
  maxFetchedSources: 4,
  maxTokens: 100,
  maxProviderCostUsd: 1,
  searchConcurrency: 1,
  fetchConcurrency: 1,
  maxDurationMs: 60_000,
}
const usage: ResearchUsageDto = {
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

describe('budget reservations', () => {
  it('reserves search, fetch, model, and iteration budget before execution', () => {
    const reserved = reserveBudget({
      budget,
      usage,
      existingReservations: [],
      requested: { iterations: 1, searchQueries: 2, fetchedSources: 2, modelTokens: 40, providerCostUsd: 0.4 },
    })

    expect(reserved).toMatchObject({ ok: true })
    expect(reserved.snapshot.available).toMatchObject({ iterations: 2, searchQueries: 2, fetchedSources: 2, modelTokens: 60, providerCostUsd: 0.6 })
  })

  it('rejects a reservation that would exceed usage plus active reservations', () => {
    const reserved = reserveBudget({
      budget,
      usage: { ...usage, searchQueries: 2 },
      existingReservations: [{ iterations: 0, searchQueries: 2, fetchedSources: 0, modelTokens: 0, providerCostUsd: 0 }],
      requested: { iterations: 1, searchQueries: 1, fetchedSources: 0, modelTokens: 0, providerCostUsd: 0 },
    })

    expect(reserved).toMatchObject({ ok: false, exhausted: ['searchQueries'] })
  })

  it('settles actual consumption and releases unused budget after cancellation or failure', () => {
    const settlement = settleBudgetReservation(
      { iterations: 1, searchQueries: 3, fetchedSources: 3, modelTokens: 60, providerCostUsd: 0.6 },
      { iterations: 0, searchQueries: 1, fetchedSources: 1, modelTokens: 10, providerCostUsd: 0.1 },
    )

    expect(settlement.spent).toEqual({ iterations: 0, searchQueries: 1, fetchedSources: 1, modelTokens: 10, providerCostUsd: 0.1 })
    expect(settlement.released).toEqual({ iterations: 1, searchQueries: 2, fetchedSources: 2, modelTokens: 50, providerCostUsd: 0.5 })
  })

  it('rejects settlement that claims more than the reservation', () => {
    expect(() => settleBudgetReservation(
      { iterations: 1, searchQueries: 1, fetchedSources: 1, modelTokens: 10, providerCostUsd: 0 },
      { iterations: 1, searchQueries: 2, fetchedSources: 1, modelTokens: 10, providerCostUsd: 0 },
    )).toThrow(/reservation/i)
  })
})
