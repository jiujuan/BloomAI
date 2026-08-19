import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ScheduleTaskRunDto } from '@shared/schedules/contracts'
import { ScheduleRunDetail } from './ScheduleRunDetail'

const succeeded: ScheduleTaskRunDto = {
  id: 'run-success', scheduleId: 'schedule-1', triggerFiredAt: 1, mastraRunId: 'mastra-run-1', triggerKind: 'manual', status: 'succeeded',
  outputText: '**项目简报**\n\n- 已完成发布', errorMessage: null, usageJson: null, startedAt: 1, finishedAt: 2, createdAt: 1,
}

const failed: ScheduleTaskRunDto = {
  ...succeeded,
  id: 'run-failed',
  status: 'failed',
  outputText: null,
  errorMessage: 'Provider request timed out.',
}

describe('ScheduleRunDetail', () => {
  it('renders the current execution output and a return action', () => {
    const markup = renderToStaticMarkup(<ScheduleRunDetail run={succeeded} onBack={() => undefined} />)

    expect(markup).toContain('返回')
    expect(markup).toContain('成功')
    expect(markup).toContain('手动执行')
    expect(markup).toContain('项目简报')
    expect(markup).toContain('已完成发布')
    expect(markup).toContain('复制输出')
  })

  it('renders execution errors instead of output for failed runs', () => {
    const markup = renderToStaticMarkup(<ScheduleRunDetail run={failed} onBack={() => undefined} />)

    expect(markup).toContain('失败')
    expect(markup).toContain('Provider request timed out.')
  })
})
