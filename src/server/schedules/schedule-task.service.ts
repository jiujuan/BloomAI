import type {
  AgentSchedule,
  AnySchedule,
  CreateAgentScheduleInput,
  UpdateAgentScheduleInput,
} from '@mastra/core/schedules'
import type {
  CreateScheduleTaskInput,
  ListScheduleTaskRunsInput,
  ScheduleTaskDto,
  ScheduleTaskRunDto,
  ScheduleTaskRunPageDto,
  UpdateScheduleTaskInput,
} from '@shared/schedules/contracts'
import {
  createScheduleTaskSchema,
  listScheduleTaskRunsSchema,
  scheduleTaskIdSchema,
  updateScheduleTaskSchema,
} from '@shared/schedules/schemas'
import {
  scheduledTaskRunRepo,
  type ScheduledTaskRun,
  type ScheduledTaskRunPage,
} from '../db/repositories/scheduled-task-run.repo'
import { serverLogger } from '../logger/logger'
import { mastra } from '../mastra'
import {
  SCHEDULE_TASK_SCHEMA_VERSION,
  SCHEDULE_TASK_SURFACE,
} from '../mastra/schedules/hooks'
import { SCHEDULED_TASK_AGENT_ID } from '../mastra/schedules/scheduled-task-agent'

const OUTPUT_PREVIEW_MAX_LENGTH = 500

export const SCHEDULE_TASK_ERROR_CODES = [
  'SCHEDULE_NOT_FOUND',
  'SCHEDULE_INVALID_CRON',
  'SCHEDULE_INVALID_TIMEZONE',
  'SCHEDULE_INVALID_INPUT',
  'SCHEDULE_EXECUTION_UNAVAILABLE',
  'SCHEDULE_OPERATION_FAILED',
] as const

export type ScheduleTaskErrorCode = (typeof SCHEDULE_TASK_ERROR_CODES)[number]

/** Application-level error intentionally independent from HTTP status mapping. */
export class ScheduleTaskServiceError extends Error {
  readonly name = 'ScheduleTaskServiceError'

  constructor(
    readonly code: ScheduleTaskErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, string | number | boolean | null>>,
  ) {
    super(message)
  }
}

export interface ScheduleGateway {
  schedules: {
    list(filter?: { agentId?: string }): Promise<AnySchedule[]>
    get(id: string): Promise<AnySchedule | null>
    create(input: CreateAgentScheduleInput): Promise<AgentSchedule>
    update(id: string, patch: UpdateAgentScheduleInput): Promise<AnySchedule>
    pause(id: string): Promise<AnySchedule>
    resume(id: string): Promise<AnySchedule>
    run(id: string): Promise<{ scheduleId: string; claimId: string; scheduledFireAt: number }>
    delete(id: string): Promise<void>
  }
}

type Awaitable<T> = T | Promise<T>

export interface ScheduleTaskRunRepository {
  getLatestByScheduleIds(scheduleIds: string[]): Awaitable<Map<string, ScheduledTaskRun>>
  listByScheduleId(scheduleId: string, options: ListScheduleTaskRunsInput): Awaitable<ScheduledTaskRunPage>
  deleteByScheduleId(scheduleId: string): Awaitable<number>
}

export interface ScheduleTaskLogger {
  error(message: string, details?: Record<string, unknown>): void
}

export interface CreateScheduleTaskServiceOptions {
  gateway?: ScheduleGateway
  taskRunRepository?: ScheduleTaskRunRepository
  logger?: ScheduleTaskLogger
}

/**
 * The only application boundary that adapts BloomAI task sessions to Mastra's
 * beta schedules API. It never creates or accepts Chat thread/resource data.
 */
