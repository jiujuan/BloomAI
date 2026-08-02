import { Hono, type Context } from 'hono'
import type {
  CreateScheduleTaskInput,
  ListScheduleTaskRunsInput,
  UpdateScheduleTaskInput,
} from '@shared/schedules/contracts'
import {
  ScheduleTaskServiceError,
  scheduleTaskService,
  type ScheduleTaskService,
} from '../../schedules/schedule-task.service'
import { readJson } from '../util'

export interface CreateSchedulesRoutesOptions {
  service?: ScheduleTaskService
}

/**
 * HTTP adapter for threadless scheduled task sessions. All schedule lifecycle
 * work is delegated to ScheduleTaskService; this route never touches Chat,
 * Drizzle repositories, or Mastra's schedules API directly.
 */
export function createSchedulesRoutes(options: CreateSchedulesRoutesOptions = {}): Hono {
  const service = options.service ?? scheduleTaskService
  const routes = new Hono()

  routes.get('/', async (c) => {
    try {
      return c.json({ data: { items: await service.listTasks() } })
    } catch (error) {
      return routeError(c, error)
    }
  })

  routes.post('/', async (c) => {
    try {
      const task = await service.createTask(await readJson<CreateScheduleTaskInput>(c))
      return c.json({ data: task }, 201)
    } catch (error) {
      return routeError(c, error)
    }
  })

  routes.get('/:id/runs', async (c) => {
    try {
      const page = await service.listTaskRuns(c.req.param('id'), readRunListOptions(c.req.query()))
      return c.json({ data: page })
    } catch (error) {
      return routeError(c, error)
    }
  })

  routes.post('/:id/pause', async (c) => {
    try {
      return c.json({ data: await service.pauseTask(c.req.param('id')) })
    } catch (error) {
      return routeError(c, error)
    }
  })

  routes.post('/:id/resume', async (c) => {
    try {
      return c.json({ data: await service.resumeTask(c.req.param('id')) })
    } catch (error) {
      return routeError(c, error)
    }
  })

  routes.post('/:id/run', async (c) => {
    try {
      const task = await service.runTaskNow(c.req.param('id'))
      return c.json({
        data: task,
        message: 'Scheduled task execution was requested. Poll /runs for the result.',
      }, 202)
    } catch (error) {
      return routeError(c, error)
    }
  })

  routes.get('/:id', async (c) => {
    try {
      const task = await service.getTask(c.req.param('id'))
      if (!task) {
        return scheduleNotFound(c, c.req.param('id'))
      }
      return c.json({ data: task })
    } catch (error) {
      return routeError(c, error)
    }
  })

  routes.patch('/:id', async (c) => {
    try {
      const task = await service.updateTask(c.req.param('id'), await readJson<UpdateScheduleTaskInput>(c))
      return c.json({ data: task })
    } catch (error) {
      return routeError(c, error)
    }
  })

  routes.delete('/:id', async (c) => {
    try {
      await service.deleteTask(c.req.param('id'))
      return c.body(null, 204)
    } catch (error) {
      return routeError(c, error)
    }
  })

  return routes
}

export const schedulesRoutes = createSchedulesRoutes()

function readRunListOptions(query: Record<string, string | undefined>): ListScheduleTaskRunsInput {
  const limit = query.limit
  const cursor = query.cursor
  return {
    ...(limit === undefined ? {} : { limit: Number(limit) }),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

function scheduleNotFound(c: Context, scheduleId: string) {
  return c.json({
    error: {
      code: 'SCHEDULE_NOT_FOUND',
      message: 'Scheduled task was not found.',
      scheduleId,
    },
  }, 404)
}

function routeError(c: Context, error: unknown) {
  if (error instanceof ScheduleTaskServiceError) {
    const status = statusForScheduleError(error.code)
    return c.json({
      error: {
        code: error.code,
        message: error.message,
        ...error.details,
      },
    }, status)
  }

  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
}

function statusForScheduleError(code: ScheduleTaskServiceError['code']): 400 | 404 | 409 | 500 {
  switch (code) {
    case 'SCHEDULE_INVALID_CRON':
    case 'SCHEDULE_INVALID_TIMEZONE':
    case 'SCHEDULE_INVALID_INPUT':
      return 400
    case 'SCHEDULE_NOT_FOUND':
      return 404
    case 'SCHEDULE_EXECUTION_UNAVAILABLE':
      return 409
    case 'SCHEDULE_OPERATION_FAILED':
      return 500
  }
}
