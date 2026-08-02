import fs from 'node:fs'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type {
  ScheduleTaskDto,
  ScheduleTaskRunDto,
  ScheduleTaskRunPageDto,
} from '@shared/schedules/contracts'
import {
  ScheduleTaskServiceError,
  type ScheduleTaskService,
} from '../../schedules/schedule-task.service'
import { createSchedulesRoutes } from './schedules'

const task: ScheduleTaskDto = {
  id: 'schedule-1',
  name: 'Daily briefing',
  agentId: 'scheduled-task',
  cron: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  status: 'active',
  nextFireAt: 1_800_000_000_000,
  lastFireAt: 1_799_900_000_000,
  lastRun: {
    status: 'succeeded',
    finishedAt: 1_799_900_001_000,
    outputPreview: 'Briefing complete.',
  },
}

const run: ScheduleTaskRunDto = {
  id: 'run-1',
  scheduleId: task.id,
  triggerFiredAt: 1_799_900_000_000,
  mastraRunId: 'mastra-run-1',
  triggerKind: 'cron',
  status: 'succeeded',
  outputText: 'Briefing complete.',
  errorMessage: null,
  usageJson: null,
  startedAt: 1_799_900_000_000,
  finishedAt: 1_799_900_001_000,
  createdAt: 1_799_900_000_000,
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    listTasks: vi.fn(async () => [task]),
    getTask: vi.fn(async (id: string) => (id === 'missing' ? null : task)),
    createTask: vi.fn(async () => task),
    updateTask: vi.fn(async () => task),
    pauseTask: vi.fn(async () => ({ ...task, status: 'paused' as const })),
    resumeTask: vi.fn(async () => task),
    runTaskNow: vi.fn(async () => task),
    deleteTask: vi.fn(async () => undefined),
    listTaskRuns: vi.fn(async (): Promise<ScheduleTaskRunPageDto> => ({ items: [run], nextCursor: '1799800000000' })),
    ...overrides,
  }
}

function createApp(service: ReturnType<typeof createService>) {
  const app = new Hono()
  app.route('/api/v1/schedules', createSchedulesRoutes({ service: service as ScheduleTaskService }))
  return app
}

async function requestJson(app: Hono, path: string, init?: RequestInit) {
  const response = await app.request(path, init)
  return { response, body: await response.json() as any }
}

describe('schedule routes', () => {
  it('creates a threadless scheduled task from a valid POST request', async () => {
    const service = createService()
    const { response, body } = await requestJson(createApp(service), '/api/v1/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Daily briefing',
        cron: '0 9 * * *',
        timezone: 'Asia/Shanghai',
        prompt: 'Summarize today\'s project updates.',
      }),
    })

    expect(response.status).toBe(201)
    expect(body).toEqual({ data: task })
    expect(service.createTask).toHaveBeenCalledWith({
      name: 'Daily briefing',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      prompt: 'Summarize today\'s project updates.',
    })
  })

  it.each([
    ['cron', { name: 'Daily briefing', cron: 'not-a-cron', timezone: 'Asia/Shanghai', prompt: 'Summarize updates.' }, 'SCHEDULE_INVALID_CRON'],
    ['timezone', { name: 'Daily briefing', cron: '0 9 * * *', timezone: 'Mars/Olympus', prompt: 'Summarize updates.' }, 'SCHEDULE_INVALID_TIMEZONE'],
    ['prompt', { name: 'Daily briefing', cron: '0 9 * * *', timezone: 'Asia/Shanghai', prompt: '' }, 'SCHEDULE_INVALID_INPUT'],
  ])('maps invalid %s requests to HTTP 400', async (_field, input, code) => {
    const service = createService({
      createTask: vi.fn(async () => {
        throw new ScheduleTaskServiceError(code as 'SCHEDULE_INVALID_CRON' | 'SCHEDULE_INVALID_TIMEZONE' | 'SCHEDULE_INVALID_INPUT', 'Invalid scheduled task input.')
      }),
    })

    const { response, body } = await requestJson(createApp(service), '/api/v1/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    expect(response.status).toBe(400)
    expect(body.error).toMatchObject({ code, message: 'Invalid scheduled task input.' })
  })

  it('lists task DTOs with their latest-run summaries', async () => {
    const service = createService()
    const { response, body } = await requestJson(createApp(service), '/api/v1/schedules')

    expect(response.status).toBe(200)
    expect(body).toEqual({ data: { items: [task] } })
    expect(body.data.items[0].lastRun).toEqual(task.lastRun)
    expect(service.listTasks).toHaveBeenCalledOnce()
  })

  it('delegates pause, resume, and async run commands to the service', async () => {
    const service = createService()
    const app = createApp(service)

    const paused = await requestJson(app, '/api/v1/schedules/schedule-1/pause', { method: 'POST' })
    const resumed = await requestJson(app, '/api/v1/schedules/schedule-1/resume', { method: 'POST' })
    const runRequested = await requestJson(app, '/api/v1/schedules/schedule-1/run', { method: 'POST' })

    expect(paused.response.status).toBe(200)
    expect(paused.body.data.status).toBe('paused')
    expect(resumed.response.status).toBe(200)
    expect(runRequested.response.status).toBe(202)
    expect(runRequested.body).toEqual({
      data: task,
      message: 'Scheduled task execution was requested. Poll /runs for the result.',
    })
    expect(service.pauseTask).toHaveBeenCalledWith('schedule-1')
    expect(service.resumeTask).toHaveBeenCalledWith('schedule-1')
    expect(service.runTaskNow).toHaveBeenCalledWith('schedule-1')
  })

  it('returns paginated task runs and passes cursor pagination to the service', async () => {
    const service = createService()
    const { response, body } = await requestJson(createApp(service), '/api/v1/schedules/schedule-1/runs?limit=25&cursor=1799800000000')

    expect(response.status).toBe(200)
    expect(body).toEqual({ data: { items: [run], nextCursor: '1799800000000' } })
    expect(service.listTaskRuns).toHaveBeenCalledWith('schedule-1', {
      limit: 25,
      cursor: '1799800000000',
    })
  })

  it('returns 404 when a scheduled task ID does not exist', async () => {
    const service = createService()
    const { response, body } = await requestJson(createApp(service), '/api/v1/schedules/missing')

    expect(response.status).toBe(404)
    expect(body).toEqual({
      error: {
        code: 'SCHEDULE_NOT_FOUND',
        message: 'Scheduled task was not found.',
        scheduleId: 'missing',
      },
    })
  })

  it('has no Chat session or message persistence dependencies', () => {
    const source = fs.readFileSync(new URL('./schedules.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from\s+['"][^'"]*(?:chat|sessions|message)[^'"]*['"]/i)
    expect(source).not.toMatch(/mastra\.schedules/i)
  })
})
