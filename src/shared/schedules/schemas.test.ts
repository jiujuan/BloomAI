import { describe, expect, it } from 'vitest'
import {
  createScheduleTaskSchema,
  isValidScheduleTaskTimeZone,
  listScheduleTaskRunsSchema,
  updateScheduleTaskSchema,
} from './schemas'

describe('scheduled task schemas', () => {
  it('trims valid task input and rejects client control of task execution identity', () => {
    expect(createScheduleTaskSchema.parse({
      name: '  Morning brief  ',
      cron: ' 0 9 * * * ',
      timezone: ' Asia/Shanghai ',
      prompt: '  Summarize today.  ',
    })).toEqual({
      name: 'Morning brief',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      prompt: 'Summarize today.',
    })

    expect(createScheduleTaskSchema.safeParse({
      name: 'Morning brief',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Summarize today.',
      agentId: 'writer',
    }).success).toBe(false)
    expect(createScheduleTaskSchema.safeParse({
      name: 'Morning brief',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Summarize today.',
      threadId: 'chat-thread',
    }).success).toBe(false)
  })

  it('uses Intl to validate IANA time zones and keeps pagination bounded', () => {
    expect(isValidScheduleTaskTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidScheduleTaskTimeZone('Not/A-Time-Zone')).toBe(false)
    expect(createScheduleTaskSchema.safeParse({
      name: 'Timezone check',
      cron: '0 9 * * *',
      timezone: 'Not/A-Time-Zone',
      prompt: 'Check the time zone.',
    }).success).toBe(false)

    expect(listScheduleTaskRunsSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(listScheduleTaskRunsSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(listScheduleTaskRunsSchema.safeParse({ cursor: 'bad-cursor' }).success).toBe(false)
    expect(listScheduleTaskRunsSchema.parse({ limit: 100, cursor: '1785968400000' })).toEqual({
      limit: 100,
      cursor: '1785968400000',
    })
  })

  it('requires a non-empty strict update patch', () => {
    expect(updateScheduleTaskSchema.safeParse({}).success).toBe(false)
    expect(updateScheduleTaskSchema.safeParse({ resourceId: 'chat-resource' }).success).toBe(false)
    expect(updateScheduleTaskSchema.parse({ status: 'paused' })).toEqual({ status: 'paused' })
  })
})
