import { z } from 'zod'
import { createSqliteSkillRuntimePorts } from '../../db/repositories/skill-package.repo'
import { SkillDomainError } from '../application/errors'
import type { Clock, RunEventSnapshot, RunSnapshot, SkillRunEventRepository, SkillRunRepository, SkillRunStatus as PortSkillRunStatus } from '../application/ports'
import { normalizeSkillRunEvent } from './skill-run-events'

const runStatusSchema = z.enum([
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
])

export type SkillRunStatus = z.infer<typeof runStatusSchema>

const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm'), idempotencyKey: z.string().min(1), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal('modify'), idempotencyKey: z.string().min(1), expectedRevision: z.number().int().nonnegative(), patchInput: z.record(z.unknown()) }),
  z.object({ type: z.literal('cancel'), idempotencyKey: z.string().min(1), expectedRevision: z.number().int().nonnegative() }),
])

export type SkillRunCommand = z.infer<typeof commandSchema>

export type SkillRun = {
  id: string
  skillVersionId: string
  status: SkillRunStatus
  revision: number
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  context: Record<string, unknown>
  surface: string | null
  sessionId: string | null
  imageSessionId: string | null
  waitingReason: string | null
  cancelRequested: boolean
  startedAt: number | null
  updatedAt: number
  finishedAt: number | null
  errorCode: string | null
  errorMessage: string | null
}

export type SkillRunEvent = {
  id: string
  runId: string
  seq: number
  schemaVersion: number
  type: string
  payload: Record<string, unknown>
  createdAt: number
}

export class SkillRunConflictError extends SkillDomainError {
  constructor(runId: string) {
    super('REVISION_CONFLICT', `Skill run revision conflict: ${runId}`)
    this.name = 'SkillRunConflictError'
  }
}

export class SkillRunNotFoundError extends SkillDomainError {
  constructor(runId: string) {
    super('NOT_FOUND', `Skill run not found: ${runId}`)
    this.name = 'SkillRunNotFoundError'
  }
}

export class SkillRunTransitionError extends SkillDomainError {
  constructor(from: SkillRunStatus, to: SkillRunStatus) {
    super('INVALID_TRANSITION', `Invalid skill run transition: ${from} -> ${to}`)
    this.name = 'SkillRunTransitionError'
  }
}

