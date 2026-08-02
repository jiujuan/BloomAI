import { API_BASE } from '@shared/constants'
import type {
  CreateScheduleTaskInput,
  ListScheduleTaskRunsInput,
  ScheduleTaskDto,
  ScheduleTaskListDto,
  ScheduleTaskRunPageDto,
  UpdateScheduleTaskInput,
} from '@shared/schedules/contracts'

export class ScheduleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message)
    this.name = 'ScheduleApiError'
  }
}

type ApiEnvelope<T> = { data: T }
type ScheduleRunRequestResponse = ApiEnvelope<ScheduleTaskDto> & { message?: string }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/schedules${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new ScheduleApiError(
      body.error?.message || `HTTP ${response.status}`,
      response.status,
      body.error?.code,
    )
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

/** Threadless scheduled-task API client. It intentionally does not use Chat transport. */
export const schedulesApi = {
  async listTasks(): Promise<ScheduleTaskDto[]> {
    const { data } = await request<ApiEnvelope<ScheduleTaskListDto>>('')
    return data.items
  },

  async getTask(id: string): Promise<ScheduleTaskDto> {
    const { data } = await request<ApiEnvelope<ScheduleTaskDto>>(`/${encodeURIComponent(id)}`)
    return data
  },

  async createTask(input: CreateScheduleTaskInput): Promise<ScheduleTaskDto> {
    const { data } = await request<ApiEnvelope<ScheduleTaskDto>>('', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return data
  },

  async updateTask(id: string, input: UpdateScheduleTaskInput): Promise<ScheduleTaskDto> {
    const { data } = await request<ApiEnvelope<ScheduleTaskDto>>(`/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return data
  },

  async deleteTask(id: string): Promise<void> {
    await request<void>(`/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async pauseTask(id: string): Promise<ScheduleTaskDto> {
    const { data } = await request<ApiEnvelope<ScheduleTaskDto>>(`/${encodeURIComponent(id)}/pause`, { method: 'POST' })
    return data
  },

  async resumeTask(id: string): Promise<ScheduleTaskDto> {
    const { data } = await request<ApiEnvelope<ScheduleTaskDto>>(`/${encodeURIComponent(id)}/resume`, { method: 'POST' })
    return data
  },

  async runTaskNow(id: string): Promise<{ task: ScheduleTaskDto; message: string | undefined }> {
    const response = await request<ScheduleRunRequestResponse>(`/${encodeURIComponent(id)}/run`, { method: 'POST' })
    return { task: response.data, message: response.message }
  },

  async listTaskRuns(id: string, options: ListScheduleTaskRunsInput = {}): Promise<ScheduleTaskRunPageDto> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.cursor) query.set('cursor', options.cursor)
    const suffix = query.size ? `?${query.toString()}` : ''
    const { data } = await request<ApiEnvelope<ScheduleTaskRunPageDto>>(`/${encodeURIComponent(id)}/runs${suffix}`)
    return data
  },
}

export function scheduleErrorMessage(error: unknown): string {
  if (error instanceof ScheduleApiError) return error.message
  if (error instanceof Error) return error.message
  return '定时任务操作失败，请稍后重试。'
}
