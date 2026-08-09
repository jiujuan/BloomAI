import { z } from 'zod'
import { createSqliteSkillRuntimePorts } from '../../db/repositories/skill-package.repo'
import { SkillDomainError } from '../application/errors'
import type { SkillRuntimeMetrics } from '../observability/skill-runtime.metrics'
import type { Clock, JsonObject, RunEventSnapshot, RunSnapshot, SkillRunEventRepository, SkillRunQueueRepository, SkillRunRepository } from '../application/ports'
import { normalizeSkillRunEvent } from './skill-run-events'
import {
  canTransition,
  defaultTransitionReason,
  isResumableStatus,
  isTerminalStatus,
  isWaitingStatus,
  resumeTargetFor,
  type SkillRunTransitionReason,
} from './skill-run-state-machine'

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
  z.object({ type: z.literal('approve'), idempotencyKey: z.string().min(1), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal('reject'), idempotencyKey: z.string().min(1), expectedRevision: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(500).optional() }),
  z.object({ type: z.literal('resume'), idempotencyKey: z.string().min(1), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal('retry'), idempotencyKey: z.string().min(1), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal('submit_input'), idempotencyKey: z.string().min(1), expectedRevision: z.number().int().nonnegative(), input: z.record(z.unknown()) }),
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
  waitingSince: number | null
  waitingExpiresAt: number | null
  cancelRequested: boolean
  cancelRequestedAt: number | null
  interruptedAt: number | null
  cancelReason: string | null
  lastCheckpoint: Record<string, unknown> | null
  startedAt: number | null
  updatedAt: number
  finishedAt: number | null
  errorCode: string | null
  errorMessage: string | null
  currentStep: string | null
  requiredAction: Record<string, unknown> | null
  workerId: string | null
  heartbeatAt: number | null
  executionMode: string
  stepCount: number
  tokenUsage: number
  lastHeartbeatAt: number | null
  resultSummary: string | null
}

