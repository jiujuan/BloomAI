import { describe, expect, it } from 'vitest'
import { assertResearchAttemptTransition, resolveResearchAttemptTransition } from './attempt-state'

describe('deep research attempt state machine', () => {
  it('allows an attempt to execute and succeed', () => {
    expect(() => assertResearchAttemptTransition('queued', 'running')).not.toThrow()
    expect(() => assertResearchAttemptTransition('running', 'succeeded')).not.toThrow()
  })

  it('does not allow a cancelling attempt to become failed or interrupted', () => {
    expect(() => assertResearchAttemptTransition('cancelling', 'failed')).toThrowError('RESEARCH_ATTEMPT_INVALID_TRANSITION')
    expect(() => assertResearchAttemptTransition('cancelling', 'interrupted')).toThrowError('RESEARCH_ATTEMPT_INVALID_TRANSITION')
  })

  it('gives cancellation precedence to racing attempt success and failure', () => {
    expect(resolveResearchAttemptTransition({ from: 'running', to: 'succeeded', cancellationRequested: true })).toBe('cancelled')
    expect(resolveResearchAttemptTransition({ from: 'running', to: 'failed', cancellationRequested: true })).toBe('cancelled')
  })
})
