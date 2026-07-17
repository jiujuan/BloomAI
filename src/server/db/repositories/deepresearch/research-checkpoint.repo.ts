import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ResearchCheckpointCursorDto, ResearchCheckpointReplayPolicy, ResearchCheckpointStatus, ResearchRunCheckpointDto } from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { publishResearchEvent } from '@server/deepresearch/research-event-publisher'
import { research_run_attempts, research_run_checkpoints, research_runs } from '../../schema'
import { appendResearchEventInTransaction } from './research-event.repo'
import { decodeJson, encodeJson } from './repository-utils'

type TransactionExecutor = any

export interface AppendResearchCheckpointInput {
  runId: string
  attemptId: string
  sequence?: number
  checkpointKey: string
  phase: string
  status: ResearchCheckpointStatus
  resumeCursor: ResearchCheckpointCursorDto
  inputFingerprint: string
  outputFingerprint?: string | null
  replayPolicy: ResearchCheckpointReplayPolicy
  createdAt?: number
}

export interface CompleteCheckpointWithOwnershipInput extends Omit<AppendResearchCheckpointInput, 'status' | 'createdAt'> {
  executorId: string
  now?: number
}

function fallbackCursor(phase: string): ResearchCheckpointCursorDto {
  return { version: 1, nextPhase: phase, iteration: 0 }
}

export function mapResearchCheckpoint(row: typeof research_run_checkpoints.$inferSelect): ResearchRunCheckpointDto {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    sequence: row.sequence,
    checkpointKey: row.checkpoint_key,
    phase: row.phase,
    status: row.status as ResearchCheckpointStatus,
    resumeCursor: decodeJson<ResearchCheckpointCursorDto>(row.resume_cursor_json, fallbackCursor(row.phase)),
    inputFingerprint: row.input_fingerprint,
    outputFingerprint: row.output_fingerprint,
    replayPolicy: row.replay_policy as ResearchCheckpointReplayPolicy,
    createdAt: row.created_at,
  }
}

function nextSequence(executor: TransactionExecutor, attemptId: string): number {
  const current = executor.select({ sequence: sql<number>`coalesce(max(${research_run_checkpoints.sequence}), 0)` })
    .from(research_run_checkpoints).where(eq(research_run_checkpoints.attempt_id, attemptId)).get()
  return Number(current?.sequence ?? 0) + 1
}

function findIdempotent(executor: TransactionExecutor, input: Pick<AppendResearchCheckpointInput, 'runId' | 'checkpointKey' | 'inputFingerprint'>) {
  return executor.select().from(research_run_checkpoints).where(and(
    eq(research_run_checkpoints.run_id, input.runId),
    eq(research_run_checkpoints.checkpoint_key, input.checkpointKey),
    eq(research_run_checkpoints.input_fingerprint, input.inputFingerprint),
  )).get()
}

function appendInTransaction(executor: TransactionExecutor, input: AppendResearchCheckpointInput): { checkpoint: ResearchRunCheckpointDto; created: boolean } {
  const existing = findIdempotent(executor, input)
  if (existing) return { checkpoint: mapResearchCheckpoint(existing), created: false }
  const id = uuidv4()
  const sequence = input.sequence ?? nextSequence(executor, input.attemptId)
  const createdAt = input.createdAt ?? Date.now()
  executor.insert(research_run_checkpoints).values({
    id,
    run_id: input.runId,
    attempt_id: input.attemptId,
    sequence,
    checkpoint_key: input.checkpointKey,
    phase: input.phase,
    status: input.status,
    resume_cursor_json: encodeJson(input.resumeCursor),
    input_fingerprint: input.inputFingerprint,
    output_fingerprint: input.outputFingerprint ?? null,
    replay_policy: input.replayPolicy,
    created_at: createdAt,
  }).run()
  return { checkpoint: mapResearchCheckpoint(executor.select().from(research_run_checkpoints).where(eq(research_run_checkpoints.id, id)).get()!), created: true }
}

export const researchCheckpointRepo = {
  append(input: AppendResearchCheckpointInput): ResearchRunCheckpointDto {
    return getOrmDb().transaction((tx) => appendInTransaction(tx, input).checkpoint)
  },

  list(runId: string): ResearchRunCheckpointDto[] {
    return getOrmDb().select().from(research_run_checkpoints).where(eq(research_run_checkpoints.run_id, runId))
      .orderBy(desc(research_run_checkpoints.sequence)).all().map(mapResearchCheckpoint)
  },

  findLatestCompatibleCursor(runId: string, inputFingerprint: string): ResearchRunCheckpointDto | undefined {
    const compatible = getOrmDb().select().from(research_run_checkpoints).where(and(
      eq(research_run_checkpoints.run_id, runId),
      eq(research_run_checkpoints.status, 'completed'),
      eq(research_run_checkpoints.input_fingerprint, inputFingerprint),
    )).orderBy(desc(research_run_checkpoints.created_at), desc(research_run_checkpoints.sequence)).get()
    const row = compatible ?? getOrmDb().select().from(research_run_checkpoints).where(and(
      eq(research_run_checkpoints.run_id, runId),
      eq(research_run_checkpoints.status, 'completed'),
      eq(research_run_checkpoints.checkpoint_key, 'legacy:resume_from_planning'),
    )).orderBy(desc(research_run_checkpoints.created_at), desc(research_run_checkpoints.sequence)).get()
    return row ? mapResearchCheckpoint(row) : undefined
  },

  completeWithOwnership(input: CompleteCheckpointWithOwnershipInput): ResearchRunCheckpointDto | null {
    const result = getOrmDb().transaction((tx) => {
      const now = input.now ?? Date.now()
      const owner = tx.select().from(research_run_attempts).where(and(
        eq(research_run_attempts.id, input.attemptId),
        eq(research_run_attempts.run_id, input.runId),
        eq(research_run_attempts.executor_id, input.executorId),
        gt(research_run_attempts.lease_expires_at, now),
      )).get()
      if (!owner) return null

      const appended = appendInTransaction(tx, { ...input, status: 'completed', createdAt: now })
      const checkpoint = appended.checkpoint
      tx.update(research_runs).set({
        current_attempt_id: input.attemptId,
        last_checkpoint_sequence: checkpoint.sequence,
        resume_phase: checkpoint.resumeCursor.nextPhase,
        updated_at: now,
      }).where(eq(research_runs.id, input.runId)).run()
      const event = appended.created
        ? appendResearchEventInTransaction(tx, {
          runId: input.runId,
          type: 'research.checkpoint.completed',
          phase: checkpoint.phase,
          timestamp: now,
          payload: { id: checkpoint.id, checkpointKey: checkpoint.checkpointKey, sequence: checkpoint.sequence },
        })
        : null
      return { checkpoint, event }
    })
    if (!result) return null
    if (result.event) publishResearchEvent(result.event)
    return result.checkpoint
  },
}
