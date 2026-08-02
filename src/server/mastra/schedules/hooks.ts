import type {
  ScheduleAbortContext,
  ScheduleErrorContext,
  ScheduleFinishContext,
  ScheduleHooks,
  SchedulePrepareContext,
  SchedulesConfig,
} from '@mastra/core/schedules'
import { sanitizeErrorMessage, serverLogger } from '@server/logger/logger'
import { resolveMastraModel } from '../model-resolver'
import { SCHEDULED_TASK_AGENT_ID } from './scheduled-task-agent'

export const SCHEDULE_TASK_SURFACE = 'bloomai-scheduled-task'
export const SCHEDULE_TASK_SCHEMA_VERSION = 1

export type ScheduleTaskRunStatus = 'succeeded' | 'failed' | 'skipped' | 'aborted' | 'discarded'

/**
 * Framework-independent input for the future scheduled_task_runs repository.
 * `scheduleId` + `triggerFiredAt` is the required idempotency key.
 */
export interface ScheduleTaskRunRecord {
  scheduleId: string
  triggerFiredAt: number
  mastraRunId?: string
  triggerKind: 'cron' | 'manual'
  status: ScheduleTaskRunStatus
  outputText?: string
  errorMessage?: string
  usageJson?: string
  startedAt: number
  finishedAt?: number
}

export interface ScheduleTaskRunWriter {
  upsert(record: ScheduleTaskRunRecord): Promise<void>
}

export interface ScheduleHookLogger {
  warn(message: string, details?: Record<string, unknown>): void
}

export interface ScheduleHookDependencies {
  /** Phase 2 supplies the durable scheduled_task_runs repository adapter. */
  taskRunWriter: ScheduleTaskRunWriter
  /** Allows startup composition and unit tests to preflight default-model availability. */
  isDefaultModelAvailable?: () => Promise<boolean>
  /** Lets tests verify registration without coupling this module to the Mastra singleton. */
  isScheduledTaskAgentRegistered?: (mastra: unknown) => boolean
  logger?: ScheduleHookLogger
  now?: () => number
}

const NOOP_TASK_RUN_WRITER: ScheduleTaskRunWriter = {
  async upsert() {},
}

/**
 * Explicit temporary adapter for Phase 1 composition. It is intentionally named
 * so Phase 2 can replace it with the scheduled_task_runs repository adapter.
 */
export function createNoopScheduleTaskRunWriter(): ScheduleTaskRunWriter {
  return NOOP_TASK_RUN_WRITER
}

/**
 * Creates hooks for BloomAI-owned, threadless scheduled tasks only. Non-BloomAI
 * schedules are ignored rather than being written into application Task Run
 * history. Hook failures are logged and never escape into Mastra's worker.
 */
