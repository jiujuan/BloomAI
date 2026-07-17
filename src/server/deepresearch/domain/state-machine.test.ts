import { describe, expect, it } from 'vitest'
import { ResearchDomainError } from './errors'
import {
  assertResearchTransition,
  projectResearchRunCapabilities,
  resolveResearchRunTransition,
} from './state-machine'

describe('deep research state machine', () => {
  it('accepts valid transitions', () => {
    expect(() => assertResearchTransition('queued', 'planning')).not.toThrow()
    expect(() => assertResearchTransition('researching', 'synthesizing')).not.toThrow()
    expect(() => assertResearchTransition('failed', 'queued', { error: { code: 'RESEARCH_PROVIDER_TIMEOUT', message: 'Timed out', retryable: true } })).not.toThrow()
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

  it('rejects resume from a non-retryable failed Run', () => {
    expect(() => assertResearchTransition('failed', 'queued', {
      error: { code: 'RESEARCH_VALIDATION_ERROR', message: 'Invalid input', retryable: false },
    })).toThrowError('RESEARCH_NOT_RESUMABLE')
  })

  it('gives cancellation precedence over concurrent completion and failure', () => {
    expect(resolveResearchRunTransition({
      from: 'verifying',
      to: 'completed',
      cancellationRequested: true,
    })).toBe('cancelled')

    expect(resolveResearchRunTransition({
      from: 'researching',
      to: 'failed',
      cancellationRequested: true,
      error: { code: 'RESEARCH_PROVIDER_TIMEOUT', message: 'Timed out', retryable: true },
    })).toBe('cancelled')
  })

  it('moves active work to cancelling first when cancellation is requested before a normal phase transition', () => {
    expect(resolveResearchRunTransition({
      from: 'researching',
      to: 'synthesizing',
      cancellationRequested: true,
    })).toBe('cancelling')
  })

  it('projects server-authoritative action capabilities', () => {
    expect(projectResearchRunCapabilities({ status: 'cancelled', error: null })).toEqual({
      canCancel: false,
      canResume: false,
      canRetry: false,
      canProvideClarification: false,
    })
    expect(projectResearchRunCapabilities({
      status: 'failed',
      error: { code: 'RESEARCH_PROVIDER_TIMEOUT', message: 'Timed out', retryable: true },
    })).toEqual({
      canCancel: false,
      canResume: true,
      canRetry: true,
      canProvideClarification: false,
    })
    expect(projectResearchRunCapabilities({ status: 'interrupted', error: null })).toEqual({
      canCancel: true,
      canResume: true,
      canRetry: false,
      canProvideClarification: false,
    })
    expect(projectResearchRunCapabilities({ status: 'awaiting_input', error: null })).toEqual({
      canCancel: true,
      canResume: false,
      canRetry: false,
      canProvideClarification: true,
    })
  })
})
