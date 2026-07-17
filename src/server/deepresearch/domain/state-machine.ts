import type { ResearchCancellationDto, ResearchRunCapabilitiesDto, ResearchRunErrorDto, ResearchRunStatus } from '@shared/deepresearch/contracts'
import { ResearchDomainError } from './errors'

const ACTIVE_STATUSES: readonly ResearchRunStatus[] = [
  'planning',
  'researching',
  'assessing_coverage',
  'gap_filling',
  'synthesizing',
  'verifying',
]

function freezeStatuses(...statuses: ResearchRunStatus[]): readonly ResearchRunStatus[] {
  return Object.freeze(statuses)
}

const TRANSITIONS: Readonly<Record<ResearchRunStatus, readonly ResearchRunStatus[]>> = Object.freeze({
  queued: freezeStatuses('planning', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  planning: freezeStatuses('researching', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  researching: freezeStatuses('assessing_coverage', 'synthesizing', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  assessing_coverage: freezeStatuses('gap_filling', 'synthesizing', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  gap_filling: freezeStatuses('assessing_coverage', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  synthesizing: freezeStatuses('verifying', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  verifying: freezeStatuses('completed', 'completed_with_limitations', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  completed: freezeStatuses(),
  completed_with_limitations: freezeStatuses(),
  awaiting_input: freezeStatuses(...ACTIVE_STATUSES, 'cancelling', 'cancelled', 'failed', 'interrupted'),
  cancelling: freezeStatuses('cancelled'),
  cancelled: freezeStatuses(),
  interrupted: freezeStatuses('queued', 'cancelling', 'cancelled', 'failed'),
  failed: freezeStatuses('queued'),
})

export type ResearchRunTransitionInput = {
  from: ResearchRunStatus
  to: ResearchRunStatus
  error?: ResearchRunErrorDto | null
  cancellationRequested?: boolean
}

export function isResearchCancellationRequested(input: {
  status: ResearchRunStatus
  cancellation?: ResearchCancellationDto | null
  cancellationRequestedAt?: number | null
}): boolean {
  return input.status === 'cancelling' || input.status === 'cancelled' || input.cancellation?.requestedAt != null || input.cancellationRequestedAt != null
}

export function assertResearchTransition(from: ResearchRunStatus, to: ResearchRunStatus, options: Pick<ResearchRunTransitionInput, 'error'> = {}): void {
  if (from === to) return
  if (from === 'failed' && to === 'queued' && !options.error?.retryable) {
    throw new ResearchDomainError('RESEARCH_NOT_RESUMABLE', 'Only retryable failed Deep Research Runs can resume', false, { from, to })
  }
  if (TRANSITIONS[from].includes(to)) return

  throw new ResearchDomainError(
    'RESEARCH_INVALID_TRANSITION',
    'Cannot transition Deep Research Run from ' + from + ' to ' + to,
    false,
    { from, to },
  )
}

/** Resolves cancellation before completion or failure so racing writers cannot revive a cancelled Run. */
export function resolveResearchRunTransition(input: ResearchRunTransitionInput): ResearchRunStatus {
  let resolved = input.to
  if (input.cancellationRequested && input.from !== 'cancelled') {
    resolved = input.from === 'cancelling' || input.to === 'completed' || input.to === 'completed_with_limitations' || input.to === 'failed' || input.to === 'interrupted' || input.to === 'cancelled'
      ? 'cancelled'
      : 'cancelling'
  }
  assertResearchTransition(input.from, resolved, { error: input.error })
  return resolved
}

export function projectResearchRunCapabilities(input: Pick<ResearchRunTransitionInput, 'error'> & { status: ResearchRunStatus }): ResearchRunCapabilitiesDto {
  const canResume = input.status === 'interrupted' || (input.status === 'failed' && input.error?.retryable === true)
  return {
    canCancel: ACTIVE_STATUSES.includes(input.status) || input.status === 'queued' || input.status === 'awaiting_input' || input.status === 'interrupted',
    canResume,
    canRetry: input.status === 'failed' && input.error?.retryable === true,
    canProvideClarification: input.status === 'awaiting_input',
  }
}