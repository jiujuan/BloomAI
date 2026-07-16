import { describe, expect, it } from 'vitest'
import { ResearchDomainError, isResearchDomainError } from './errors'

describe('ResearchDomainError', () => {
  it('carries a stable code, retryability, and message', () => {
    const error = new ResearchDomainError('RESEARCH_BUDGET_EXHAUSTED', 'Research budget has been exhausted', false)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ResearchDomainError')
    expect(error.code).toBe('RESEARCH_BUDGET_EXHAUSTED')
    expect(error.retryable).toBe(false)
    expect(error.message).toBe('RESEARCH_BUDGET_EXHAUSTED: Research budget has been exhausted')
    expect(isResearchDomainError(error)).toBe(true)
  })

  it('does not classify arbitrary errors as domain errors', () => {
    expect(isResearchDomainError(new Error('message'))).toBe(false)
  })
})
