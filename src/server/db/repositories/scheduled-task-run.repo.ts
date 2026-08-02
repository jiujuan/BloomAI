import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { scheduled_task_runs } from '../schema'

export type ScheduledTaskRunTriggerKind = 'cron' | 'manual'
export type ScheduledTaskRunStatus = 'succeeded' | 'failed' | 'skipped' | 'aborted' | 'discarded'

export interface ScheduledTaskRun {
  id: string
  scheduleId: string
  triggerFiredAt: number
  mastraRunId: string | null
  triggerKind: ScheduledTaskRunTriggerKind
  status: ScheduledTaskRunStatus
  outputText: string | null
  errorMessage: string | null
  usageJson: string | null
  startedAt: number
  finishedAt: number | null
  createdAt: number
}

export interface CreateScheduledTaskRunInput {
  scheduleId: string
  triggerFiredAt: number
  mastraRunId?: string | null
  triggerKind: ScheduledTaskRunTriggerKind
  status: ScheduledTaskRunStatus
  outputText?: string | null
  errorMessage?: string | null
  usageJson?: string | null
  startedAt: number
  finishedAt?: number | null
  createdAt?: number
}

export interface ListScheduledTaskRunsOptions {
  limit?: number
  cursor?: string
}

export interface ScheduledTaskRunPage {
  data: ScheduledTaskRun[]
  nextCursor: string | null
}

export interface ScheduleTaskRunWriterInput {
  scheduleId: string
  triggerFiredAt: number
  mastraRunId?: string
  triggerKind: ScheduledTaskRunTriggerKind
  status: ScheduledTaskRunStatus
  outputText?: string
  errorMessage?: string
  usageJson?: string
  startedAt: number
  finishedAt?: number
}

function mapScheduledTaskRun(row: typeof scheduled_task_runs.$inferSelect): ScheduledTaskRun {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    triggerFiredAt: row.trigger_fired_at,
    mastraRunId: row.mastra_run_id,
    triggerKind: row.trigger_kind as ScheduledTaskRunTriggerKind,
    status: row.status as ScheduledTaskRunStatus,
    outputText: row.output_text,
    errorMessage: row.error_message,
    usageJson: row.usage_json,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 50
  return Math.max(1, Math.min(Math.trunc(limit!), 100))
}

function parseCursor(cursor: string | undefined): number | undefined {
  if (!cursor || !/^\d+$/.test(cursor)) return undefined
  const value = Number(cursor)
  return Number.isSafeInteger(value) ? value : undefined
}

export const scheduledTaskRunRepo = {
  createOrGet(input: CreateScheduledTaskRunInput): ScheduledTaskRun {
    const createdAt = input.createdAt ?? Date.now()
    getOrmDb().insert(scheduled_task_runs).values({
      id: uuidv4(),
      schedule_id: input.scheduleId,
      trigger_fired_at: input.triggerFiredAt,
      mastra_run_id: input.mastraRunId ?? null,
      trigger_kind: input.triggerKind,
      status: input.status,
      output_text: input.outputText ?? null,
      error_message: input.errorMessage ?? null,
      usage_json: input.usageJson ?? null,
      started_at: input.startedAt,
      finished_at: input.finishedAt ?? null,
      created_at: createdAt,
    }).onConflictDoNothing({
      target: [scheduled_task_runs.schedule_id, scheduled_task_runs.trigger_fired_at],
    }).run()

    return this.getByScheduleAndTrigger(input.scheduleId, input.triggerFiredAt)!
  },

  upsert(input: CreateScheduledTaskRunInput): ScheduledTaskRun {
    const existing = this.createOrGet(input)
    const updates: Partial<typeof scheduled_task_runs.$inferInsert> = {
      status: input.status,
    }

    if (input.mastraRunId !== undefined) updates.mastra_run_id = input.mastraRunId
    if (input.outputText !== undefined) updates.output_text = input.outputText
    if (input.errorMessage !== undefined) updates.error_message = input.errorMessage
    if (input.usageJson !== undefined) updates.usage_json = input.usageJson
    if (input.startedAt !== undefined) updates.started_at = input.startedAt
    if (input.finishedAt !== undefined) updates.finished_at = input.finishedAt

    getOrmDb().update(scheduled_task_runs).set(updates)
      .where(eq(scheduled_task_runs.id, existing.id)).run()

    return this.get(existing.id)!
  },

  get(id: string): ScheduledTaskRun | undefined {
    const row = getOrmDb().select().from(scheduled_task_runs)
      .where(eq(scheduled_task_runs.id, id)).get()
    return row ? mapScheduledTaskRun(row) : undefined
  },

  getByScheduleAndTrigger(scheduleId: string, triggerFiredAt: number): ScheduledTaskRun | undefined {
    const row = getOrmDb().select().from(scheduled_task_runs).where(and(
      eq(scheduled_task_runs.schedule_id, scheduleId),
      eq(scheduled_task_runs.trigger_fired_at, triggerFiredAt),
    )).get()
    return row ? mapScheduledTaskRun(row) : undefined
  },

  listByScheduleId(scheduleId: string, options: ListScheduledTaskRunsOptions = {}): ScheduledTaskRunPage {
    const limit = normalizeLimit(options.limit)
    const cursor = parseCursor(options.cursor)
    const conditions = [eq(scheduled_task_runs.schedule_id, scheduleId)]
    if (cursor !== undefined) conditions.push(lt(scheduled_task_runs.trigger_fired_at, cursor))

    const rows = getOrmDb().select().from(scheduled_task_runs).where(and(...conditions))
      .orderBy(desc(scheduled_task_runs.trigger_fired_at)).limit(limit + 1).all()
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows

    return {
      data: pageRows.map(mapScheduledTaskRun),
      nextCursor: hasMore ? String(pageRows.at(-1)!.trigger_fired_at) : null,
    }
  },

  getLatestByScheduleIds(scheduleIds: string[]): Map<string, ScheduledTaskRun> {
    if (scheduleIds.length === 0) return new Map()

    const rows = getOrmDb().select().from(scheduled_task_runs)
      .where(inArray(scheduled_task_runs.schedule_id, [...new Set(scheduleIds)]))
      .orderBy(scheduled_task_runs.schedule_id, desc(scheduled_task_runs.trigger_fired_at)).all()
    const latest = new Map<string, ScheduledTaskRun>()
    for (const row of rows) {
      if (!latest.has(row.schedule_id)) latest.set(row.schedule_id, mapScheduledTaskRun(row))
    }
    return latest
  },

  deleteByScheduleId(scheduleId: string): number {
    return Number(getOrmDb().delete(scheduled_task_runs)
      .where(eq(scheduled_task_runs.schedule_id, scheduleId)).run().changes)
  },
}

/** Adapts the repository to Mastra schedule lifecycle hooks without importing Mastra into the database layer. */
export function createScheduledTaskRunWriter(): { upsert(input: ScheduleTaskRunWriterInput): Promise<void> } {
  return {
    async upsert(input): Promise<void> {
      scheduledTaskRunRepo.upsert(input)
    },
  }
}
