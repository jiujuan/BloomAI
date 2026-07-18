import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ResearchAttemptStatus, ResearchAttemptTrigger, ResearchCheckpointCursorDto, ResearchCheckpointReplayPolicy, ResearchCheckpointStatus, ResearchRunAttemptDto, ResearchRunCheckpointDto, ResearchRunDto, ResearchRunErrorDto, ResearchRunStatus } from '@shared/deepresearch/contracts'
import type { AppendResearchEventInput } from './research-event.repo'
import { getOrmDb } from '../../client'
import { publishResearchEvent } from '@server/deepresearch/research-event-publisher'
import { assertResearchTransition } from '@server/deepresearch/domain/state-machine'
import { research_run_attempts, research_run_checkpoints, research_runs } from '../../schema'
import { mapRun } from './research-run.repo'
import { appendResearchEventInTransaction } from './research-event.repo'
import { mapResearchCheckpoint } from './research-checkpoint.repo'
import { encodeJson } from './repository-utils'

type TransactionExecutor = any

export interface CreateResearchAttemptInput {
  runId: string
  trigger: ResearchAttemptTrigger
  status?: ResearchAttemptStatus
  workflowRunId?: string | null
  startCheckpointKey?: string | null
  createdAt?: number
}

export interface CreateResearchAttemptWithInitialCheckpointInput {
  runId: string
  trigger: ResearchAttemptTrigger
  workflowRunId?: string | null
  createdAt?: number
  checkpoint: {
    checkpointKey: string
    phase: string
    status: ResearchCheckpointStatus
    resumeCursor: ResearchCheckpointCursorDto
    inputFingerprint: string
    outputFingerprint?: string | null
    replayPolicy: ResearchCheckpointReplayPolicy
  }
}

export interface EndResearchAttemptInput {
  attemptId: string
  status: Extract<ResearchAttemptStatus, 'cancelled' | 'succeeded' | 'failed' | 'interrupted'>
  endCheckpointKey?: string | null
  error?: ResearchRunErrorDto | null
  endedAt?: number
  event?: Omit<AppendResearchEventInput, 'runId'>
}

export interface InterruptExpiredResearchAttemptInput {
  attemptId: string
  now?: number
}

export interface FinishOwnedResearchAttemptInput {
  attemptId: string
  executorId: string
  ownershipToken: string
  status: Extract<ResearchAttemptStatus, 'cancelled' | 'succeeded' | 'failed' | 'interrupted'>
  endCheckpointKey?: string | null
  error?: ResearchRunErrorDto | null
  now?: number
}

function mapAttempt(row: typeof research_run_attempts.$inferSelect): ResearchRunAttemptDto {
  const error = row.error_code
    ? {
      code: row.error_code,
      message: row.error_message ?? row.error_code,
      retryable: Boolean(row.error_retryable),
      ...(row.error_category ? { category: row.error_category as ResearchRunErrorDto['category'] } : {}),
    }
    : null

  return {
    id: row.id,
    runId: row.run_id,
    ordinal: row.ordinal,
    trigger: row.trigger as ResearchAttemptTrigger,
    status: row.status as ResearchAttemptStatus,
    workflowRunId: row.workflow_run_id,
    executorId: row.executor_id,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    startCheckpointKey: row.start_checkpoint_key,
    endCheckpointKey: row.end_checkpoint_key,
    error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  }
}

function nextOrdinal(executor: TransactionExecutor, runId: string): number {
  const current = executor
    .select({ ordinal: sql<number>`coalesce(max(${research_run_attempts.ordinal}), 0)` })
    .from(research_run_attempts)
    .where(eq(research_run_attempts.run_id, runId))
    .get()
  return Number(current?.ordinal ?? 0) + 1
}

function ownedAttempt(executor: TransactionExecutor, input: Pick<FinishOwnedResearchAttemptInput, 'attemptId' | 'executorId' | 'ownershipToken'>, now: number) {
  if (!input.ownershipToken) return undefined
  return executor.select().from(research_run_attempts).where(and(
    eq(research_run_attempts.id, input.attemptId),
    eq(research_run_attempts.executor_id, input.executorId),
    eq(research_run_attempts.ownership_token, input.ownershipToken),
    inArray(research_run_attempts.status, ['running', 'cancelling']),
    gt(research_run_attempts.lease_expires_at, now),
  )).get()
}

function appendAttemptEvent(executor: TransactionExecutor, runId: string, type: 'research.run.failed' | 'research.run.cancelled', phase: string, now: number, error?: ResearchRunErrorDto | null) {
  return appendResearchEventInTransaction(executor, type === 'research.run.failed'
    ? { runId, type, phase, timestamp: now, payload: { errorCode: error?.code ?? 'RESEARCH_EXECUTION_FAILED', retryable: error?.retryable === true } }
    : { runId, type, phase, timestamp: now, payload: {} })
}

