import { describe, expect, it } from 'vitest'
import {
  SKILL_RUN_STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
  defaultTransitionReason,
  isResumableStatus,
  isTerminalStatus,
  isWaitingStatus,
  resumeTargetFor,
} from './skill-run-state-machine'

describe('skill run state machine', () => {
  it('exposes the complete state set and legal transition matrix', () => {
    expect(SKILL_RUN_STATUSES).toHaveLength(10)
    expect(allowedTransitions('created')).toEqual(['validating', 'cancelled'])
    expect(allowedTransitions('running')).toContain('interrupted')
    expect(allowedTransitions('completed')).toEqual([])
  })

  it('rejects invalid transitions and protects terminal states', () => {
    expect(canTransition('created', 'running')).toBe(false)
    expect(canTransition('completed', 'running')).toBe(false)
    expect(() => assertTransition('failed', 'running')).toThrow('Invalid skill run transition')
    expect(isTerminalStatus('completed')).toBe(true)
    expect(isTerminalStatus('interrupted')).toBe(false)
  })

  it('identifies waiting and resumable states', () => {
    expect(isWaitingStatus('waiting_input')).toBe(true)
    expect(isWaitingStatus('running')).toBe(false)
    expect(isResumableStatus('interrupted')).toBe(true)
    expect(isResumableStatus('completed')).toBe(false)
    expect(resumeTargetFor('interrupted')).toBe('validating')
    expect(resumeTargetFor('waiting_input')).toBe('running')
    expect(() => resumeTargetFor('completed')).toThrow('not resumable')
  })

  it('provides stable reasons for audit/event consumers', () => {
    expect(defaultTransitionReason('created', 'validating')).toBe('validation_started')
    expect(defaultTransitionReason('interrupted', 'validating')).toBe('recovered')
    expect(defaultTransitionReason('running', 'completed')).toBe('execution_completed')
  })
})