import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScheduleTaskForm } from './ScheduleTaskForm'
import {
  hasScheduleTaskFormErrors,
  normalizeScheduleTaskForm,
  SCHEDULE_CRON_TEMPLATES,
  validateScheduleTaskForm,
} from './schedule-task.types'

describe('ScheduleTaskForm', () => {
  it('provides common cron templates and the advanced cron input', () => {
    const markup = renderToStaticMarkup(<ScheduleTaskForm saving={false} onSubmit={() => undefined} onCancel={() => undefined} />)

    expect(SCHEDULE_CRON_TEMPLATES).toHaveLength(4)
    expect(markup).toContain('每天上午 9:00')
    expect(markup).toContain('高级 Cron 表达式')
    expect(markup).toContain('IANA 时区')
    expect(markup).toContain('任务提示词')
  })

  it('normalizes valid task input and reports required fields for a new task', () => {
    const valid = normalizeScheduleTaskForm({
      name: '  每日项目简报  ', cron: ' 0 9 * * * ', timezone: ' Asia/Shanghai ', prompt: '  汇总项目动态。 ',
    })

    expect(valid).toEqual({ name: '每日项目简报', cron: '0 9 * * *', timezone: 'Asia/Shanghai', prompt: '汇总项目动态。' })
    expect(hasScheduleTaskFormErrors(validateScheduleTaskForm(valid))).toBe(false)
    expect(validateScheduleTaskForm({ name: '', cron: '', timezone: '', prompt: '' })).toEqual({
      name: '请输入任务名称。', cron: '请输入 Cron 表达式。', timezone: '请输入 IANA 时区，例如 Asia/Shanghai。', prompt: '请输入任务提示词。',
    })
  })

  it('allows an edit to retain the server-side prompt when the prompt field is blank', () => {
    expect(validateScheduleTaskForm({ name: '任务', cron: '0 9 * * *', timezone: 'Asia/Shanghai', prompt: '' }, { requirePrompt: false })).toEqual({})
  })
})
