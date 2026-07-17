import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../db/client'
import { research_recovery_commands } from '../db/schema'

function isUniqueConstraintError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown }
  return candidate?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || (typeof candidate?.message === 'string' && candidate.message.includes('UNIQUE constraint failed'))
}
/**
 * Durable command-key deduplication shared by user commands.  The legacy table
 * is intentionally reused: command keys are namespaced so recovery keys and
 * interactive start/resume/cancel keys cannot collide.
 */
export function claimDeepResearchCommand(runId: string, commandKey: string, now = Date.now()): boolean {
  try {
    getOrmDb().insert(research_recovery_commands).values({
      id: uuidv4(),
      run_id: runId,
      command_key: commandKey,
      status: 'claimed',
      dispatch_token: null,
      created_at: now,
      updated_at: now,
    }).run()
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

/** Marks a claimed command as dispatched exactly once before the executor is notified. */
export function markDeepResearchCommandDispatched(runId: string, commandKey: string, now = Date.now()): boolean {
  const result = getOrmDb().update(research_recovery_commands).set({
    status: 'dispatched',
    dispatch_token: null,
    updated_at: now,
  }).where(and(
    eq(research_recovery_commands.run_id, runId),
    eq(research_recovery_commands.command_key, commandKey),
    eq(research_recovery_commands.status, 'claimed'),
  )).run()
  return result.changes === 1
}

export function deepResearchCommandKey(kind: 'start' | 'resume' | 'cancel', runId: string, stateVersion: number | undefined): string {
  return `deepresearch:command:v1:${kind}:${runId}:${stateVersion ?? 0}`
}
