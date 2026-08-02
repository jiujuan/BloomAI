import type { AgentSchedule, AnySchedule } from '@mastra/core/schedules'
import type { ScheduledTaskRun } from '../db/repositories/scheduled-task-run.repo'
import { SCHEDULE_TASK_SCHEMA_VERSION, SCHEDULE_TASK_SURFACE } from '../mastra/schedules/hooks'
import { SCHEDULED_TASK_AGENT_ID } from '../mastra/schedules/scheduled-task-agent'
import { describe, expect, it, vi } from 'vitest'
import {
  createScheduleTaskService,
  type ScheduleGateway,
  type ScheduleTaskLogger,
  type ScheduleTaskRunRepository,
} from './schedule-task.service'

function ownedSchedule(overrides: Partial<AgentSchedule> = {}): AgentSchedule {
  return {
    id: 'agent_morning-brief',
    agentId: SCHEDULED_TASK_AGENT_ID,
    name: 'Morning brief',
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    prompt: 'Create a morning brief.',
    status: 'active',
    nextFireAt: 1_786_054_800_000,
    lastFireAt: 1_785_968_400_000,
    metadata: {
      surface: SCHEDULE_TASK_SURFACE,
      schemaVersion: SCHEDULE_TASK_SCHEMA_VERSION,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function taskRun(overrides: Partial<ScheduledTaskRun> = {}): ScheduledTaskRun {
  return {
    id: 'run-1',
    scheduleId: 'agent_morning-brief',
    triggerFiredAt: 1_785_968_400_000,
    mastraRunId: 'mastra-run-1',
    triggerKind: 'cron',
    status: 'succeeded',
    outputText: 'Today is a good day for a concise task result.',
    errorMessage: null,
    usageJson: '{"inputTokens":10}',
    startedAt: 1_785_968_400_000,
    finishedAt: 1_785_968_404_321,
    createdAt: 1_785_968_404_321,
    ...overrides,
  }
}

function createGateway(overrides: Partial<ScheduleGateway['schedules']> = {}): ScheduleGateway {
  return {
    schedules: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      create: vi.fn(async () => ownedSchedule()),
      update: vi.fn(async () => ownedSchedule()),
      pause: vi.fn(async () => ownedSchedule({ status: 'paused' })),
      resume: vi.fn(async () => ownedSchedule({ status: 'active' })),
      run: vi.fn(async (id) => ({ scheduleId: id, claimId: 'claim-1', scheduledFireAt: Date.now() })),
      delete: vi.fn(async () => undefined),
      ...overrides,
    },
  }
}

function createRunRepository(overrides: Partial<ScheduleTaskRunRepository> = {}): ScheduleTaskRunRepository {
  return {
    getLatestByScheduleIds: vi.fn(() => new Map()),
    listByScheduleId: vi.fn(() => ({ data: [], nextCursor: null })),
    deleteByScheduleId: vi.fn(() => 0),
    ...overrides,
  }
}

const noopLogger: ScheduleTaskLogger = { error: vi.fn() }

describe('ScheduleTaskService', () => {
  it('creates a threadless task with the fixed agent and controlled metadata', async () => {
    const gateway = createGateway()
    const service = createScheduleTaskService({ gateway, taskRunRepository: createRunRepository(), logger: noopLogger })

    await expect(service.createTask({
      name: '  Morning brief ',
      cron: ' 0 9 * * * ',
      timezone: ' Asia/Shanghai ',
      prompt: '  Create a brief. ',
    })).resolves.toMatchObject({
      agentId: SCHEDULED_TASK_AGENT_ID,
      name: 'Morning brief',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
    })

    expect(gateway.schedules.create).toHaveBeenCalledWith({
      agentId: SCHEDULED_TASK_AGENT_ID,
      name: 'Morning brief',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      prompt: 'Create a brief.',
      metadata: {
        surface: SCHEDULE_TASK_SURFACE,
        schemaVersion: SCHEDULE_TASK_SCHEMA_VERSION,
      },
    })
    expect(gateway.schedules.create).not.toHaveBeenCalledWith(expect.objectContaining({
      threadId: expect.anything(),
      resourceId: expect.anything(),
    }))
  })

  it('uses one batch lookup for latest runs and hides schedules outside the BloomAI namespace', async () => {
    const second = ownedSchedule({ id: 'agent_evening-brief', name: 'Evening brief' })
    const foreign = ownedSchedule({
      id: 'agent_foreign',
      metadata: { surface: 'other-product', schemaVersion: 1 },
    })
    const workflow: AnySchedule = {
      id: 'workflow_1',
      workflowId: 'workflow-1',
      cron: '0 9 * * *',
      status: 'active',
      nextFireAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }
    const latest = new Map([[second.id, taskRun({ scheduleId: second.id, outputText: 'Finished evening task.' })]])
    const runRepository = createRunRepository({ getLatestByScheduleIds: vi.fn(() => latest) })
    const gateway = createGateway({ list: vi.fn(async () => [ownedSchedule(), second, foreign, workflow]) })
    const service = createScheduleTaskService({ gateway, taskRunRepository: runRepository, logger: noopLogger })

    await expect(service.listTasks()).resolves.toEqual([
      expect.objectContaining({ id: 'agent_morning-brief', lastRun: null }),
      expect.objectContaining({ id: 'agent_evening-brief', lastRun: {
        status: 'succeeded',
        finishedAt: 1_785_968_404_321,
        outputPreview: 'Finished evening task.',
      } }),
    ])
    expect(runRepository.getLatestByScheduleIds).toHaveBeenCalledTimes(1)
    expect(runRepository.getLatestByScheduleIds).toHaveBeenCalledWith(['agent_morning-brief', 'agent_evening-brief'])
  })

  it('rejects invalid input and maps Mastra cron failures without accepting agent, thread, or resource overrides', async () => {
    const gateway = createGateway({
      create: vi.fn(async () => { throw new Error('Invalid cron expression "bad cron": parser failed') }),
    })
    const service = createScheduleTaskService({ gateway, taskRunRepository: createRunRepository(), logger: noopLogger })

    await expect(service.createTask({
      name: 'Bad timezone',
      cron: '0 9 * * *',
      timezone: 'Not/A-Time-Zone',
      prompt: 'Test timezone.',
    })).rejects.toMatchObject({ code: 'SCHEDULE_INVALID_TIMEZONE' })
    await expect(service.createTask({
      name: 'Forbidden fields',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Test isolation.',
      agentId: 'writer',
      threadId: 'chat-thread',
      resourceId: 'chat-resource',
    } as never)).rejects.toMatchObject({ code: 'SCHEDULE_INVALID_INPUT' })
    await expect(service.createTask({
      name: 'Invalid cron',
      cron: 'bad cron',
      timezone: 'UTC',
      prompt: 'Test cron.',
    })).rejects.toMatchObject({ code: 'SCHEDULE_INVALID_CRON' })
    expect(gateway.schedules.create).toHaveBeenCalledTimes(1)
  })

  it('delegates update, pause, resume, and manual execution only after confirming ownership', async () => {
    const current = ownedSchedule()
    const updated = ownedSchedule({ name: 'Updated brief', status: 'paused' })
    const gateway = createGateway({
      get: vi.fn(async () => current),
      update: vi.fn(async () => updated),
      pause: vi.fn(async () => ownedSchedule({ status: 'paused' })),
      resume: vi.fn(async () => ownedSchedule({ status: 'active' })),
    })
    const service = createScheduleTaskService({ gateway, taskRunRepository: createRunRepository(), logger: noopLogger })

    await expect(service.updateTask(current.id, { name: ' Updated brief ', status: 'paused' })).resolves.toMatchObject({ name: 'Updated brief', status: 'paused' })
    await expect(service.pauseTask(current.id)).resolves.toMatchObject({ status: 'paused' })
    await expect(service.resumeTask(current.id)).resolves.toMatchObject({ status: 'active' })
    await expect(service.runTaskNow(current.id)).resolves.toMatchObject({ id: current.id })

    expect(gateway.schedules.update).toHaveBeenCalledWith(current.id, { name: 'Updated brief', status: 'paused' })
    expect(gateway.schedules.pause).toHaveBeenCalledWith(current.id)
    expect(gateway.schedules.resume).toHaveBeenCalledWith(current.id)
    expect(gateway.schedules.run).toHaveBeenCalledWith(current.id)
  })

  it('deletes the native schedule before run history and returns a diagnostic failure if cleanup fails', async () => {
    const events: string[] = []
    const logger: ScheduleTaskLogger = { error: vi.fn() }
    const gateway = createGateway({
      get: vi.fn(async () => ownedSchedule()),
      delete: vi.fn(async () => { events.push('mastra-delete') }),
    })
    const runRepository = createRunRepository({
      deleteByScheduleId: vi.fn(() => { events.push('runs-delete'); return 2 }),
    })
    const service = createScheduleTaskService({ gateway, taskRunRepository: runRepository, logger })

    await expect(service.deleteTask('agent_morning-brief')).resolves.toBeUndefined()
    expect(events).toEqual(['mastra-delete', 'runs-delete'])

    const failingRepository = createRunRepository({ deleteByScheduleId: vi.fn(() => { throw new Error('database locked') }) })
    const failingService = createScheduleTaskService({ gateway, taskRunRepository: failingRepository, logger })
    await expect(failingService.deleteTask('agent_morning-brief')).rejects.toMatchObject({ code: 'SCHEDULE_OPERATION_FAILED' })
    expect(logger.error).toHaveBeenCalledWith(
      'Scheduled task was deleted from Mastra but its run history cleanup failed.',
      expect.objectContaining({ scheduleId: 'agent_morning-brief', severity: 'high' }),
    )
  })

  it('maps isolated application run history and rejects non-owned schedules', async () => {
    const run = taskRun({ triggerKind: 'manual', status: 'failed', outputText: null, errorMessage: 'Model unavailable.' })
    const gateway = createGateway({ get: vi.fn(async () => ownedSchedule()) })
    const runRepository = createRunRepository({ listByScheduleId: vi.fn(() => ({ data: [run], nextCursor: '1785968400000' })) })
    const service = createScheduleTaskService({ gateway, taskRunRepository: runRepository, logger: noopLogger })

    await expect(service.listTaskRuns('agent_morning-brief', { limit: 50, cursor: '1785968404321' })).resolves.toEqual({
      items: [{
        id: run.id,
        scheduleId: run.scheduleId,
        triggerFiredAt: run.triggerFiredAt,
        mastraRunId: run.mastraRunId,
        triggerKind: 'manual',
        status: 'failed',
        outputText: null,
        errorMessage: 'Model unavailable.',
        usageJson: run.usageJson,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
      }],
      nextCursor: '1785968400000',
    })
    expect(runRepository.listByScheduleId).toHaveBeenCalledWith('agent_morning-brief', { limit: 50, cursor: '1785968404321' })

    const foreignGateway = createGateway({ get: vi.fn(async () => ownedSchedule({ metadata: { surface: 'other-product', schemaVersion: 1 } })) })
    const foreignService = createScheduleTaskService({ gateway: foreignGateway, taskRunRepository: createRunRepository(), logger: noopLogger })
    await expect(foreignService.pauseTask('agent_morning-brief')).rejects.toMatchObject({ code: 'SCHEDULE_NOT_FOUND' })
  })
})