export type SkillRunEvent = {
  id: string
  runId: string
  seq: number
  schemaVersion: number
  producer: string
  type: string
  payload: Record<string, unknown>
  occurredAt: number
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

export class SkillRunWaitingActionExpiredError extends SkillDomainError {
  constructor(runId: string) {
    super('WAITING_ACTION_EXPIRED', `Waiting action expired: ${runId}`)
    this.name = 'SkillRunWaitingActionExpiredError'
  }
}

export type SkillRunCoordinatorDependencies = {
  runs: SkillRunRepository
  events: SkillRunEventRepository
  clock: Clock
  queue?: SkillRunQueueRepository
  metrics?: SkillRuntimeMetrics
}

export class SkillRunCoordinator {
  private readonly runs: SkillRunRepository
  private readonly events: SkillRunEventRepository
  private readonly clock: Clock
  private readonly queue?: SkillRunQueueRepository
  private readonly metrics?: SkillRuntimeMetrics

  constructor(dependencies: SkillRunCoordinatorDependencies = createDefaultDependencies()) {
    this.runs = dependencies.runs
    this.events = dependencies.events
    this.clock = dependencies.clock
    this.queue = dependencies.queue
    this.metrics = dependencies.metrics
  }

  startRun(input: {
    skillVersionId: string
    input: Record<string, unknown>
    context: Record<string, unknown>
    surface?: string
    sessionId?: string
    imageSessionId?: string
  }): { runId: string } {
    const initialEvent = normalizeSkillRunEvent({ type: 'input.summarized', payload: inputSummary(input.input), occurredAt: this.clock.now() })
    const created = this.runs.createRunAndEnqueue && this.queue
      ? this.runs.createRunAndEnqueue({
        skillVersionId: input.skillVersionId,
        status: 'created',
        input: input.input,
        context: input.context,
        surface: input.surface,
        sessionId: input.sessionId,
        imageSessionId: input.imageSessionId,
        availableAt: this.clock.now(),
        initialEvent,
      })
      : undefined
    const run = created?.run ?? this.runs.createRun({
      skillVersionId: input.skillVersionId,
      status: 'created',
      input: input.input,
      context: input.context,
      surface: input.surface,
      sessionId: input.sessionId,
      imageSessionId: input.imageSessionId,
    })
    if (!created) {
      if (this.queue) this.queue.enqueue({ runId: run.id, availableAt: this.clock.now() })
      this.events.appendEvent({ runId: run.id, seq: 1, ...initialEvent })
    }
    this.transition(run.id, 'validating', { expectedRevision: run.revision, reason: 'validation_started' })
    return { runId: run.id }
  }

  getRun(runId: string): SkillRun {
    const run = this.runs.getRun(runId)
    if (!run) throw new SkillRunNotFoundError(runId)
    return mapRun(run)
  }

  subscribeEvents(runId: string, afterSeq = 0): SkillRunEvent[] {
    return this.events.listEvents(runId, { afterSeq })
      .filter((event) => event.seq > afterSeq)
      .map(mapEvent)
  }

  transition(runId: string, targetStatus: SkillRunStatus, data: {
    expectedRevision: number
    reason?: SkillRunTransitionReason
    metadata?: JsonObject
    waitingReason?: string | null
    approvalCapabilities?: string[]
    output?: Record<string, unknown> | null
    errorCode?: string | null
    errorMessage?: string | null
    currentStep?: string | null
    requiredAction?: JsonObject | null
    cancelReason?: string | null
    lastCheckpoint?: JsonObject | null
  }): SkillRun {
    const current = this.getRun(runId)
    if (!canTransition(current.status, targetStatus)) {
      throw new SkillRunTransitionError(current.status, targetStatus)
    }
    const now = this.clock.now()
    const approvalWaitMs = current.status === 'waiting_approval' && targetStatus !== 'waiting_approval' && current.waitingSince !== null
      ? Math.max(0, now - current.waitingSince)
      : 0
    const waitingReason = isWaitingStatus(targetStatus) ? data.waitingReason ?? null : null
    const requiredAction = data.requiredAction === undefined
      ? defaultRequiredAction(targetStatus, waitingReason, data.approvalCapabilities)
      : sanitizeRequiredAction(data.requiredAction)
    const waitingSince = isWaitingStatus(targetStatus) ? now : null
    const waitingExpiresAt = isWaitingStatus(targetStatus) ? actionExpiresAt(requiredAction) : null
    const event = transitionEvent(current.status, targetStatus, {
      waitingReason,
      approvalCapabilities: data.approvalCapabilities,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      reason: data.reason ?? defaultTransitionReason(current.status, targetStatus),
      metadata: data.metadata,
    }, data.expectedRevision + 1)
    const result = this.runs.applyRunChange({
      runId,
      expectedRevision: data.expectedRevision,
      changes: {
        status: targetStatus,
        waitingReason,
        waitingSince,
        waitingExpiresAt,
        requiredAction,
        currentStep: data.currentStep === undefined ? current.currentStep : data.currentStep,
        output: data.output,
        errorCode: data.errorCode ?? (targetStatus === 'failed' ? 'RUN_FAILED' : null),
        errorMessage: data.errorMessage ?? null,
        startedAt: targetStatus === 'running' && current.startedAt === null ? now : undefined,
        finishedAt: isTerminalStatus(targetStatus) ? now : null,
        interruptedAt: targetStatus === 'interrupted' ? now : null,
        cancelReason: data.cancelReason ?? (targetStatus === 'cancelled' ? 'user_cancelled' : undefined),
        lastCheckpoint: data.lastCheckpoint,
      },
      event: { ...event, occurredAt: now },
    })
    if (!result) throw new SkillRunConflictError(runId)
    if (approvalWaitMs > 0) {
      this.metrics?.recordApprovalWait(approvalWaitMs, { runId, skillVersionId: current.skillVersionId })
    }
    return mapRun(result.run)
  }

  dispatchCommand(runId: string, command: SkillRunCommand): SkillRun {
    const current = this.getRun(runId)
    const parsed = commandSchema.parse(command)
    const previous = this.runs.getCommandResult(runId, parsed.idempotencyKey)
    if (previous) return mapRun(previous)

    if (isWaitingStatus(current.status) && parsed.type !== 'cancel' && isWaitingActionExpired(current, this.clock.now())) {
      this.transition(runId, 'failed', {
        expectedRevision: current.revision,
        reason: 'system',
        errorCode: 'WAITING_ACTION_EXPIRED',
        errorMessage: 'Waiting action expired',
      })
      throw new SkillRunWaitingActionExpiredError(runId)
    }

    if (parsed.type === 'confirm' || parsed.type === 'approve') {
      if (current.status !== 'waiting_approval') throw new SkillRunTransitionError(current.status, 'running')
      return this.applyCommandTransition(runId, current, parsed, 'running', {})
    }
    if (parsed.type === 'reject') {
      if (current.status !== 'waiting_approval') throw new SkillRunTransitionError(current.status, 'failed')
      return this.applyCommandTransition(runId, current, parsed, 'failed', {
        errorCode: 'CAPABILITY_REJECTED',
        errorMessage: parsed.reason ?? 'Capability approval rejected',
      })
    }
    if (parsed.type === 'resume') {
      if (!isResumableStatus(current.status)) throw new SkillRunTransitionError(current.status, current.status)
      return this.applyCommandTransition(runId, current, parsed, resumeTargetFor(current.status), {})
    }
    if (parsed.type === 'retry') {
      if (current.status !== 'interrupted') throw new SkillRunTransitionError(current.status, 'validating')
      return this.applyCommandTransition(runId, current, parsed, 'validating', {})
    }
    if (parsed.type === 'submit_input') {
      if (current.status !== 'waiting_input') throw new SkillRunTransitionError(current.status, 'running')
      return this.applyCommandTransition(runId, current, parsed, 'running', {
        input: { ...current.input, ...parsed.input },
      })
    }
    if (parsed.type === 'modify') {
      if (current.status !== 'waiting_input') throw new SkillRunTransitionError(current.status, 'waiting_input')
      const input = { ...current.input, ...parsed.patchInput }
      return this.applyCommandChange(runId, current, parsed, {
        input,
        waitingReason: current.waitingReason,
        waitingSince: current.waitingSince,
        waitingExpiresAt: current.waitingExpiresAt,
        requiredAction: current.requiredAction,
      }, 'input.summarized')
    }
    if (isTerminalStatus(current.status)) return current
    if (isWaitingStatus(current.status)) {
      return this.applyCommandTransition(runId, current, parsed, 'cancelled', {
        errorCode: 'RUN_CANCELLED',
        errorMessage: 'Run cancelled by user',
      })
    }
    return this.applyCommandChange(runId, current, parsed, {
      cancelRequested: true,
      cancelRequestedAt: this.clock.now(),
      cancelReason: 'user_cancelled',
    }, 'run.cancel_requested')
  }

  getNextAction(runId: string): { runId: string; status: SkillRunStatus; action: Record<string, unknown> | null; expiresAt: number | null } {
    const run = this.getRun(runId)
    return {
      runId: run.id,
      status: run.status,
      action: run.requiredAction,
      expiresAt: run.waitingExpiresAt,
    }
  }

  requestCancel(runId: string, data: { expectedRevision: number; idempotencyKey: string; reason?: string }): SkillRun {
    const current = this.getRun(runId)
    if (isTerminalStatus(current.status)) return current
    const command: SkillRunCommand = { type: 'cancel', idempotencyKey: data.idempotencyKey, expectedRevision: data.expectedRevision }
    const existing = this.runs.getCommandResult(runId, data.idempotencyKey)
    if (existing) return mapRun(existing)
    if (isWaitingStatus(current.status)) {
      return this.transition(runId, 'cancelled', {
        expectedRevision: data.expectedRevision,
        reason: 'cancel_requested',
        errorCode: 'RUN_CANCELLED',
        errorMessage: data.reason ?? 'Run cancelled by user',
        cancelReason: data.reason ?? 'user_cancelled',
      })
    }
    return this.dispatchCommand(runId, command)
  }

  resumeRun(runId: string, data: { expectedRevision: number; targetStatus?: SkillRunStatus }): SkillRun {
    const current = this.getRun(runId)
    if (!isResumableStatus(current.status)) throw new SkillRunTransitionError(current.status, data.targetStatus ?? 'validating')
    const targetStatus = data.targetStatus ?? resumeTargetFor(current.status)
    return this.transition(runId, targetStatus, { expectedRevision: data.expectedRevision, reason: 'recovered' })
  }

  markInterruptedRuns(options: { now?: number; staleAfterMs?: number } = {}): number {
    let count = 0
    const now = options.now ?? this.clock.now()
    const staleAfterMs = options.staleAfterMs ?? 0
    for (const status of ['validating', 'running'] as const) {
      for (const run of this.runs.listRunsByStatus(status)) {
        const heartbeat = run.lastHeartbeatAt ?? run.heartbeatAt ?? run.updatedAt
        if (now - heartbeat < staleAfterMs) continue
        try {
          this.transition(run.id, 'interrupted', {
            expectedRevision: run.revision,
            errorCode: 'PROCESS_INTERRUPTED',
            errorMessage: 'Run interrupted while the worker was unavailable',
            reason: 'process_interrupted',
            cancelReason: 'process_crash',
          })
          this.enqueueIfInactive(run.id)
          count += 1
        } catch (error) {
          if (!(error instanceof SkillRunConflictError)) throw error
        }
      }
    }
    return count
  }

  private applyCommandTransition(
    runId: string,
    current: SkillRun,
    command: Extract<SkillRunCommand, { type: 'confirm' | 'approve' | 'reject' | 'resume' | 'retry' | 'submit_input' | 'cancel' }>,
    targetStatus: SkillRunStatus,
    changes: Record<string, unknown>,
  ): SkillRun {
    if (!canTransition(current.status, targetStatus)) throw new SkillRunTransitionError(current.status, targetStatus)
    const now = this.clock.now()
    const approvalWaitMs = current.status === 'waiting_approval' && targetStatus !== 'waiting_approval' && current.waitingSince !== null
      ? Math.max(0, now - current.waitingSince)
      : 0
    const result = this.runs.applyRunChange({
      runId,
      expectedRevision: command.expectedRevision,
      changes: {
        status: targetStatus,
        input: changes.input as Record<string, unknown> | undefined,
        waitingReason: null,
        waitingSince: null,
        waitingExpiresAt: null,
        requiredAction: null,
        startedAt: targetStatus === 'running' && current.startedAt === null ? now : undefined,
        finishedAt: isTerminalStatus(targetStatus) ? now : null,
        errorCode: targetStatus === 'failed' ? (changes.errorCode as string ?? 'RUN_FAILED') : targetStatus === 'cancelled' ? (changes.errorCode as string ?? 'RUN_CANCELLED') : null,
        errorMessage: targetStatus === 'failed' || targetStatus === 'cancelled' ? (changes.errorMessage as string ?? null) : null,
        cancelReason: targetStatus === 'cancelled' ? 'user_cancelled' : undefined,
      },
      event: normalizeSkillRunEvent({
        type: targetStatus === 'failed' ? 'run.failed' : targetStatus === 'cancelled' ? 'run.cancelled' : 'run.status_changed',
        occurredAt: now,
        payload: {
          from: current.status,
          to: targetStatus,
          revision: command.expectedRevision + 1,
          reason: command.type,
          ...(targetStatus === 'failed' ? { code: changes.errorCode ?? 'RUN_FAILED' } : {}),
        },
      }),
      command: { idempotencyKey: command.idempotencyKey },
    })
    if (!result) throw new SkillRunConflictError(runId)
    if (!result.duplicate && approvalWaitMs > 0) {
      this.metrics?.recordApprovalWait(approvalWaitMs, { runId, skillVersionId: current.skillVersionId })
    }
    const next = mapRun(result.run)
    if (!result.duplicate && isWaitingStatus(current.status) && (targetStatus === 'running' || targetStatus === 'validating')) {
      this.enqueueIfInactive(runId)
    }
    return next
  }

  private enqueueIfInactive(runId: string): void {
    if (!this.queue) return
    const active = this.queue.list({ runId }).some((item) => ['queued', 'leased', 'retry_wait'].includes(item.status))
    if (!active) this.queue.enqueue({ runId, availableAt: this.clock.now() })
  }

  updateExecutionMetrics(runId: string, expectedRevision: number, usage: { stepCount: number; tokenUsage: number; lastHeartbeatAt: number }): SkillRun {
    const result = this.runs.applyRunChange({
      runId,
      expectedRevision,
      changes: { stepCount: usage.stepCount, tokenUsage: usage.tokenUsage, lastHeartbeatAt: usage.lastHeartbeatAt, heartbeatAt: usage.lastHeartbeatAt },
      event: normalizeSkillRunEvent({ type: 'run.heartbeat', payload: { stepCount: usage.stepCount, tokenUsage: usage.tokenUsage }, occurredAt: this.clock.now() }),
    })
    if (!result) throw new SkillRunConflictError(runId)
    return mapRun(result.run)
  }

  private applyCommandChange(
    runId: string,
    current: SkillRun,
    command: Extract<SkillRunCommand, { type: 'modify' | 'cancel' }>,
    changes: { input?: Record<string, unknown>; waitingReason?: string | null; waitingSince?: number | null; waitingExpiresAt?: number | null; requiredAction?: JsonObject | null; cancelRequested?: boolean; cancelRequestedAt?: number; cancelReason?: string | null; lastCheckpoint?: JsonObject | null },
    eventType: string,
  ): SkillRun {
    const result = this.runs.applyRunChange({
      runId,
      expectedRevision: command.expectedRevision,
      changes,
      event: normalizeSkillRunEvent(eventType === 'input.summarized'
        ? { type: eventType, payload: inputSummary(changes.input ?? {}), occurredAt: this.clock.now() }
        : { type: eventType, payload: { revision: command.expectedRevision + 1 }, occurredAt: this.clock.now() }),
      command: { idempotencyKey: command.idempotencyKey },
    })
    if (!result) throw new SkillRunConflictError(runId)
    return mapRun(result.run)
  }
}

function createDefaultDependencies(): SkillRunCoordinatorDependencies {
  const ports = createSqliteSkillRuntimePorts()
  return { runs: ports.runs, events: ports.events, clock: ports.clock, queue: ports.queue }
}

function defaultRequiredAction(status: SkillRunStatus, waitingReason: string | null, capabilities?: string[]): JsonObject | null {
  if (status === 'waiting_input') return { type: 'input', reason: waitingReason ?? 'Input required' }
  if (status === 'waiting_approval') return { type: 'approval', reason: waitingReason ?? 'Approval required', capabilities: capabilities ?? [] }
  return null
}

const REQUIRED_ACTION_KEYS = new Set(['type', 'capability', 'capabilities', 'grantId', 'prompt', 'promptSchema', 'expiresAt', 'reason'])

function sanitizeRequiredAction(action: JsonObject | null): JsonObject | null {
  if (!action) return null
  const safe: JsonObject = {}
  for (const key of REQUIRED_ACTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(action, key)) safe[key] = action[key]
  }
  return Object.keys(safe).length > 0 ? safe : null
}

