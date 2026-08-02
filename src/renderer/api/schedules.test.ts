import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@shared/constants'
import { ScheduleApiError, schedulesApi } from './schedules'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('schedulesApi', () => {
  it('uses the dedicated schedules HTTP surface for list and run history requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { items: [] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [], nextCursor: null } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(schedulesApi.listTasks()).resolves.toEqual([])
    await expect(schedulesApi.listTaskRuns('task/a', { limit: 25, cursor: '100' })).resolves.toEqual({ items: [], nextCursor: null })

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/schedules`, expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/schedules/task%2Fa/runs?limit=25&cursor=100`, expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }))
  })

  it('sends mutation requests and converts the HTTP error envelope to a displayable error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'task-1' } }, 202))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'SCHEDULE_INVALID_CRON', message: 'Invalid cron.' } }, 400))
    vi.stubGlobal('fetch', fetchMock)

    await expect(schedulesApi.runTaskNow('task-1')).resolves.toEqual({ task: { id: 'task-1' }, message: undefined })
    await expect(schedulesApi.createTask({ name: '任务', cron: 'bad', timezone: 'Asia/Shanghai', prompt: '执行任务' }))
      .rejects.toEqual(expect.objectContaining<Partial<ScheduleApiError>>({ name: 'ScheduleApiError', status: 400, code: 'SCHEDULE_INVALID_CRON', message: 'Invalid cron.' }))

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/schedules/task-1/run`, expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/schedules`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '任务', cron: 'bad', timezone: 'Asia/Shanghai', prompt: '执行任务' }) }))
  })
})
