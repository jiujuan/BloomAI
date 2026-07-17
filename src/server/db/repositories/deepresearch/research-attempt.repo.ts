import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ResearchAttemptStatus, ResearchAttemptTrigger, ResearchCheckpointCursorDto, ResearchCheckpointReplayPolicy, ResearchCheckpointStatus, ResearchRunAttemptDto, ResearchRunCheckpointDto, ResearchRunErrorDto } from '@shared/deepresearch/contracts'
import type { AppendResearchEventInput } from './research-event.repo'
import { getOrmDb } from '../../client'
import { publishResearchEvent } from '@server/deepresearch/research-event-publisher'
import { research_run_attempts, research_run_checkpoints, research_runs } from '../../schema'
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
        ? appendResearchEventInTransaction(tx, {
          runId: input.runId,
          type: 'research.attempt.started',
          phase: 'queued',
          timestamp: now,
          payload: { id },
        })
        : null
      return { attempt: mapAttempt(tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, id)).get()!), events: startedEvent ? [createdEvent, startedEvent] : [createdEvent] }
    })
    for (const event of result.events) publishResearchEvent(event)
    return result.attempt
  },

  /**
   * Creates the first queued Attempt, its durable resume cursor, and both
   * events in one transaction.  Publishing happens only after commit.
   */
  createWithInitialCheckpoint(input: CreateResearchAttemptWithInitialCheckpointInput): { attempt: ResearchRunAttemptDto; checkpoint: ResearchRunCheckpointDto } {
    const result = getOrmDb().transaction((tx) => {
      const now = input.createdAt ?? Date.now()
      const attemptId = uuidv4()
      const ordinal = nextOrdinal(tx, input.runId)
      const checkpointId = uuidv4()
      const checkpointSequence = 1
      tx.insert(research_run_attempts).values({
        id: attemptId,
        run_id: input.runId,
        ordinal,
        trigger: input.trigger,
        status: 'queued',
        workflow_run_id: input.workflowRunId ?? null,
        start_checkpoint_key: input.checkpoint.checkpointKey,
        created_at: now,
      }).run()
      tx.update(research_runs).set({
        current_attempt_id: attemptId,
        last_checkpoint_sequence: checkpointSequence,
        resume_phase: input.checkpoint.resumeCursor.nextPhase,
        updated_at: now,
      }).where(eq(research_runs.id, input.runId)).run()

      const attemptEvent = appendResearchEventInTransaction(tx, {
        runId: input.runId,
        type: 'research.attempt.created',
        phase: 'queued',
        timestamp: now,
        payload: { id: attemptId, ordinal, trigger: input.trigger },
      })
      tx.insert(research_run_checkpoints).values({
        id: checkpointId,
        run_id: input.runId,
        attempt_id: attemptId,
        sequence: checkpointSequence,
        checkpoint_key: input.checkpoint.checkpointKey,
        phase: input.checkpoint.phase,
        status: input.checkpoint.status,
        resume_cursor_json: encodeJson(input.checkpoint.resumeCursor),
        input_fingerprint: input.checkpoint.inputFingerprint,
        output_fingerprint: input.checkpoint.outputFingerprint ?? null,
        replay_policy: input.checkpoint.replayPolicy,
        created_at: now,
      }).run()
      const checkpoint = mapResearchCheckpoint(tx.select().from(research_run_checkpoints).where(eq(research_run_checkpoints.id, checkpointId)).get()!)
      const checkpointEvent = appendResearchEventInTransaction(tx, {
        runId: input.runId,
        type: 'research.checkpoint.completed',
        phase: checkpoint.phase,
        timestamp: now,
        payload: { id: checkpoint.id, checkpointKey: checkpoint.checkpointKey, sequence: checkpoint.sequence },
      })
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
      .orderBy(desc(research_run_attempts.ordinal))
      .get()
    return row ? mapAttempt(row) : undefined
  },

  acquireLease(attemptId: string, executorId: string, leaseMs: number, now = Date.now()): boolean {
    const result = getOrmDb().transaction((tx) => {
      const current = tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, attemptId)).get()
      if (!current) return { acquired: false, event: null }
      const updated = tx.update(research_run_attempts).set({
        executor_id: executorId,
        lease_expires_at: now + leaseMs,
        heartbeat_at: now,
        started_at: sql`coalesce(${research_run_attempts.started_at}, ${now})`,
        status: 'running',
      }).where(and(
        eq(research_run_attempts.id, attemptId),
        inArray(research_run_attempts.status, ['queued', 'running', 'cancelling']),
        or(
          isNull(research_run_attempts.lease_expires_at),
          lte(research_run_attempts.lease_expires_at, now),
          eq(research_run_attempts.executor_id, executorId),
        ),
      )).run()
      if (updated.changes !== 1) return { acquired: false, event: null }
      const event = current.status === 'running'
        ? null
        : appendResearchEventInTransaction(tx, {
          runId: current.run_id,
          type: 'research.attempt.started',
          phase: 'queued',
          timestamp: now,
          payload: { id: attemptId },
        })
      return { acquired: true, event }
    })
    if (result.event) publishResearchEvent(result.event)
    return result.acquired
  },

  releaseLease(attemptId: string, executorId: string): boolean {
    const result = getOrmDb().update(research_run_attempts).set({ executor_id: null, lease_expires_at: null, heartbeat_at: null })
      .where(and(eq(research_run_attempts.id, attemptId), eq(research_run_attempts.executor_id, executorId))).run()
    return result.changes === 1
  },

  end(input: EndResearchAttemptInput): ResearchRunAttemptDto | undefined {
    const result = getOrmDb().transaction((tx) => {
      const current = tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, input.attemptId)).get()
      if (!current) return undefined
      const endedAt = input.endedAt ?? Date.now()
      tx.update(research_run_attempts).set({
        status: input.status,
        end_checkpoint_key: input.endCheckpointKey ?? null,
        error_code: input.error?.code ?? null,
        error_category: input.error?.category ?? null,
        error_message: input.error?.message ?? null,
        error_retryable: input.error ? Number(input.error.retryable) : null,
        ended_at: endedAt,
        lease_expires_at: null,
        heartbeat_at: endedAt,
      }).where(eq(research_run_attempts.id, input.attemptId)).run()
      const event = input.event
        ? appendResearchEventInTransaction(tx, { ...input.event, runId: current.run_id, timestamp: input.event.timestamp ?? endedAt })
        : null
      return { attempt: mapAttempt(tx.select().from(research_run_attempts).where(eq(research_run_attempts.id, input.attemptId)).get()!), event }
    })
    if (result?.event) publishResearchEvent(result.event)
    return result?.attempt
  },
}

export { mapAttempt as mapResearchAttempt }
