/** Shared API contracts for BloomAI's threadless scheduled task sessions. */
export type ScheduleTaskStatus = 'active' | 'paused'
export type ScheduleTaskRunTriggerKind = 'cron' | 'manual'
export type ScheduleTaskRunStatus = 'succeeded' | 'failed' | 'skipped' | 'aborted' | 'discarded'

/** The only agent that can be selected for a first-version scheduled task. */
export type ScheduleTaskAgentId = 'scheduled-task'

export interface ScheduleTaskLastRunDto {
  status: ScheduleTaskRunStatus
  finishedAt: number | null
  outputPreview: string | null
}

/** A persisted, threadless Mastra schedule projected for the application and UI. */
export interface ScheduleTaskDto {
  id: string
  name: string
  agentId: ScheduleTaskAgentId
  cron: string
  timezone: string
  status: ScheduleTaskStatus
  nextFireAt: number | null
  lastFireAt: number | null
  lastRun: ScheduleTaskLastRunDto | null
}

/** One independently persisted execution of a scheduled task. */
export interface ScheduleTaskRunDto {
  id: string
  scheduleId: string
  triggerFiredAt: number
  mastraRunId: string | null
  triggerKind: ScheduleTaskRunTriggerKind
  status: ScheduleTaskRunStatus
  outputText: string | null
  errorMessage: string | null
  usageJson: string | null
  startedAt: number
  finishedAt: number | null
  createdAt: number
}

export interface CreateScheduleTaskInput {
  name: string
  cron: string
  timezone: string
  prompt: string
}

export interface UpdateScheduleTaskInput {
  name?: string
  cron?: string
  timezone?: string
  prompt?: string
  status?: ScheduleTaskStatus
}

export interface ScheduleTaskListDto {
  items: ScheduleTaskDto[]
}

export interface ScheduleTaskRunPageDto {
  items: ScheduleTaskRunDto[]
  nextCursor: string | null
}

export interface ListScheduleTaskRunsInput {
  limit?: number
  cursor?: string
}