export function createScheduleTaskService({
  gateway = mastra,
  taskRunRepository = scheduledTaskRunRepo,
  logger = serverLogger,
}: CreateScheduleTaskServiceOptions = {}) {
  async function getOwnedSchedule(id: string): Promise<AgentSchedule> {
    const scheduleId = parseScheduleId(id)
    const schedule = await invokeGateway(() => gateway.schedules.get(scheduleId))
    if (!isBloomAIScheduledTask(schedule)) {
      throw new ScheduleTaskServiceError('SCHEDULE_NOT_FOUND', 'Scheduled task was not found.', { scheduleId })
    }
    return schedule
  }

  async function toTaskDto(
    schedule: AgentSchedule,
    options: { latestRun?: ScheduledTaskRun; latestRunLoaded?: boolean } = {},
  ): Promise<ScheduleTaskDto> {
    const run = options.latestRunLoaded
      ? options.latestRun
      : options.latestRun ?? (await taskRunRepository.getLatestByScheduleIds([schedule.id])).get(schedule.id)
    return {
      id: schedule.id,
      // All app-owned schedules are created with a name. Keep legacy/corrupt runtime rows displayable without leaking data.
      name: schedule.name ?? schedule.id,
      agentId: SCHEDULED_TASK_AGENT_ID,
      cron: schedule.cron,
      timezone: schedule.timezone ?? 'UTC',
      status: schedule.status,
      nextFireAt: finiteTimestampOrNull(schedule.nextFireAt),
      lastFireAt: finiteTimestampOrNull(schedule.lastFireAt),
      lastRun: run ? toLastRunDto(run) : null,
    }
  }

  return {
    async listTasks(): Promise<ScheduleTaskDto[]> {
      const schedules = (await invokeGateway(() => gateway.schedules.list({ agentId: SCHEDULED_TASK_AGENT_ID })))
        .filter(isBloomAIScheduledTask)
      const latestRuns = await taskRunRepository.getLatestByScheduleIds(schedules.map((schedule) => schedule.id))
      return Promise.all(schedules.map((schedule) => toTaskDto(schedule, { latestRun: latestRuns.get(schedule.id), latestRunLoaded: true })))
    },

    async getTask(id: string): Promise<ScheduleTaskDto | null> {
      const scheduleId = parseScheduleId(id)
      const schedule = await invokeGateway(() => gateway.schedules.get(scheduleId))
      if (!isBloomAIScheduledTask(schedule)) return null
      return toTaskDto(schedule)
    },

    async createTask(input: CreateScheduleTaskInput): Promise<ScheduleTaskDto> {
      const parsed = parseCreateInput(input)
      const created = await invokeGateway(() => gateway.schedules.create({
        agentId: SCHEDULED_TASK_AGENT_ID,
        name: parsed.name,
        cron: parsed.cron,
        timezone: parsed.timezone,
        prompt: parsed.prompt,
        metadata: controlledMetadata(),
      }))
      if (!hasControlledMetadata(created)) {
        throw new ScheduleTaskServiceError('SCHEDULE_OPERATION_FAILED', 'Mastra returned an invalid scheduled task.', { scheduleId: created.id })
      }
      return toTaskDto(created)
    },

    async updateTask(id: string, input: UpdateScheduleTaskInput): Promise<ScheduleTaskDto> {
      const schedule = await getOwnedSchedule(id)
      const parsed = parseUpdateInput(input)
      const updated = await invokeGateway(() => gateway.schedules.update(schedule.id, parsed))
      if (!isBloomAIScheduledTask(updated)) {
        throw new ScheduleTaskServiceError('SCHEDULE_OPERATION_FAILED', 'Mastra returned an invalid scheduled task.', { scheduleId: schedule.id })
      }
      return toTaskDto(updated)
    },

    async pauseTask(id: string): Promise<ScheduleTaskDto> {
      const schedule = await getOwnedSchedule(id)
      const paused = await invokeGateway(() => gateway.schedules.pause(schedule.id))
      return taskDtoFromOwnedSchedule(paused, schedule.id)
    },

    async resumeTask(id: string): Promise<ScheduleTaskDto> {
      const schedule = await getOwnedSchedule(id)
      const resumed = await invokeGateway(() => gateway.schedules.resume(schedule.id))
      return taskDtoFromOwnedSchedule(resumed, schedule.id)
    },

    async runTaskNow(id: string): Promise<ScheduleTaskDto> {
      const schedule = await getOwnedSchedule(id)
      await invokeGateway(() => gateway.schedules.run(schedule.id))
      // Mastra run() only claims/enqueues work. The lifecycle hooks persist its eventual outcome asynchronously.
      const current = await invokeGateway(() => gateway.schedules.get(schedule.id))
      if (!isBloomAIScheduledTask(current)) {
        throw new ScheduleTaskServiceError('SCHEDULE_NOT_FOUND', 'Scheduled task was not found.', { scheduleId: schedule.id })
      }
      return toTaskDto(current)
    },

    async deleteTask(id: string): Promise<void> {
      const schedule = await getOwnedSchedule(id)
      await invokeGateway(() => gateway.schedules.delete(schedule.id))
      try {
        await taskRunRepository.deleteByScheduleId(schedule.id)
      } catch (error) {
        logger.error('Scheduled task was deleted from Mastra but its run history cleanup failed.', {
          scheduleId: schedule.id,
          error: safeErrorMessage(error),
          severity: 'high',
        })
        throw new ScheduleTaskServiceError(
          'SCHEDULE_OPERATION_FAILED',
          'Scheduled task was deleted, but its run history cleanup failed. Manual cleanup is required.',
          { scheduleId: schedule.id },
        )
      }
    },

    async listTaskRuns(id: string, options: ListScheduleTaskRunsInput = {}): Promise<ScheduleTaskRunPageDto> {
      const schedule = await getOwnedSchedule(id)
      const parsed = parseRunListOptions(options)
      const page = await taskRunRepository.listByScheduleId(schedule.id, parsed)
      return {
        items: page.data.map(toScheduleTaskRunDto),
        nextCursor: page.nextCursor,
      }
    },
  }

  async function taskDtoFromOwnedSchedule(schedule: AnySchedule, requestedId: string): Promise<ScheduleTaskDto> {
    if (!isBloomAIScheduledTask(schedule)) {
      throw new ScheduleTaskServiceError('SCHEDULE_OPERATION_FAILED', 'Mastra returned an invalid scheduled task.', { scheduleId: requestedId })
    }
    return toTaskDto(schedule)
  }
}

