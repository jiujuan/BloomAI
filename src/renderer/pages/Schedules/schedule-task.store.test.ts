import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleTaskDto, ScheduleTaskRunDto } from '@shared/schedules/contracts'

const api = vi.hoisted(() => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  runTaskNow: vi.fn(),
  deleteTask: vi.fn(),
  listTaskRuns: vi.fn(),
}))

vi.mock('@renderer/api/schedules', () => ({
  schedulesApi: api,
  scheduleErrorMessage: (error: unknown) => error instanceof Error ? error.message : '定时任务操作失败，请稍后重试。',
}))

import { initialScheduleTaskState, useScheduleTaskStore } from './schedule-task.store'

const task: ScheduleTaskDto = {
  id: 'task-1', name: '每日简报', agentId: 'scheduled-task', cron: '0 9 * * *', timezone: 'Asia/Shanghai', status: 'active',
  nextFireAt: null, lastFireAt: null, lastRun: null,
}

const run: ScheduleTaskRunDto = {
  id: 'run-1', scheduleId: task.id, triggerFiredAt: 1, mastraRunId: null, triggerKind: 'manual', status: 'succeeded',
  outputText: 'done', errorMessage: null, usageJson: null, startedAt: 1, finishedAt: 2, createdAt: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  useScheduleTaskStore.setState({ ...initialScheduleTaskState })
})

describe('useScheduleTaskStore', () => {
  it('loads independent tasks and selects the first task', async () => {
    api.listTasks.mockResolvedValue([task])

    await useScheduleTaskStore.getState().loadTasks()

    expect(useScheduleTaskStore.getState()).toMatchObject({ tasks: [task], selectedTaskId: task.id, loading: false, error: null })
    expect(api.listTasks).toHaveBeenCalledOnce()
  })

  it('creates a task, refreshes the list, and selects the newly created task', async () => {
    api.createTask.mockResolvedValue(task)
    api.listTasks.mockResolvedValue([task])

    await expect(useScheduleTaskStore.getState().createTask({ name: '每日简报', cron: '0 9 * * *', timezone: 'Asia/Shanghai', prompt: '汇总项目动态。' })).resolves.toEqual(task)

    expect(api.createTask).toHaveBeenCalledWith({ name: '每日简报', cron: '0 9 * * *', timezone: 'Asia/Shanghai', prompt: '汇总项目动态。' })
    expect(api.listTasks).toHaveBeenCalledOnce()
    expect(useScheduleTaskStore.getState().selectedTaskId).toBe(task.id)
  })

  it('delegates pause, resume, and run-now while refreshing run history', async () => {
    useScheduleTaskStore.setState({ ...initialScheduleTaskState, tasks: [task], selectedTaskId: task.id })
    const paused = { ...task, status: 'paused' as const }
    api.pauseTask.mockResolvedValue(paused)
    api.resumeTask.mockResolvedValue(task)
    api.runTaskNow.mockResolvedValue({ task, message: 'queued' })
    api.listTasks.mockResolvedValue([task])
    api.listTaskRuns.mockResolvedValue({ items: [run], nextCursor: null })

    await expect(useScheduleTaskStore.getState().pauseTask(task.id)).resolves.toEqual(paused)
    await expect(useScheduleTaskStore.getState().resumeTask(task.id)).resolves.toEqual(task)
    await expect(useScheduleTaskStore.getState().runTaskNow(task.id)).resolves.toEqual(task)

    expect(api.pauseTask).toHaveBeenCalledWith(task.id)
    expect(api.resumeTask).toHaveBeenCalledWith(task.id)
    expect(api.runTaskNow).toHaveBeenCalledWith(task.id)
    expect(api.listTaskRuns).toHaveBeenCalledWith(task.id, { limit: 25 })
    expect(useScheduleTaskStore.getState().runsByTaskId[task.id]).toEqual([run])
  })

  it('requires API confirmation before local task removal and surfaces API errors', async () => {
    useScheduleTaskStore.setState({ ...initialScheduleTaskState, tasks: [task], selectedTaskId: task.id, runsByTaskId: { [task.id]: [run] } })
    api.deleteTask.mockResolvedValue(undefined)

    await expect(useScheduleTaskStore.getState().deleteTask(task.id)).resolves.toBe(true)
    expect(useScheduleTaskStore.getState()).toMatchObject({ tasks: [], selectedTaskId: null, runsByTaskId: {} })

    api.listTasks.mockRejectedValue(new Error('Network unavailable'))
    await useScheduleTaskStore.getState().loadTasks()
    expect(useScheduleTaskStore.getState().error).toBe('Network unavailable')
  })
})
