import { z } from 'zod'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'

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

export class SkillRunConflictError extends Error {
  constructor(runId: string) {
    super(`Skill run revision conflict: ${runId}`)
    this.name = 'SkillRunConflictError'
  }
}

export class SkillRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Skill run not found: ${runId}`)
    this.name = 'SkillRunNotFoundError'
  }
}

export class SkillRunTransitionError extends Error {
  constructor(from: SkillRunStatus, to: SkillRunStatus) {
    super(`Invalid skill run transition: ${from} -> ${to}`)
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

export class SkillRunCoordinator {
  startRun(input: {
    skillVersionId: string
    input: Record<string, unknown>
    context: Record<string, unknown>
    surface?: string
    sessionId?: string
    imageSessionId?: string
  }): { runId: string } {
    const run = skillPackageRepo.createRun({
      skillVersionId: input.skillVersionId,
      status: 'created',
      input: input.input,
      context: input.context,
      surface: input.surface,
      sessionId: input.sessionId,
      imageSessionId: input.imageSessionId,
    })
    this.transition(run.id, 'validating', { expectedRevision: run.revision })
    return { runId: run.id }
  }

  getRun(runId: string): SkillRun {
    const run = skillPackageRepo.getRun(runId)
    if (!run) throw new SkillRunNotFoundError(runId)
    return mapRun(run)
  }

  subscribeEvents(runId: string, afterSeq = 0): SkillRunEvent[] {
    return skillPackageRepo.listEvents(runId)
      .filter((event) => event.seq > afterSeq)
      .map((event) => ({
        id: event.id,
        runId: event.run_id,
        seq: event.seq,
        schemaVersion: event.schema_version,
        type: event.type,
        payload: parseJsonObject(event.payload_json, 'event payload'),
        createdAt: event.created_at,
      }))
  }

  transition(runId: string, targetStatus: SkillRunStatus, data: {
    expectedRevision: number
    waitingReason?: string | null
    output?: Record<string, unknown> | null
    errorCode?: string | null
    errorMessage?: string | null
  }): SkillRun {
    const current = this.getRun(runId)
    if (!allowedTransitions[current.status].includes(targetStatus)) {
      throw new SkillRunTransitionError(current.status, targetStatus)
    }
    const now = Date.now()
    const result = skillPackageRepo.applyRunChange({
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
      event: {
        type: `run.${targetStatus}`,
        payload: { from: current.status, to: targetStatus, revision: data.expectedRevision + 1 },
      },
    })
    if (!result) throw new SkillRunConflictError(runId)
    return mapRun(result.run)
  }

  dispatchCommand(runId: string, command: SkillRunCommand): SkillRun {
    const parsed = commandSchema.parse(command)
    const previous = skillPackageRepo.getCommandResult(runId, parsed.idempotencyKey)
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
      }, 'run.input_modified')
    }
    if (terminalStatuses.has(current.status)) return current
    return this.applyCommandChange(runId, current, parsed, { cancelRequested: true }, 'run.cancel_requested')
  }

  resumeRun(runId: string, data: { expectedRevision: number }): SkillRun {
    return this.transition(runId, 'validating', data)
  }

  markInterruptedRuns(): number {
    let count = 0
    for (const run of skillPackageRepo.listRunsByStatus('running')) {
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
    const result = skillPackageRepo.applyRunChange({
      runId,
      expectedRevision: command.expectedRevision,
      changes: { status: targetStatus, waitingReason: null, ...changes },
      event: { type: 'run.confirmed', payload: { from: current.status, to: targetStatus, revision: command.expectedRevision + 1 } },
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
    const result = skillPackageRepo.applyRunChange({
      runId,
      expectedRevision: command.expectedRevision,
      changes,
      event: { type: eventType, payload: { revision: command.expectedRevision + 1 } },
      command: { idempotencyKey: command.idempotencyKey },
    })
    if (!result) throw new SkillRunConflictError(runId)
    return mapRun(result.run)
  }
}

function isWaiting(status: SkillRunStatus): boolean {
  return status === 'waiting_input' || status === 'waiting_approval'
}

function parseJsonObject(value: string, fieldName: string): Record<string, unknown> {
  const parsed = z.record(z.unknown()).safeParse(JSON.parse(value))
  if (!parsed.success) throw new Error(`Invalid ${fieldName}`)
  return parsed.data
}

function mapRun(row: ReturnType<typeof skillPackageRepo.getRun> & {}): SkillRun {
  if (!row) throw new Error('Run is required')
  return {
    id: row.id,
    skillVersionId: row.skill_version_id,
    status: runStatusSchema.parse(row.status),
    revision: row.revision,
    input: parseJsonObject(row.input_json, 'run input'),
    output: row.output_json === null ? null : parseJsonObject(row.output_json, 'run output'),
    context: parseJsonObject(row.context_json, 'run context'),
    surface: row.surface,
    sessionId: row.session_id,
    imageSessionId: row.image_session_id,
    waitingReason: row.waiting_reason,
    cancelRequested: row.cancel_requested === 1,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  }
}