export const researchAttemptRepo = {
  create(input: CreateResearchAttemptInput): ResearchRunAttemptDto {
    const result = getOrmDb().transaction((tx) => {
      const now = input.createdAt ?? Date.now()
      const id = uuidv4()
      const ordinal = nextOrdinal(tx, input.runId)
      const status = input.status ?? 'queued'
      tx.insert(research_run_attempts).values({
        id,
        run_id: input.runId,
        ordinal,
        trigger: input.trigger,
        status,
        workflow_run_id: input.workflowRunId ?? null,
        start_checkpoint_key: input.startCheckpointKey ?? null,
        started_at: status === 'running' ? now : null,
        created_at: now,
      }).run()
      tx.update(research_runs).set({ current_attempt_id: id, updated_at: now }).where(eq(research_runs.id, input.runId)).run()
      const createdEvent = appendResearchEventInTransaction(tx, {
        runId: input.runId,
        type: 'research.attempt.created',
        phase: 'queued',
        timestamp: now,
        payload: { id, ordinal, trigger: input.trigger },
      })
      const startedEvent = status === 'running'
        ? appendResearchEventInTransaction(tx, { runId: input.runId, type: 'research.attempt.started', phase: 'queued', timestamp: now, payload: { id } })
        : null
      return { attempt: mapAttempt(tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, id)).get()!), events: startedEvent ? [createdEvent, startedEvent] : [createdEvent] }
    })
    for (const event of result.events) publishResearchEvent(event)
    return result.attempt
  },

  createWithInitialCheckpoint(input: CreateResearchAttemptWithInitialCheckpointInput): { attempt: ResearchRunAttemptDto; checkpoint: ResearchRunCheckpointDto } {
    const result = getOrmDb().transaction((tx) => {
      const now = input.createdAt ?? Date.now()
      const attemptId = uuidv4()
      const ordinal = nextOrdinal(tx, input.runId)
      const checkpointId = uuidv4()
      const checkpointSequence = 1
      tx.insert(research_run_attempts).values({
        id: attemptId, run_id: input.runId, ordinal, trigger: input.trigger, status: 'queued', workflow_run_id: input.workflowRunId ?? null,
        start_checkpoint_key: input.checkpoint.checkpointKey, created_at: now,
      }).run()
      tx.update(research_runs).set({ current_attempt_id: attemptId, last_checkpoint_sequence: checkpointSequence, resume_phase: input.checkpoint.resumeCursor.nextPhase, updated_at: now }).where(eq(research_runs.id, input.runId)).run()
      const attemptEvent = appendResearchEventInTransaction(tx, { runId: input.runId, type: 'research.attempt.created', phase: 'queued', timestamp: now, payload: { id: attemptId, ordinal, trigger: input.trigger } })
      tx.insert(research_run_checkpoints).values({
        id: checkpointId, run_id: input.runId, attempt_id: attemptId, sequence: checkpointSequence, checkpoint_key: input.checkpoint.checkpointKey,
        phase: input.checkpoint.phase, status: input.checkpoint.status, resume_cursor_json: encodeJson(input.checkpoint.resumeCursor),
        input_fingerprint: input.checkpoint.inputFingerprint, output_fingerprint: input.checkpoint.outputFingerprint ?? null,
        replay_policy: input.checkpoint.replayPolicy, created_at: now,
      }).run()
      const checkpoint = mapResearchCheckpoint(tx.select().from(research_run_checkpoints).where(eq(research_run_checkpoints.id, checkpointId)).get()!)
      const checkpointEvent = appendResearchEventInTransaction(tx, { runId: input.runId, type: 'research.checkpoint.completed', phase: checkpoint.phase, timestamp: now, payload: { id: checkpoint.id, checkpointKey: checkpoint.checkpointKey, sequence: checkpoint.sequence } })
      const attempt = mapAttempt(tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, attemptId)).get()!)
      return { attempt, checkpoint, events: [attemptEvent, checkpointEvent] }
    })
    for (const event of result.events) publishResearchEvent(event)
    return { attempt: result.attempt, checkpoint: result.checkpoint }
  },

  get(id: string): ResearchRunAttemptDto | undefined {
    const row = getOrmDb().select().from(research_run_attempts).where(eq(research_run_attempts.id, id)).get()
    return row ? mapAttempt(row) : undefined
  },

  findActive(runId: string): ResearchRunAttemptDto | undefined {
    const row = getOrmDb().select().from(research_run_attempts)
      .where(and(eq(research_run_attempts.run_id, runId), inArray(research_run_attempts.status, ['queued', 'running', 'cancelling'])))
      .orderBy(desc(research_run_attempts.ordinal)).get()
    return row ? mapAttempt(row) : undefined
  },

  listForRun(runId: string): ResearchRunAttemptDto[] {
    return getOrmDb().select().from(research_run_attempts)
      .where(eq(research_run_attempts.run_id, runId))
      .orderBy(desc(research_run_attempts.ordinal)).all().map(mapAttempt)
  },

  listExpiredActive(now = Date.now()): ResearchRunAttemptDto[] {
    return getOrmDb().select({ attempt: research_run_attempts }).from(research_run_attempts)
      .innerJoin(research_runs, and(
        eq(research_runs.id, research_run_attempts.run_id),
        eq(research_runs.current_attempt_id, research_run_attempts.id),
      ))
      .where(and(
        inArray(research_run_attempts.status, ['running']),
        lte(research_run_attempts.lease_expires_at, now),
        inArray(research_runs.status, ['planning', 'researching', 'synthesizing', 'verifying']),
      ))
      .orderBy(asc(research_run_attempts.created_at)).all().map((row) => mapAttempt(row.attempt))
  },

  interruptExpired(input: InterruptExpiredResearchAttemptInput): ResearchRunDto | undefined {
    const result = getOrmDb().transaction((tx) => {
      const now = input.now ?? Date.now()
      const attempt = tx.select().from(research_run_attempts).where(and(
        eq(research_run_attempts.id, input.attemptId),
        eq(research_run_attempts.status, 'running'),
        lte(research_run_attempts.lease_expires_at, now),
      )).get()
      if (!attempt) return undefined
      const run = tx.select().from(research_runs).where(and(
        eq(research_runs.id, attempt.run_id),
        eq(research_runs.current_attempt_id, attempt.id),
        inArray(research_runs.status, ['planning', 'researching', 'synthesizing', 'verifying']),
      )).get()
      if (!run) return undefined

      assertResearchTransition(run.status as ResearchRunStatus, 'interrupted')
      tx.update(research_run_attempts).set({
        status: 'interrupted', executor_id: null, ownership_token: null,
        lease_expires_at: null, heartbeat_at: now, ended_at: now,
      }).where(eq(research_run_attempts.id, attempt.id)).run()
      tx.update(research_runs).set({
        status: 'interrupted', phase: 'interrupted', resume_phase: run.phase,
        updated_at: now, state_version: sql`${research_runs.state_version} + 1`,
      }).where(and(eq(research_runs.id, run.id), eq(research_runs.current_attempt_id, attempt.id))).run()
      const event = appendResearchEventInTransaction(tx, {
        runId: run.id, type: 'research.run.interrupted', phase: 'interrupted', timestamp: now,
        payload: { reason: 'attempt_lease_expired', attemptId: attempt.id },
      })
      return { run: mapRun(tx.select().from(research_runs).where(eq(research_runs.id, run.id)).get()!), event }
    })
    if (result?.event) publishResearchEvent(result.event)
    return result?.run
  },

  acquireLease(attemptId: string, executorId: string, ownershipToken: string, leaseMs: number, now = Date.now()): boolean {
    if (!ownershipToken || leaseMs <= 0) return false
    const result = getOrmDb().transaction((tx) => {
      const current = tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, attemptId)).get()
      if (!current) return { acquired: false, event: null }
      const run = tx.select().from(research_runs).where(and(eq(research_runs.id, current.run_id), eq(research_runs.current_attempt_id, attemptId))).get()
      if (!run) return { acquired: false, event: null }
      const updated = tx.update(research_run_attempts).set({
        executor_id: executorId,
        ownership_token: ownershipToken,
        lease_expires_at: now + leaseMs,
        heartbeat_at: now,
        started_at: sql`coalesce(${research_run_attempts.started_at}, ${now})`,
        status: 'running',
      }).where(and(
        eq(research_run_attempts.id, attemptId),
        inArray(research_run_attempts.status, ['queued', 'running', 'cancelling']),
        or(isNull(research_run_attempts.lease_expires_at), lte(research_run_attempts.lease_expires_at, now)),
      )).run()
      if (updated.changes !== 1) return { acquired: false, event: null }
      const event = current.status === 'running'
        ? null
        : appendResearchEventInTransaction(tx, { runId: current.run_id, type: 'research.attempt.started', phase: 'queued', timestamp: now, payload: { id: attemptId } })
      return { acquired: true, event }
    })
    if (result.event) publishResearchEvent(result.event)
    return result.acquired
  },

  heartbeat(attemptId: string, executorId: string, ownershipToken: string, leaseMs: number, now = Date.now()): boolean {
    if (!ownershipToken || leaseMs <= 0) return false
    const result = getOrmDb().update(research_run_attempts).set({ lease_expires_at: now + leaseMs, heartbeat_at: now })
      .where(and(
        eq(research_run_attempts.id, attemptId),
        eq(research_run_attempts.executor_id, executorId),
        eq(research_run_attempts.ownership_token, ownershipToken),
        inArray(research_run_attempts.status, ['running', 'cancelling']),
        gt(research_run_attempts.lease_expires_at, now),
      )).run()
    return result.changes === 1
  },

  releaseLease(attemptId: string, executorId: string, ownershipToken: string): boolean {
    if (!ownershipToken) return false
    const result = getOrmDb().update(research_run_attempts).set({ executor_id: null, ownership_token: null, lease_expires_at: null, heartbeat_at: null })
      .where(and(eq(research_run_attempts.id, attemptId), eq(research_run_attempts.executor_id, executorId), eq(research_run_attempts.ownership_token, ownershipToken))).run()
    return result.changes === 1
  },

  finishOwned(input: FinishOwnedResearchAttemptInput): ResearchRunAttemptDto | null {
    const result = getOrmDb().transaction((tx) => {
      const now = input.now ?? Date.now()
      const attempt = ownedAttempt(tx, input, now)
      if (!attempt) return null
      const run = tx.select().from(research_runs).where(and(eq(research_runs.id, attempt.run_id), eq(research_runs.current_attempt_id, attempt.id))).get()
      if (!run) return null
      const cancellationRequested = run.cancel_requested_at !== null || run.status === 'cancelling' || run.status === 'cancelled'
      const status = cancellationRequested ? 'cancelled' : input.status
      const error = status === 'failed' ? input.error ?? { code: 'RESEARCH_EXECUTION_FAILED', message: 'Deep Research execution failed.', retryable: false } : null
      tx.update(research_run_attempts).set({
        status,
        end_checkpoint_key: input.endCheckpointKey ?? null,
        executor_id: null,
        ownership_token: null,
        lease_expires_at: null,
        heartbeat_at: now,
        error_code: error?.code ?? null,
        error_category: error?.category ?? null,
        error_message: error?.message ?? null,
        error_retryable: error ? Number(error.retryable) : null,
        ended_at: now,
      }).where(eq(research_run_attempts.id, attempt.id)).run()

      const events = [appendResearchEventInTransaction(tx, {
        runId: run.id,
        type: 'research.attempt.completed',
        phase: run.phase,
        timestamp: now,
        payload: { id: attempt.id, status, endCheckpointKey: input.endCheckpointKey ?? null },
      })]
      if (status === 'failed' && !['failed', 'cancelled', 'completed', 'completed_with_limitations'].includes(run.status)) {
        assertResearchTransition(run.status as ResearchRunStatus, 'failed', { error })
        tx.update(research_runs).set({ status: 'failed', error_code: error!.code, error_message: error!.message, error_retryable: Number(error!.retryable), updated_at: now, completed_at: now, state_version: sql`${research_runs.state_version} + 1` }).where(eq(research_runs.id, run.id)).run()
        events.push(appendAttemptEvent(tx, run.id, 'research.run.failed', run.phase, now, error))
      } else if (status === 'cancelled' && run.status !== 'cancelled') {
        assertResearchTransition(run.status as ResearchRunStatus, 'cancelled')
        tx.update(research_runs).set({ status: 'cancelled', phase: 'cancelled', error_code: null, error_message: null, error_retryable: null, updated_at: now, completed_at: now, state_version: sql`${research_runs.state_version} + 1` }).where(eq(research_runs.id, run.id)).run()
        events.push(appendAttemptEvent(tx, run.id, 'research.run.cancelled', 'cancelled', now))
      }
      return { attempt: mapAttempt(tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, attempt.id)).get()!), events }
    })
    for (const event of result?.events ?? []) publishResearchEvent(event)
    return result?.attempt ?? null
  },

  end(input: EndResearchAttemptInput): ResearchRunAttemptDto | undefined {
    const result = getOrmDb().transaction((tx) => {
      const current = tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, input.attemptId)).get()
      if (!current) return undefined
      const endedAt = input.endedAt ?? Date.now()
      tx.update(research_run_attempts).set({ status: input.status, end_checkpoint_key: input.endCheckpointKey ?? null, error_code: input.error?.code ?? null, error_category: input.error?.category ?? null, error_message: input.error?.message ?? null, error_retryable: input.error ? Number(input.error.retryable) : null, ended_at: endedAt, ownership_token: null, lease_expires_at: null, heartbeat_at: endedAt }).where(eq(research_run_attempts.id, input.attemptId)).run()
      const event = input.event ? appendResearchEventInTransaction(tx, { ...input.event, runId: current.run_id, timestamp: input.event.timestamp ?? endedAt }) : null
      return { attempt: mapAttempt(tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, input.attemptId)).get()!), event }
    })
    if (result?.event) publishResearchEvent(result.event)
    return result?.attempt
  },
}

export { mapAttempt as mapResearchAttempt }
