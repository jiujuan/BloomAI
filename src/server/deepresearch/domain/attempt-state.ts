import type { ResearchAttemptStatus } from '@shared/deepresearch/contracts'
import { ResearchDomainError } from './errors'

function freezeStatuses(...statuses: ResearchAttemptStatus[]): readonly ResearchAttemptStatus[] {
  return Object.freeze(statuses)
}

const TRANSITIONS: Readonly<Record<ResearchAttemptStatus, readonly ResearchAttemptStatus[]>> = Object.freeze({
  queued: freezeStatuses('running', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  running: freezeStatuses('succeeded', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  cancelling: freezeStatuses('cancelled'),
  cancelled: freezeStatuses(),
  succeeded: freezeStatuses(),
  failed: freezeStatuses(),
  interrupted: freezeStatuses(),
})

export type ResearchAttemptTransitionInput = {
  from: ResearchAttemptStatus
  to: ResearchAttemptStatus
  cancellationRequested?: boolean
}

export function assertResearchAttemptTransition(from: ResearchAttemptStatus, to: ResearchAttemptStatus): void {
  if (from === to) return
  if (TRANSITIONS[from].includes(to)) return
  throw new ResearchDomainError(
    'RESEARCH_ATTEMPT_INVALID_TRANSITION',
    'Cannot transition Deep Research Attempt from ' + from + ' to ' + to,
    false,
    { from, to },
  )
}

export function resolveResearchAttemptTransition(input: ResearchAttemptTransitionInput): ResearchAttemptStatus {
  const resolved = input.cancellationRequested && input.from !== 'cancelled'
    ? (input.from === 'cancelling' || ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(input.to) ? 'cancelled' : 'cancelling')
    : input.to
  assertResearchAttemptTransition(input.from, resolved)
  return resolved
}