import { describe, expect, it } from 'vitest'
import { getResearchBudget } from './budgets'

describe('deep research budgets', () => {
  it('returns immutable deep limits', () => {
    const budget = getResearchBudget('deep')

    expect(budget.maxQuestions).toBe(14)
    expect(budget.maxIterations).toBe(3)
    expect(budget.maxDurationMs).toBe(30 * 60 * 1000)
    expect(() => Object.assign(budget, { maxQuestions: 99 })).toThrow()
  })

  it('increases hard limits with depth', () => {
    expect(getResearchBudget('standard').maxSearchQueries).toBeLessThan(getResearchBudget('deep').maxSearchQueries)
    expect(getResearchBudget('deep').maxSearchQueries).toBeLessThan(getResearchBudget('exhaustive').maxSearchQueries)
  })
})