export function createScheduleHooks(dependencies: ScheduleHookDependencies): SchedulesConfig {
  const writer = dependencies.taskRunWriter
  const logger = dependencies.logger ?? serverLogger
  const now = dependencies.now ?? Date.now
  const skippedReasons = new Map<string, string>()

  const isDefaultModelAvailable = dependencies.isDefaultModelAvailable ?? defaultModelAvailability
  const isAgentRegistered = dependencies.isScheduledTaskAgentRegistered ?? defaultAgentRegistration

  const prepare: ScheduleHooks['prepare'] = async (ctx) => {
    if (!isBloomAIScheduledTask(ctx.schedule)) return null

    let skippedReason: string | undefined
    try {
      if (ctx.agentId !== SCHEDULED_TASK_AGENT_ID) {
        skippedReason = 'Unsupported scheduled task agent.'
      } else if (!isAgentRegistered(ctx.mastra)) {
        skippedReason = 'Scheduled task agent is not registered.'
      } else if (!await isDefaultModelAvailable()) {
        skippedReason = 'No enabled default model is available.'
      }
    } catch (error) {
      skippedReason = 'Scheduled task preflight failed.'
      logHookFailure(logger, 'prepare', ctx, error)
    }

    if (skippedReason) {
      skippedReasons.set(runKey(ctx.schedule.id, ctx.trigger.firedAt), skippedReason)
      return null
    }

    return undefined
  }

  const onFinish: ScheduleHooks['onFinish'] = async (ctx) => {
    if (!isBloomAIScheduledTask(ctx.schedule)) return

    const key = runKey(ctx.schedule.id, ctx.trigger.firedAt)
    try {
      const skippedReason = ctx.outcome === 'skipped' ? skippedReasons.get(key) ?? 'Scheduled task preflight skipped execution.' : undefined
      await writer.upsert({
        scheduleId: ctx.schedule.id,
        triggerFiredAt: ctx.trigger.firedAt.getTime(),
        mastraRunId: ctx.runId,
        triggerKind: ctx.trigger.kind,
        status: statusForFinish(ctx.outcome),
        outputText: ctx.outcome === 'succeeded' ? ctx.result?.text : undefined,
        errorMessage: skippedReason,
        usageJson: ctx.result?.usage ? JSON.stringify(ctx.result.usage) : undefined,
        startedAt: ctx.trigger.firedAt.getTime(),
        finishedAt: now(),
      })
    } catch (error) {
      logHookFailure(logger, 'onFinish', ctx, error)
    } finally {
      skippedReasons.delete(key)
    }
  }

  const onError: ScheduleHooks['onError'] = async (ctx) => {
    if (!isBloomAIScheduledTask(ctx.schedule)) return

    try {
      await writer.upsert({
        scheduleId: ctx.schedule.id,
        triggerFiredAt: ctx.trigger.firedAt.getTime(),
        mastraRunId: ctx.runId,
        triggerKind: ctx.trigger.kind,
        status: 'failed',
        errorMessage: sanitizeScheduleError(ctx.error),
        startedAt: ctx.trigger.firedAt.getTime(),
        finishedAt: now(),
      })
    } catch (error) {
      logHookFailure(logger, 'onError', ctx, error)
    } finally {
      skippedReasons.delete(runKey(ctx.schedule.id, ctx.trigger.firedAt))
    }
  }

  const onAbort: ScheduleHooks['onAbort'] = async (ctx) => {
    if (!isBloomAIScheduledTask(ctx.schedule)) return

    try {
      await writer.upsert({
        scheduleId: ctx.schedule.id,
        triggerFiredAt: ctx.trigger.firedAt.getTime(),
        mastraRunId: ctx.runId,
        triggerKind: ctx.trigger.kind,
        status: 'aborted',
        startedAt: ctx.trigger.firedAt.getTime(),
        finishedAt: now(),
      })
    } catch (error) {
      logHookFailure(logger, 'onAbort', ctx, error)
    } finally {
      skippedReasons.delete(runKey(ctx.schedule.id, ctx.trigger.firedAt))
    }
  }

  return { prepare, onFinish, onError, onAbort }
}

function isBloomAIScheduledTask(schedule: unknown): boolean {
  if (!isRecord(schedule) || !isRecord(schedule.metadata)) return false
  return schedule.metadata.surface === SCHEDULE_TASK_SURFACE
    && schedule.metadata.schemaVersion === SCHEDULE_TASK_SCHEMA_VERSION
}

function defaultAgentRegistration(mastra: unknown): boolean {
  if (!isRecord(mastra) || typeof mastra.getAgentById !== 'function') return false
  try {
    return Boolean(mastra.getAgentById(SCHEDULED_TASK_AGENT_ID))
  } catch {
    return false
  }
}

async function defaultModelAvailability(): Promise<boolean> {
  try {
    await resolveMastraModel()
    return true
  } catch {
    return false
  }
}

function statusForFinish(outcome: ScheduleFinishContext['outcome']): ScheduleTaskRunStatus {
  if (outcome === 'skipped') return 'skipped'
  if (outcome === 'discarded') return 'discarded'
  return 'succeeded'
}

function sanitizeScheduleError(error: unknown): string {
  const sanitized = sanitizeErrorMessage(error, 'Scheduled task execution failed.')
  return sanitized
    .replace(/[A-Za-z]:\\[^\s'"`]+/g, '[REDACTED_PATH]')
    .replace(/(?:^|\s)\/(?:[^\s'"`/]+\/)+[^\s'"`]*/g, ' [REDACTED_PATH]')
}

function logHookFailure(
  logger: ScheduleHookLogger,
  hook: string,
  ctx: SchedulePrepareContext | ScheduleFinishContext | ScheduleErrorContext | ScheduleAbortContext,
  error: unknown,
): void {
  logger.warn('Scheduled task lifecycle hook failed.', {
    hook,
    scheduleId: ctx.schedule.id,
    triggerFiredAt: ctx.trigger.firedAt.toISOString(),
    error: sanitizeScheduleError(error),
  })
}

function runKey(scheduleId: string, firedAt: Date): string {
  return `${scheduleId}:${firedAt.getTime()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
