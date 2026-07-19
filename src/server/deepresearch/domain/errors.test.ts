import { describe, expect, it } from 'vitest'
import { classifyResearchError, ResearchDomainError, isResearchDomainError } from './errors'

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

  it('classifies cancellation and retryable transport errors with stable semantics', () => {
    expect(classifyResearchError(new ResearchDomainError('RESEARCH_CANCELLED', 'Cancelled', false))).toMatchObject({
      category: 'cancelled',
      retryable: false,
    })
    expect(classifyResearchError({ code: 'ETIMEDOUT', message: 'Timed out' })).toMatchObject({
      category: 'timeout',
      retryable: true,
    })
  })

  it('classifies model structured-output failures as retryable provider failures', () => {
    expect(classifyResearchError({ code: 'RESEARCH_MODEL_INVALID_OUTPUT', message: 'Expected valid JSON from brief_planning' })).toMatchObject({
      code: 'RESEARCH_MODEL_INVALID_OUTPUT',
      category: 'provider',
      retryable: true,
    })
    expect(classifyResearchError({ code: 'RESEARCH_MODEL_OUTPUT_LIMIT', message: 'Reached max output tokens' })).toMatchObject({
      code: 'RESEARCH_MODEL_OUTPUT_LIMIT',
      category: 'provider',
      retryable: true,
    })
    expect(classifyResearchError({ code: 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED', message: 'Structured output validation failed: - 7.intent: Required' })).toMatchObject({
      code: 'RESEARCH_MODEL_INVALID_OUTPUT',
      category: 'provider',
      retryable: true,
    })
  })

})
