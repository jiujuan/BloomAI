import React from 'react'
import { Clock3, Pause, Play, Plus } from 'lucide-react'
import type { ScheduleTaskDto } from '@shared/schedules/contracts'
import { formatScheduleTimestamp, statusLabel } from './schedule-task.types'

interface ScheduleTaskListProps {
  tasks: ScheduleTaskDto[]
  selectedTaskId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onCreate: () => void
}

export function ScheduleTaskList({ tasks, selectedTaskId, loading, onSelect, onCreate }: ScheduleTaskListProps) {
  return (
    <aside className="schedule-task-list" aria-label="定时任务列表">
      <div className="schedule-list-header">
        <div>
          <h1>定时任务</h1>
          <p>独立任务会话</p>
        </div>
        <button className="btn-icon" type="button" aria-label="新建定时任务" title="新建定时任务" onClick={onCreate}>
          <Plus size={17} />
        </button>
      </div>

      {loading && tasks.length === 0 && <p className="schedule-list-message">正在加载任务…</p>}
      {!loading && tasks.length === 0 && (
        <div className="schedule-empty-state">
          <Clock3 size={20} />
          <strong>暂无定时任务</strong>
          <p>新建任务后，BloomAI 会按调度启动独立任务会话。</p>
          <button className="btn-primary" type="button" onClick={onCreate}>新建任务</button>
        </div>
      )}

      <div className="schedule-list-items">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className={`schedule-task-list-item ${selectedTaskId === task.id ? 'selected' : ''}`}
            onClick={() => onSelect(task.id)}
            aria-pressed={selectedTaskId === task.id}
          >
            <div className="schedule-task-list-item-top">
              <strong>{task.name}</strong>
              <span className={`schedule-status ${task.status}`}>{task.status === 'active' ? <Play size={11} /> : <Pause size={11} />}{statusLabel(task.status)}</span>
            </div>
            <span className="schedule-task-list-cron">{task.cron} · {task.timezone}</span>
            <span className="schedule-task-list-last">最近执行：{task.lastRun ? `${statusLabel(task.lastRun.status)} · ${formatScheduleTimestamp(task.lastRun.finishedAt)}` : '尚无记录'}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
