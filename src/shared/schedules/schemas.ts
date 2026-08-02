import { z } from 'zod'

const scheduleTaskStatusValues = ['active', 'paused'] as const

function hasIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Validates an IANA time-zone identifier using the runtime's ICU data. */
export function isValidScheduleTaskTimeZone(value: string): boolean {
  return hasIanaTimeZone(value)
}

export const scheduleTaskStatusSchema = z.enum(scheduleTaskStatusValues)

const nameSchema = z.string().trim().min(1, 'Name is required.').max(120, 'Name must be at most 120 characters.')
const promptSchema = z.string().trim().min(1, 'Prompt is required.').max(12_000, 'Prompt must be at most 12,000 characters.')
const cronSchema = z.string().trim().min(1, 'Cron expression is required.').max(256, 'Cron expression must be at most 256 characters.')
const timezoneSchema = z.string().trim().min(1, 'Time zone is required.').max(100, 'Time zone must be at most 100 characters.')
  .refine(hasIanaTimeZone, 'Invalid IANA time zone.')

/** Input accepted when creating an application-owned scheduled task. */
export const createScheduleTaskSchema = z.object({
  name: nameSchema,
  cron: cronSchema,
  timezone: timezoneSchema,
  prompt: promptSchema,
}).strict()

/** Patch input accepted for an application-owned scheduled task. */
export const updateScheduleTaskSchema = z.object({
  name: nameSchema.optional(),
  cron: cronSchema.optional(),
  timezone: timezoneSchema.optional(),
  prompt: promptSchema.optional(),
  status: scheduleTaskStatusSchema.optional(),
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: 'At least one schedule task field must be supplied.',
})

export const scheduleTaskIdSchema = z.string().trim().min(1, 'Schedule task id is required.').max(200, 'Schedule task id is too long.')

/** Query validation for task run history. Cursor matches the repository's epoch-millisecond cursor. */
export const listScheduleTaskRunsSchema = z.object({
  limit: z.number().int().min(1, 'Limit must be at least 1.').max(100, 'Limit must be at most 100.').optional(),
  cursor: z.string().min(1, 'Cursor must not be empty.').max(20, 'Cursor is too long.').regex(/^\d+$/, 'Cursor must be a numeric epoch-millisecond value.').optional(),
}).strict()
