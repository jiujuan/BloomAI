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

const renderHistory = (overrides: Partial<React.ComponentProps<typeof ScheduleRunHistory>> = {}) => renderToStaticMarkup(
  <ScheduleRunHistory
    runs={[succeeded]}
    nextCursor={null}
    previousCursor={undefined}
    page={1}
    loading={false}
    onRefresh={() => undefined}
    onLoadPage={() => undefined}
    onViewDetail={() => undefined}
    {...overrides}
  />,
)

describe('ScheduleRunHistory', () => {
  it('renders the required table columns, colored statuses, and detail action', () => {
    const markup = renderHistory()

    expect(markup).toContain('结果状态')
    expect(markup).toContain('运行状态')
    expect(markup).toContain('执行时间')
    expect(markup).toContain('操作')
    expect(markup).toContain('成功')
    expect(markup).toContain('已完成')
    expect(markup).toContain('详情')
    expect(markup).toContain('type="button"')
    expect(runOutputText({ ...succeeded, outputText: '   ' })).toBe('本次任务没有返回可展示的文本输出。')
  })

  it('renders the required empty state in a table row', () => {
    const markup = renderHistory({ runs: [] })

    expect(markup).toContain('还没开始执行定时任务')
    expect(markup).toContain('colSpan="4"')
  })

  it('renders running status and previous/next pagination controls', () => {
    const running = { ...failed, id: 'run-running', status: 'succeeded' as const, finishedAt: null, errorMessage: null, outputText: 'still working' }
    const markup = renderHistory({ runs: [running], nextCursor: 'next-cursor', previousCursor: 'previous-cursor', page: 2 })

    expect(markup).toContain('运行中')
    expect(markup).toContain('第 2 页')
    expect(markup).toContain('上一页')
    expect(markup).toContain('下一页')
    expect(markup).not.toContain('disabled=""')
  })
})
