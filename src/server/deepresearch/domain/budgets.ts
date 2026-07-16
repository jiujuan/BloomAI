import type { ResearchBudgetDto, ResearchDepth } from '@shared/deepresearch/contracts'
import { ResearchDomainError } from './errors'

function freezeBudget(budget: ResearchBudgetDto): Readonly<ResearchBudgetDto> {
  return Object.freeze({ ...budget })
}

const RESEARCH_BUDGETS: Readonly<Record<ResearchDepth, Readonly<ResearchBudgetDto>>> = Object.freeze({
  standard: freezeBudget({
    maxQuestions: 8,
    maxIterations: 1,
    maxSearchQueries: 20,
    maxNormalizedSources: 24,
    maxFetchedSources: 16,
    searchConcurrency: 4,
    fetchConcurrency: 3,
    maxDurationMs: 10 * 60 * 1000,
  }),
  deep: freezeBudget({
    maxQuestions: 14,
    maxIterations: 3,
    maxSearchQueries: 48,
    maxNormalizedSources: 50,
    maxFetchedSources: 36,
    searchConcurrency: 6,
    fetchConcurrency: 5,
    maxDurationMs: 30 * 60 * 1000,
  }),
  exhaustive: freezeBudget({
    maxQuestions: 24,
    maxIterations: 5,
    maxSearchQueries: 90,
    maxNormalizedSources: 100,
    maxFetchedSources: 70,
    searchConcurrency: 8,
    fetchConcurrency: 6,
    maxDurationMs: 60 * 60 * 1000,
  }),
})

export function getResearchBudget(depth: ResearchDepth): Readonly<ResearchBudgetDto> {
  const budget = RESEARCH_BUDGETS[depth]

  if (budget) {
    return budget
  }

  throw new ResearchDomainError('RESEARCH_INVALID_DEPTH', 'Unknown research depth: ' + depth, false)
}
