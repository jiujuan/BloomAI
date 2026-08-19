import React, { useEffect, useState } from 'react'
import { Pencil, Play, Pause, RefreshCw, Trash2 } from 'lucide-react'
import type { ScheduleTaskDto, ScheduleTaskRunDto } from '@shared/schedules/contracts'
import { formatScheduleTimestamp, statusLabel } from './schedule-task.types'
import { ScheduleRunDetail } from './ScheduleRunDetail'
import { ScheduleRunHistory } from './ScheduleRunHistory'

interface ScheduleTaskDetailProps {
  task: ScheduleTaskDto
  runs: ScheduleTaskRunDto[]
  nextCursor: string | null
  previousCursor?: string
  runPage: number
  runsLoading: boolean
  saving: boolean
  runningNow: boolean
  onEdit: () => void
  onPause: () => void | Promise<void>
  onResume: () => void | Promise<void>
  onRunNow: () => void | Promise<void>
  onDelete: () => void | Promise<void>
  onRefreshRuns: () => void | Promise<void>
  onLoadPage: (cursor?: string) => void | Promise<void>
}

export function ScheduleTaskDetail({
  task,
  runs,
  nextCursor,
  previousCursor,
  runPage,
  runsLoading,
  saving,
  runningNow,
  onEdit,
  onPause,
  onResume,
  onRunNow,
  onDelete,
  onRefreshRuns,
  onLoadPage,
}: ScheduleTaskDetailProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const selectedRun = selectedRunId ? runs.find((run) => run.id === selectedRunId) ?? null : null

  useEffect(() => {
    setSelectedRunId(null)
  }, [task.id])

  const confirmDelete = () => {
    setConfirmingDelete(false)
    void onDelete()
  }

  return (
    <section className="schedule-task-detail" aria-label="定时任务详情">
      <header className="schedule-detail-header">
        <div>
          <div className="schedule-detail-title-row">
            <h2>{task.name}</h2>
            <span className={`schedule-status ${task.status}`}>{statusLabel(task.status)}</span>
          </div>
          <p>{task.cron} · {task.timezone}</p>
        </div>
        <div className="schedule-detail-actions">
          <button className="btn-secondary" type="button" onClick={onEdit} disabled={saving}><Pencil size={14} />编辑</button>
          {task.status === 'active'
            ? <button className="btn-secondary" type="button" onClick={() => void onPause()} disabled={saving}><Pause size={14} />暂停</button>
            : <button className="btn-secondary" type="button" onClick={() => void onResume()} disabled={saving}><Play size={14} />恢复</button>}
          <button className="btn-primary" type="button" onClick={() => void onRunNow()} disabled={runningNow}>
            {runningNow ? <RefreshCw className="spin" size={14} /> : <Play size={14} />} {runningNow ? '提交中…' : '立即执行'}
          </button>
        </div>
      </header>

      <dl className="schedule-detail-summary">
        <div><dt>状态</dt><dd>{statusLabel(task.status)}</dd></div>
        <div><dt>下次执行</dt><dd>{formatScheduleTimestamp(task.nextFireAt)}</dd></div>
        <div><dt>上次触发</dt><dd>{formatScheduleTimestamp(task.lastFireAt)}</dd></div>
        <div><dt>最近结果</dt><dd>{task.lastRun ? statusLabel(task.lastRun.status) : '尚无记录'}</dd></div>
      </dl>

      {confirmingDelete ? (
        <div className="schedule-delete-confirm" role="alertdialog" aria-label="确认删除定时任务">
          <strong>确认删除“{task.name}”吗？</strong>
          <p>该操作会删除任务及其运行历史，且无法撤销。</p>
          <div>
            <button className="btn-secondary" type="button" onClick={() => setConfirmingDelete(false)}>取消</button>
            <button className="btn-danger-sm" type="button" onClick={confirmDelete} disabled={saving}>确认删除</button>
          </div>
        </div>
      ) : (
        <button className="schedule-delete-button" type="button" onClick={() => setConfirmingDelete(true)} disabled={saving}>
          <Trash2 size={14} /> 删除任务
        </button>
      )}

      {selectedRun ? (
        <ScheduleRunDetail run={selectedRun} onBack={() => setSelectedRunId(null)} />
      ) : (
        <ScheduleRunHistory
          runs={runs}
          nextCursor={nextCursor ?? null}
          previousCursor={previousCursor}
          page={runPage}
          loading={runsLoading}
          onRefresh={() => void onRefreshRuns()}
          onLoadPage={(cursor) => void onLoadPage(cursor)}
          onViewDetail={(run) => setSelectedRunId(run.id)}
        />
      )}
    </section>
  )
}