const allowedTransitions: Record<SkillRunStatus, readonly SkillRunStatus[]> = {
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

const terminalStatuses = new Set<SkillRunStatus>(['completed', 'completed_with_errors', 'failed', 'cancelled'])

export type SkillRunCoordinatorDependencies = {
  runs: SkillRunRepository
  events: SkillRunEventRepository
  clock: Clock
}

export class SkillRunCoordinator {
  private readonly runs: SkillRunRepository
  private readonly events: SkillRunEventRepository
  private readonly clock: Clock

  constructor(dependencies: SkillRunCoordinatorDependencies = createDefaultDependencies()) {
    this.runs = dependencies.runs
    this.events = dependencies.events
    this.clock = dependencies.clock
  }

  startRun(input: {
    skillVersionId: string
    input: Record<string, unknown>
    context: Record<string, unknown>
    surface?: string
    sessionId?: string
    imageSessionId?: string
  }): { runId: string } {
    const run = this.runs.createRun({
      skillVersionId: input.skillVersionId,
      status: 'created',
      input: input.input,
      context: input.context,
      surface: input.surface,
      sessionId: input.sessionId,
      imageSessionId: input.imageSessionId,
    })
    this.events.appendEvent({
      runId: run.id,
      seq: 1,
      ...normalizeSkillRunEvent({ type: 'input.summarized', payload: inputSummary(input.input) }),
    })
    this.transition(run.id, 'validating', { expectedRevision: run.revision })
    return { runId: run.id }
  }

  getRun(runId: string): SkillRun {
    const run = this.runs.getRun(runId)
    if (!run) throw new SkillRunNotFoundError(runId)
    return mapRun(run)
  }

  subscribeEvents(runId: string, afterSeq = 0): SkillRunEvent[] {
    return this.events.listEvents(runId)
      .filter((event) => event.seq > afterSeq)
      .map(mapEvent)
  }

  transition(runId: string, targetStatus: SkillRunStatus, data: {
    expectedRevision: number
    waitingReason?: string | null
    approvalCapabilities?: string[]
    output?: Record<string, unknown> | null
    errorCode?: string | null
    errorMessage?: string | null
  }): SkillRun {
    const current = this.getRun(runId)
    if (!allowedTransitions[current.status].includes(targetStatus)) {
      throw new SkillRunTransitionError(current.status, targetStatus)
    }
    const now = this.clock.now()
    const result = this.runs.applyRunChange({
      runId,
      expectedRevision: data.expectedRevision,
      changes: {
        status: targetStatus,
        waitingReason: isWaiting(targetStatus) ? data.waitingReason ?? null : null,
        output: data.output,
        errorCode: data.errorCode ?? (targetStatus === 'failed' ? 'RUN_FAILED' : null),
        errorMessage: data.errorMessage ?? null,
        startedAt: targetStatus === 'running' && current.startedAt === null ? now : undefined,
        finishedAt: terminalStatuses.has(targetStatus) ? now : null,
      },
      event: normalizeSkillRunEvent(transitionEvent(current.status, targetStatus, data, data.expectedRevision + 1)),
    })
    if (!result) throw new SkillRunConflictError(runId)
    return mapRun(result.run)
  }

  dispatchCommand(runId: string, command: SkillRunCommand): SkillRun {
    const parsed = commandSchema.parse(command)
    const previous = this.runs.getCommandResult(runId, parsed.idempotencyKey)
    if (previous) return mapRun(previous)
    const current = this.getRun(runId)
    if (parsed.type === 'confirm') {
      return this.applyCommandTransition(runId, current, parsed, 'running', {})
    }
    if (parsed.type === 'modify') {
      if (current.status !== 'waiting_input') throw new SkillRunTransitionError(current.status, 'waiting_input')
      const input = { ...current.input, ...parsed.patchInput }
      return this.applyCommandChange(runId, current, parsed, {
        input,
        waitingReason: current.waitingReason,
      }, 'input.summarized')
    }
    if (terminalStatuses.has(current.status)) return current
    return this.applyCommandChange(runId, current, parsed, { cancelRequested: true }, 'run.cancel_requested')
  }

  resumeRun(runId: string, data: { expectedRevision: number }): SkillRun {
    return this.transition(runId, 'validating', data)
  }

  markInterruptedRuns(): number {
    let count = 0
    for (const run of this.runs.listRunsByStatus('running')) {
      this.transition(run.id, 'interrupted', { expectedRevision: run.revision, errorCode: 'PROCESS_INTERRUPTED' })
      count += 1
    }
    return count
  }

  private applyCommandTransition(
    runId: string,
    current: SkillRun,
    command: Extract<SkillRunCommand, { type: 'confirm' }>,
    targetStatus: SkillRunStatus,
    changes: Record<string, never>,
  ): SkillRun {
    if (current.status !== 'waiting_approval') throw new SkillRunTransitionError(current.status, targetStatus)
    const result = this.runs.applyRunChange({
      runId,
      expectedRevision: command.expectedRevision,
      changes: { status: targetStatus, waitingReason: null, ...changes },
      event: normalizeSkillRunEvent({
        type: 'run.status_changed',
        payload: { from: current.status, to: targetStatus, revision: command.expectedRevision + 1 },
      }),
      command: { idempotencyKey: command.idempotencyKey },
    })
    if (!result) throw new SkillRunConflictError(runId)
    return mapRun(result.run)
  }

  private applyCommandChange(
    runId: string,
    current: SkillRun,
    command: Exclude<SkillRunCommand, { type: 'confirm' }>,
    changes: { input?: Record<string, unknown>; waitingReason?: string | null; cancelRequested?: boolean },
    eventType: string,
  ): SkillRun {
    const result = this.runs.applyRunChange({
      runId,
      expectedRevision: command.expectedRevision,
      changes,
      event: normalizeSkillRunEvent(eventType === 'input.summarized'
        ? { type: eventType, payload: inputSummary(changes.input ?? {}) }
        : { type: eventType, payload: { revision: command.expectedRevision + 1 } }),
      command: { idempotencyKey: command.idempotencyKey },
    })
    if (!result) throw new SkillRunConflictError(runId)
    return mapRun(result.run)
  }
}

function createDefaultDependencies(): SkillRunCoordinatorDependencies {
  const ports = createSqliteSkillRuntimePorts()
  return { runs: ports.runs, events: ports.events, clock: ports.clock }
}

function isWaiting(status: SkillRunStatus): boolean {
  return status === 'waiting_input' || status === 'waiting_approval'
}

function transitionEvent(
  from: SkillRunStatus,
  to: SkillRunStatus,
  data: { waitingReason?: string | null; approvalCapabilities?: string[]; errorCode?: string | null; errorMessage?: string | null },
  revision: number,
): { type: string; payload: Record<string, unknown> } {
  if (to === 'completed') return { type: 'run.completed', payload: { revision } }
  if (to === 'completed_with_errors') return { type: 'run.completed_with_errors', payload: { revision } }
  if (to === 'waiting_approval') {
    return { type: 'approval.required', payload: { reason: data.waitingReason ?? 'Approval required', capabilities: data.approvalCapabilities ?? [] } }
  }
  if (to === 'failed') {
    return {
      type: 'run.failed',
      payload: { code: data.errorCode ?? 'RUN_FAILED', message: data.errorMessage ?? 'Skill run failed', revision },
    }
  }
  return { type: 'run.status_changed', payload: { from, to, revision } }
}

function inputSummary(input: Record<string, unknown>) {
  return { keys: Object.keys(input).sort(), byteLength: Buffer.byteLength(JSON.stringify(input), 'utf8') }
}

function mapRun(row: RunSnapshot): SkillRun {
  return {
    id: row.id,
    skillVersionId: row.skillVersionId,
    status: runStatusSchema.parse(row.status),
    revision: row.revision,
    input: row.input,
    output: row.output,
    context: row.context,
    surface: row.surface,
    sessionId: row.sessionId,
    imageSessionId: row.imageSessionId,
    waitingReason: row.waitingReason,
    cancelRequested: row.cancelRequested,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  }
}

function mapEvent(event: RunEventSnapshot): SkillRunEvent {
  return {
    id: event.id,
    runId: event.runId,
    seq: event.seq,
    schemaVersion: event.schemaVersion,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  }
}
