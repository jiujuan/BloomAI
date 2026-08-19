import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type {
  CreateScheduleTaskInput,
  ScheduleTaskDto,
  ScheduleTaskRunDto,
  UpdateScheduleTaskInput,
} from '@shared/schedules/contracts'
import { scheduleErrorMessage, schedulesApi } from '@renderer/api/schedules'

export interface ScheduleTaskState {
  tasks: ScheduleTaskDto[]
  selectedTaskId: string | null
  runsByTaskId: Record<string, ScheduleTaskRunDto[]>
  nextCursorByTaskId: Record<string, string | null>
  runPageByTaskId: Record<string, number>
  runCursorHistoryByTaskId: Record<string, Array<string | undefined>>
  runsLoading: boolean
  loading: boolean
  saving: boolean
  runningNow: boolean
  error: string | null
}

export interface ScheduleTaskActions {
  loadTasks: () => Promise<void>
  selectTask: (id: string | null) => void
  createTask: (input: CreateScheduleTaskInput) => Promise<ScheduleTaskDto | null>
  updateTask: (id: string, input: UpdateScheduleTaskInput) => Promise<ScheduleTaskDto | null>
  pauseTask: (id: string) => Promise<ScheduleTaskDto | null>
  resumeTask: (id: string) => Promise<ScheduleTaskDto | null>
  runTaskNow: (id: string) => Promise<ScheduleTaskDto | null>
  deleteTask: (id: string) => Promise<boolean>
  loadTaskRuns: (id: string, cursor?: string) => Promise<void>
  clearError: () => void
}

export const initialScheduleTaskState: ScheduleTaskState = {
  tasks: [],
  selectedTaskId: null,
  runsByTaskId: {},
  nextCursorByTaskId: {},
  runPageByTaskId: {},
  runCursorHistoryByTaskId: {},
  runsLoading: false,
  loading: false,
  saving: false,
  runningNow: false,
  error: null,
}

function replaceTask(tasks: ScheduleTaskDto[], task: ScheduleTaskDto): ScheduleTaskDto[] {
  return tasks.map((candidate) => candidate.id === task.id ? task : candidate)
}

/** Page-local state for independent scheduled task sessions; no Chat state is referenced. */
export const useScheduleTaskStore = create<ScheduleTaskState & ScheduleTaskActions>()(
  devtools((set, get) => ({
    ...initialScheduleTaskState,

    loadTasks: async () => {
      set({ loading: true, error: null })
      try {
        const tasks = await schedulesApi.listTasks()
        const selectedTaskId = get().selectedTaskId && tasks.some((task) => task.id === get().selectedTaskId)
          ? get().selectedTaskId
          : (tasks[0]?.id ?? null)
        set({ tasks, selectedTaskId, loading: false })
      } catch (error) {
        set({ loading: false, error: scheduleErrorMessage(error) })
      }
    },

    selectTask: (selectedTaskId) => set({ selectedTaskId }),

    createTask: async (input) => {
      set({ saving: true, error: null })
      try {
        const task = await schedulesApi.createTask(input)
        await get().loadTasks()
        set({ selectedTaskId: task.id, saving: false })
        return task
      } catch (error) {
        set({ saving: false, error: scheduleErrorMessage(error) })
        return null
      }
    },

    updateTask: async (id, input) => {
      set({ saving: true, error: null })
      try {
        const task = await schedulesApi.updateTask(id, input)
        set((state) => ({ tasks: replaceTask(state.tasks, task), selectedTaskId: task.id, saving: false }))
        return task
      } catch (error) {
        set({ saving: false, error: scheduleErrorMessage(error) })
        return null
      }
    },

    pauseTask: async (id) => {
      set({ saving: true, error: null })
      try {
        const task = await schedulesApi.pauseTask(id)
        set((state) => ({ tasks: replaceTask(state.tasks, task), saving: false }))
        return task
      } catch (error) {
        set({ saving: false, error: scheduleErrorMessage(error) })
        return null
      }
    },

    resumeTask: async (id) => {
      set({ saving: true, error: null })
      try {
        const task = await schedulesApi.resumeTask(id)
        set((state) => ({ tasks: replaceTask(state.tasks, task), saving: false }))
        return task
      } catch (error) {
        set({ saving: false, error: scheduleErrorMessage(error) })
        return null
      }
    },

    runTaskNow: async (id) => {
      set({ runningNow: true, error: null })
      try {
        const { task } = await schedulesApi.runTaskNow(id)
        set((state) => ({ tasks: replaceTask(state.tasks, task), runningNow: false }))
        await Promise.all([get().loadTasks(), get().loadTaskRuns(id)])
        return task
      } catch (error) {
        set({ runningNow: false, error: scheduleErrorMessage(error) })
        return null
      }
    },

    deleteTask: async (id) => {
      set({ saving: true, error: null })
      try {
        await schedulesApi.deleteTask(id)
        set((state) => {
          const tasks = state.tasks.filter((task) => task.id !== id)
          const { [id]: _runs, ...runsByTaskId } = state.runsByTaskId
          const { [id]: _cursor, ...nextCursorByTaskId } = state.nextCursorByTaskId
          const { [id]: _page, ...runPageByTaskId } = state.runPageByTaskId
          const { [id]: _history, ...runCursorHistoryByTaskId } = state.runCursorHistoryByTaskId
          return {
            tasks,
            runsByTaskId,
            nextCursorByTaskId,
            runPageByTaskId,
            runCursorHistoryByTaskId,
            selectedTaskId: state.selectedTaskId === id ? (tasks[0]?.id ?? null) : state.selectedTaskId,
            saving: false,
          }
        })
        return true
      } catch (error) {
        set({ saving: false, error: scheduleErrorMessage(error) })
        return false
      }
    },

    loadTaskRuns: async (id, cursor) => {
      set({ runsLoading: true })
      try {
        const page = await schedulesApi.listTaskRuns(id, { limit: 20, ...(cursor ? { cursor } : {}) })
        set((state) => {
          const cursorHistory = cursor === undefined
            ? [undefined]
            : (state.runCursorHistoryByTaskId[id] ?? [undefined])
          const existingPageIndex = cursor === undefined ? 0 : cursorHistory.indexOf(cursor)
          const nextCursorHistory = existingPageIndex === -1
            ? [...cursorHistory, cursor]
            : cursorHistory
          const pageNumber = (existingPageIndex === -1 ? nextCursorHistory.length - 1 : existingPageIndex) + 1

          return {
            runsByTaskId: { ...state.runsByTaskId, [id]: page.items },
            nextCursorByTaskId: { ...state.nextCursorByTaskId, [id]: page.nextCursor },
            runPageByTaskId: { ...state.runPageByTaskId, [id]: pageNumber },
            runCursorHistoryByTaskId: { ...state.runCursorHistoryByTaskId, [id]: nextCursorHistory },
          }
        })
      } catch (error) {
        set({ error: scheduleErrorMessage(error) })
      } finally {
        set({ runsLoading: false })
      }
    },

    clearError: () => set({ error: null }),
  }), { name: 'bloomai-schedules' }),
)
