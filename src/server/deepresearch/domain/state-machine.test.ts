import { describe, expect, it } from 'vitest'
import { ResearchDomainError } from './errors'
import { assertResearchTransition } from './state-machine'

describe('deep research state machine', () => {
  it('accepts valid transitions', () => {
    expect(() => assertResearchTransition('queued', 'planning')).not.toThrow()
    expect(() => assertResearchTransition('researching', 'synthesizing')).not.toThrow()
    expect(() => assertResearchTransition('failed', 'queued')).not.toThrow()
  })

  it('rejects terminal restarts with a stable domain error', () => {
    expect(() => assertResearchTransition('completed', 'planning')).toThrowError('RESEARCH_INVALID_TRANSITION')

    try {
      assertResearchTransition('completed', 'planning')
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchDomainError)
      expect(error).toMatchObject({
        code: 'RESEARCH_INVALID_TRANSITION',
        retryable: false,
      })
    }
  })
})
