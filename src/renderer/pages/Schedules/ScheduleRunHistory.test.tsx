import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ScheduleTaskRunDto } from '@shared/schedules/contracts'
import { runOutputText, ScheduleRunHistory } from './ScheduleRunHistory'

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

describe('ScheduleRunHistory', () => {
  it('renders successful Markdown output and a copy action', () => {
    const markup = renderToStaticMarkup(<ScheduleRunHistory runs={[succeeded]} nextCursor={null} onRefresh={() => undefined} onLoadMore={() => undefined} />)

    expect(markup).toContain('<strong>项目简报</strong>')
    expect(markup).toContain('已完成发布')
    expect(markup).toContain('复制输出')
    expect(runOutputText({ ...succeeded, outputText: '   ' })).toBe('本次任务没有返回可展示的文本输出。')
  })

  it('renders failures and a pagination action', () => {
    const markup = renderToStaticMarkup(<ScheduleRunHistory runs={[failed]} nextCursor="123" onRefresh={() => undefined} onLoadMore={() => undefined} />)

    expect(markup).toContain('Provider request timed out.')
    expect(markup).toContain('加载更多记录')
  })
})
