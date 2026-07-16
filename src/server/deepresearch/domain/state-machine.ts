import type { ResearchRunStatus } from '@shared/deepresearch/contracts'
import { ResearchDomainError } from './errors'

const ACTIVE_STATUSES: readonly ResearchRunStatus[] = [
  'planning',
  'researching',
  'synthesizing',
  'verifying',
]

function freezeStatuses(...statuses: ResearchRunStatus[]): readonly ResearchRunStatus[] {
  return Object.freeze(statuses)
}

const TRANSITIONS: Readonly<Record<ResearchRunStatus, readonly ResearchRunStatus[]>> = Object.freeze({
  queued: freezeStatuses('planning', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  planning: freezeStatuses('researching', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  researching: freezeStatuses('synthesizing', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  synthesizing: freezeStatuses('verifying', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  verifying: freezeStatuses('completed', 'completed_with_limitations', 'awaiting_input', 'cancelling', 'cancelled', 'failed', 'interrupted'),
  completed: freezeStatuses(),
  completed_with_limitations: freezeStatuses(),
  awaiting_input: freezeStatuses(...ACTIVE_STATUSES, 'cancelling', 'cancelled', 'failed', 'interrupted'),
  cancelling: freezeStatuses('cancelled', 'failed', 'interrupted'),
  cancelled: freezeStatuses(),
  interrupted: freezeStatuses('queued', 'cancelling', 'cancelled', 'failed'),
  failed: freezeStatuses('queued'),
})

export function assertResearchTransition(from: ResearchRunStatus, to: ResearchRunStatus): void {
  if (TRANSITIONS[from].includes(to)) {
    return
  }

  throw new ResearchDomainError(
    'RESEARCH_INVALID_TRANSITION',
    'Cannot transition Deep Research Run from ' + from + ' to ' + to,
    false,
    { from, to },
  )
}