function actionExpiresAt(action: JsonObject | null): number | null {
  return typeof action?.expiresAt === 'number' && Number.isFinite(action.expiresAt) ? action.expiresAt : null
}

function isWaitingActionExpired(run: SkillRun, now: number): boolean {
  return run.waitingExpiresAt !== null && run.waitingExpiresAt <= now
}

function transitionEvent(
  from: SkillRunStatus,
  to: SkillRunStatus,
  data: { waitingReason?: string | null; approvalCapabilities?: string[]; errorCode?: string | null; errorMessage?: string | null; reason: SkillRunTransitionReason; metadata?: JsonObject },
  revision: number,
): { schemaVersion: number; type: string; payload: Record<string, unknown> } {
  const base = { from, to, revision, reason: data.reason, ...(data.metadata ? { metadata: data.metadata } : {}) }
  if (to === 'completed') return { schemaVersion: 1, type: 'run.completed', payload: base }
  if (to === 'completed_with_errors') return { schemaVersion: 1, type: 'run.completed_with_errors', payload: base }
  if (to === 'waiting_approval') return { schemaVersion: 1, type: 'approval.required', payload: { ...base, reason: data.waitingReason ?? 'Approval required', capabilities: data.approvalCapabilities ?? [] } }
  if (to === 'failed') return { schemaVersion: 1, type: 'run.failed', payload: { ...base, code: data.errorCode ?? 'RUN_FAILED', message: data.errorMessage ?? 'Skill run failed' } }
  if (to === 'cancelled') return { schemaVersion: 1, type: 'run.cancelled', payload: base }
  if (to === 'interrupted') return { schemaVersion: 1, type: 'run.interrupted', payload: base }
  return { schemaVersion: 1, type: 'run.status_changed', payload: base }
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
    waitingSince: row.waitingSince,
    waitingExpiresAt: row.waitingExpiresAt,
    cancelRequested: row.cancelRequested,
    cancelRequestedAt: row.cancelRequestedAt,
    interruptedAt: row.interruptedAt,
    cancelReason: row.cancelReason,
    lastCheckpoint: row.lastCheckpoint,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    currentStep: row.currentStep,
    requiredAction: row.requiredAction,
    workerId: row.workerId,
    heartbeatAt: row.heartbeatAt,
    executionMode: row.executionMode,
    stepCount: row.stepCount,
    tokenUsage: row.tokenUsage,
    lastHeartbeatAt: row.lastHeartbeatAt,
    resultSummary: row.resultSummary,
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
    producer: event.producer,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
  }
}