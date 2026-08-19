import React, { useEffect, useMemo, useState } from 'react'
import type { CreateScheduleTaskInput, UpdateScheduleTaskInput } from '@shared/schedules/contracts'
import { ScheduleTaskDetail } from './ScheduleTaskDetail'
import { ScheduleTaskForm } from './ScheduleTaskForm'
import { ScheduleTaskList } from './ScheduleTaskList'
import { useScheduleTaskStore } from './schedule-task.store'

export function SchedulesPage() {
  const {
    tasks,
    selectedTaskId,
    runsByTaskId,
    nextCursorByTaskId,
    runPageByTaskId,
    runCursorHistoryByTaskId,
    runsLoading,
    loading,
    saving,
    runningNow,
    error,
    loadTasks,
    selectTask,
    createTask,
    updateTask,
    pauseTask,
    resumeTask,
    runTaskNow,
    deleteTask,
    loadTaskRuns,
    clearError,
  } = useScheduleTaskStore()
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (selectedTask) void loadTaskRuns(selectedTask.id)
  }, [selectedTask?.id, loadTaskRuns])

  const select = (id: string) => {
    setMode(null)
    setNotice(null)
    selectTask(id)
  }

  const submit = async (input: CreateScheduleTaskInput | UpdateScheduleTaskInput) => {
    const saved = mode === 'edit' && selectedTask
      ? await updateTask(selectedTask.id, input)
      : await createTask(input as CreateScheduleTaskInput)
    if (!saved) return
    setMode(null)
    setNotice(mode === 'edit' ? '任务配置已更新。' : '定时任务已创建并选中。')
    await loadTaskRuns(saved.id)
  }

  const requestRun = async () => {
    if (!selectedTask) return
    const task = await runTaskNow(selectedTask.id)
    if (task) setNotice('已提交立即执行请求，运行结果会异步出现在历史记录中。')
  }

  const remove = async () => {
    if (!selectedTask) return
    const removed = await deleteTask(selectedTask.id)
    if (removed) {
      setMode(null)
      setNotice('定时任务已删除。')
    }
  }

  const selectedRunPage = selectedTask ? runPageByTaskId[selectedTask.id] ?? 1 : 1
  const selectedRunCursorHistory = selectedTask ? runCursorHistoryByTaskId[selectedTask.id] ?? [undefined] : [undefined]
  const previousRunCursor = selectedRunPage > 1 ? selectedRunCursorHistory[selectedRunPage - 2] : undefined

  return (
    <div className="schedules-page">
      <p className="schedules-runtime-notice" role="status">任务仅在 BloomAI 运行期间执行。</p>
      {error && <div className="schedules-page-error" role="alert"><span>{error}</span><button type="button" onClick={clearError} aria-label="关闭错误提示">×</button></div>}
      {notice && <div className="schedules-page-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}

      <div className="schedules-layout">
        <ScheduleTaskList
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          loading={loading}
          onSelect={select}
          onCreate={() => { setMode('create'); setNotice(null) }}
        />

        <main className="schedules-main">
          {mode && (
            <ScheduleTaskForm
              key={mode === 'edit' ? selectedTask?.id ?? 'edit' : 'create'}
              task={mode === 'edit' ? selectedTask ?? undefined : undefined}
              saving={saving}
              onSubmit={submit}
              onCancel={() => setMode(null)}
            />
          )}
          {!mode && selectedTask && (
            <ScheduleTaskDetail
              key={selectedTask.id}
              task={selectedTask}
              runs={runsByTaskId[selectedTask.id] ?? []}
              nextCursor={nextCursorByTaskId[selectedTask.id]}
              previousCursor={previousRunCursor}
              runPage={selectedRunPage}
              runsLoading={runsLoading}
              saving={saving}
              runningNow={runningNow}
              onEdit={() => { setMode('edit'); setNotice(null) }}
              onPause={() => { void pauseTask(selectedTask.id) }}
              onResume={() => { void resumeTask(selectedTask.id) }}
              onRunNow={requestRun}
              onDelete={remove}
              onRefreshRuns={() => loadTaskRuns(selectedTask.id)}
              onLoadPage={(cursor) => loadTaskRuns(selectedTask.id, cursor)}
            />
          )}
          {!mode && !selectedTask && !loading && (
            <div className="schedules-welcome">
              <h2>创建独立定时任务</h2>
              <p>任务会在设定时间启动受控的 scheduled-task Agent，不关联任何聊天会话。</p>
              <button className="btn-primary" type="button" onClick={() => setMode('create')}>新建定时任务</button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
