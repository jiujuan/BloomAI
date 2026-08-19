import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScheduleTaskDto, ScheduleTaskRunDto } from '@shared/schedules/contracts'
import { ScheduleRunDetail } from './ScheduleRunDetail'
import { SchedulesPage } from './SchedulesPage'
import { ScheduleTaskDetail } from './ScheduleTaskDetail'
import { ScheduleTaskList } from './ScheduleTaskList'
import { initialScheduleTaskState, useScheduleTaskStore } from './schedule-task.store'

const task: ScheduleTaskDto = {
  id: 'schedule-1', name: '每日项目简报', agentId: 'scheduled-task', cron: '0 9 * * 1-5', timezone: 'Asia/Shanghai', status: 'active',
  nextFireAt: 1_800_000_000_000, lastFireAt: 1_799_900_000_000,
  lastRun: { status: 'succeeded', finishedAt: 1_799_900_001_000, outputPreview: '已生成项目简报。' },
}

const run: ScheduleTaskRunDto = {
  id: 'run-1', scheduleId: task.id, triggerFiredAt: 1_799_900_000_000, mastraRunId: 'run-mastra-1', triggerKind: 'cron', status: 'succeeded',
  outputText: '已生成项目简报。', errorMessage: null, usageJson: null, startedAt: 1_799_900_000_000, finishedAt: 1_799_900_001_000, createdAt: 1_799_900_000_000,
}

afterEach(() => {
  useScheduleTaskStore.setState({ ...initialScheduleTaskState })
})

describe('SchedulesPage', () => {
  it('renders an independent task list, its state, summary cards, and the run list by default', () => {
    const pageMarkup = renderToStaticMarkup(<SchedulesPage />)
    const taskMarkup = renderToStaticMarkup(
      <>
        <ScheduleTaskList tasks={[task]} selectedTaskId={task.id} loading={false} onSelect={() => undefined} onCreate={() => undefined} />
        <ScheduleTaskDetail
          task={task}
          runs={[run]}
          nextCursor={null}
          previousCursor={undefined}
          runPage={1}
          runsLoading={false}
          saving={false}
          runningNow={false}
          onEdit={() => undefined}
          onPause={() => undefined}
          onResume={() => undefined}
          onRunNow={() => undefined}
          onDelete={() => undefined}
          onRefreshRuns={() => undefined}
          onLoadPage={() => undefined}
        />
      </>,
    )

    expect(pageMarkup).toContain('任务仅在 BloomAI 运行期间执行。')
    expect(taskMarkup).toContain('每日项目简报')
    expect(taskMarkup).toContain('运行中')
    expect(taskMarkup).toContain('状态')
    expect(taskMarkup).toContain('下次执行')
    expect(taskMarkup).toContain('上次触发')
    expect(taskMarkup).toContain('最近结果')
    expect(taskMarkup).toContain('结果状态')
    expect(taskMarkup).toContain('运行状态')
    expect(taskMarkup).toContain('执行时间')
    expect(taskMarkup).toContain('操作')
    expect(taskMarkup).toContain('详情')
    expect(taskMarkup).not.toContain('已生成项目简报。')
  })

  it('renders the selected execution detail separately with a return action', () => {
    const markup = renderToStaticMarkup(<ScheduleRunDetail run={run} onBack={() => undefined} />)

    expect(markup).toContain('执行详情')
    expect(markup).toContain('返回')
    expect(markup).toContain('已生成项目简报。')
  })

  it('renders an empty state without any Chat session surface', () => {
    const markup = renderToStaticMarkup(<SchedulesPage />)

    expect(markup).toContain('暂无定时任务')
    expect(markup).toContain('创建独立定时任务')
    expect(markup).not.toContain('ChatPanelMastra')
    expect(markup).not.toContain('SessionList')
  })

  it('does not import or render Chat session/message components', () => {
    const source = fs.readFileSync(new URL('./SchedulesPage.tsx', import.meta.url), 'utf8')

    expect(source).not.toMatch(/ChatPanelMastra|SessionList|useChatStore|messageRepo|sessionRepo/)
    expect(source).toContain('role="status"')
  })
})