export type ScheduleTaskService = ReturnType<typeof createScheduleTaskService>

/** Production instance for the future HTTP route while retaining injectable dependencies for tests. */
export const scheduleTaskService = createScheduleTaskService()

function controlledMetadata(): Record<string, unknown> {
  return {
    surface: SCHEDULE_TASK_SURFACE,
    schemaVersion: SCHEDULE_TASK_SCHEMA_VERSION,
  }
}

function isBloomAIScheduledTask(schedule: AnySchedule | null): schedule is AgentSchedule {
  return Boolean(schedule && schedule.agentId === SCHEDULED_TASK_AGENT_ID && hasControlledMetadata(schedule))
}

function hasControlledMetadata(schedule: { metadata?: Record<string, unknown> }): boolean {
  const metadata = schedule.metadata
  return metadata?.surface === SCHEDULE_TASK_SURFACE
    && metadata.schemaVersion === SCHEDULE_TASK_SCHEMA_VERSION
}

function parseScheduleId(id: string): string {
  const parsed = scheduleTaskIdSchema.safeParse(id)
  if (!parsed.success) throw invalidInputError(parsed.error.issues[0]?.message)
  return parsed.data
}

function parseCreateInput(input: CreateScheduleTaskInput) {
  const parsed = createScheduleTaskSchema.safeParse(input)
  if (!parsed.success) throw schemaError(parsed.error.issues[0]?.path[0], parsed.error.issues[0]?.message)
  return parsed.data
}

function parseUpdateInput(input: UpdateScheduleTaskInput) {
  const parsed = updateScheduleTaskSchema.safeParse(input)
  if (!parsed.success) throw schemaError(parsed.error.issues[0]?.path[0], parsed.error.issues[0]?.message)
  return parsed.data
}

function parseRunListOptions(options: ListScheduleTaskRunsInput): ListScheduleTaskRunsInput {
  const parsed = listScheduleTaskRunsSchema.safeParse(options)
  if (!parsed.success) throw invalidInputError(parsed.error.issues[0]?.message)
  return parsed.data
}

function schemaError(path: PropertyKey | undefined, message?: string): ScheduleTaskServiceError {
  if (path === 'timezone') return new ScheduleTaskServiceError('SCHEDULE_INVALID_TIMEZONE', message ?? 'Invalid time zone.')
  return invalidInputError(message)
}

function invalidInputError(message = 'Invalid scheduled task input.'): ScheduleTaskServiceError {
  return new ScheduleTaskServiceError('SCHEDULE_INVALID_INPUT', message)
}

async function invokeGateway<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ScheduleTaskServiceError) throw error
    throw translateGatewayError(error)
  }
}

function translateGatewayError(error: unknown): ScheduleTaskServiceError {
  const message = safeErrorMessage(error)
  if (isNotFoundGatewayError(error, message)) {
    return new ScheduleTaskServiceError('SCHEDULE_NOT_FOUND', 'Scheduled task was not found.')
  }
  if (/invalid timezone/i.test(message)) {
    return new ScheduleTaskServiceError('SCHEDULE_INVALID_TIMEZONE', 'Invalid scheduled task time zone.')
  }
  if (/invalid cron expression|cron expression .* no future occurrence/i.test(message)) {
    return new ScheduleTaskServiceError('SCHEDULE_INVALID_CRON', 'Invalid scheduled task cron expression.')
  }
  if (/agent[- ]missing|agent .*not found|model .*?(unavailable|not configured)|no .*model/i.test(message)) {
    return new ScheduleTaskServiceError('SCHEDULE_EXECUTION_UNAVAILABLE', 'Scheduled task execution is unavailable.')
  }
  return new ScheduleTaskServiceError('SCHEDULE_OPERATION_FAILED', 'Scheduled task operation failed.')
}

function isNotFoundGatewayError(error: unknown, message: string): boolean {
  const hasNotFoundErrorId = typeof error === 'object' && error !== null
    && 'id' in error
    && (error as { id?: unknown }).id === 'SCHEDULES_NOT_FOUND'
  return hasNotFoundErrorId || /schedule .*not found/i.test(message)
}

function toLastRunDto(run: ScheduledTaskRun): ScheduleTaskDto['lastRun'] {
  return {
    status: run.status,
    finishedAt: run.finishedAt,
    outputPreview: outputPreview(run.outputText),
  }
}

function toScheduleTaskRunDto(run: ScheduledTaskRun): ScheduleTaskRunDto {
  return {
    id: run.id,
    scheduleId: run.scheduleId,
    triggerFiredAt: run.triggerFiredAt,
    mastraRunId: run.mastraRunId,
    triggerKind: run.triggerKind,
    status: run.status,
    outputText: run.outputText,
    errorMessage: run.errorMessage,
    usageJson: run.usageJson,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
  }
}

function outputPreview(output: string | null): string | null {
  if (!output) return null
  const normalized = output.trim()
  if (!normalized) return null
  return normalized.length <= OUTPUT_PREVIEW_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, OUTPUT_PREVIEW_MAX_LENGTH - 1)}…`
}

function finiteTimestampOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return 'Unknown error'
}
