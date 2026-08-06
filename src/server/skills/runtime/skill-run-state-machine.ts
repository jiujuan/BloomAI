import type { SkillRunStatus } from '../application/ports'

export const SKILL_RUN_STATUSES = [
  'created',
  'validating',
  'running',
  'waiting_input',
  'waiting_approval',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'interrupted',
] as const

export type SkillRunState = SkillRunStatus

const TRANSITIONS: Readonly<Record<SkillRunStatus, readonly SkillRunStatus[]>> = {
  created: ['validating', 'cancelled'],
  validating: ['running', 'waiting_input', 'waiting_approval', 'failed', 'cancelled', 'interrupted'],
  running: ['waiting_input', 'waiting_approval', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'],
  waiting_input: ['running', 'cancelled', 'failed', 'interrupted'],
  waiting_approval: ['running', 'cancelled', 'failed', 'interrupted'],
  completed: [],
  completed_with_errors: [],
  failed: [],
  cancelled: [],
  interrupted: ['validating', 'cancelled'],
}

const TERMINAL_STATES = new Set<SkillRunStatus>(['completed', 'completed_with_errors', 'failed', 'cancelled'])
const WAITING_STATES = new Set<SkillRunStatus>(['waiting_input', 'waiting_approval'])

export type SkillRunTransitionReason =
  | 'created'
  | 'validation_started'
  | 'execution_started'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'execution_completed'
  | 'execution_completed_with_errors'
  | 'execution_failed'
  | 'cancel_requested'
  | 'process_interrupted'
  | 'recovered'
  | 'user_command'
  | 'system'

export function canTransition(from: SkillRunStatus, to: SkillRunStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function allowedTransitions(from: SkillRunStatus): readonly SkillRunStatus[] {
  return TRANSITIONS[from]
}

export function isTerminalStatus(status: SkillRunStatus): boolean {
  return TERMINAL_STATES.has(status)
}

export function isWaitingStatus(status: SkillRunStatus): boolean {
  return WAITING_STATES.has(status)
}

export function isResumableStatus(status: SkillRunStatus): boolean {
  return status === 'interrupted' || isWaitingStatus(status)
}

export function assertTransition(from: SkillRunStatus, to: SkillRunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid skill run transition: ${from} -> ${to}`)
  }
}

export function defaultTransitionReason(from: SkillRunStatus, to: SkillRunStatus): SkillRunTransitionReason {
  if (to === 'validating') return from === 'interrupted' ? 'recovered' : 'validation_started'
  if (to === 'running') return 'execution_started'
  if (to === 'waiting_input') return 'awaiting_input'
  if (to === 'waiting_approval') return 'awaiting_approval'
  if (to === 'completed') return 'execution_completed'
  if (to === 'completed_with_errors') return 'execution_completed_with_errors'
  if (to === 'failed') return 'execution_failed'
  if (to === 'cancelled') return 'cancel_requested'
  if (to === 'interrupted') return 'process_interrupted'
  return 'system'
}

export function resumeTargetFor(status: SkillRunStatus): SkillRunStatus {
  if (status === 'interrupted') return 'validating'
  if (status === 'waiting_input' || status === 'waiting_approval') return 'running'
  throw new Error(`Run status is not resumable: ${status}`)
}