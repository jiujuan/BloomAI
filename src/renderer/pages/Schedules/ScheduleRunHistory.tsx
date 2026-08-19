import React from 'react'
import { RefreshCw } from 'lucide-react'
import type { ScheduleTaskRunDto } from '@shared/schedules/contracts'
import { formatScheduleTimestamp, statusLabel } from './schedule-task.types'

export { runOutputText } from './ScheduleRunDetail'

interface ScheduleRunHistoryProps {
  runs: ScheduleTaskRunDto[]
  nextCursor: string | null
  previousCursor?: string
  page: number
  loading: boolean
  onRefresh: () => void
  onLoadPage: (cursor?: string) => void | Promise<void>
  onViewDetail: (run: ScheduleTaskRunDto) => void
}

export function ScheduleRunHistory({
  runs,
  nextCursor,
  previousCursor,
  page,
  loading,
  onRefresh,
  onLoadPage,
  onViewDetail,
}: ScheduleRunHistoryProps) {
  const goToPreviousPage = () => {
    if (page > 1) onLoadPage(previousCursor)
  }

  const goToNextPage = () => {
    if (nextCursor) onLoadPage(nextCursor)
  }

  return (
    <section className="schedule-run-history" aria-label="运行历史" aria-busy={loading}>
      <header>
        <div>
          <h3>运行历史</h3>
          <p>执行结果会异步写入此处；立即执行后可刷新查看。</p>
        </div>
        <button className="btn-secondary" type="button" onClick={onRefresh} disabled={loading}><RefreshCw size={14} />刷新</button>
      </header>

      <div className="schedule-run-table-wrap">
        <table className="schedule-run-table">
          <caption className="sr-only">定时任务运行记录</caption>
          <thead>
            <tr>
              <th scope="col">结果状态</th>
              <th scope="col">运行状态</th>
              <th scope="col">执行时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td className="schedule-empty-runs" colSpan={4}>还没开始执行定时任务</td>
              </tr>
            ) : runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <span className={`schedule-status run-${run.status}`}>{statusLabel(run.status)}</span>
                </td>
                <td>
                  <span className={`schedule-status ${run.finishedAt === null ? 'active' : 'paused'}`}>
                    {run.finishedAt === null ? '运行中' : '已完成'}
                  </span>
                </td>
                <td><time>{formatScheduleTimestamp(run.finishedAt ?? run.startedAt)}</time></td>
                <td>
                  <button className="schedule-run-detail-button" type="button" onClick={() => onViewDetail(run)}>详情</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav className="schedule-run-pagination" aria-label="运行记录分页">
        <button className="btn-secondary" type="button" onClick={goToPreviousPage} disabled={loading || page <= 1}>上一页</button>
        <span aria-current="page">第 {page} 页</span>
        <button className="btn-secondary" type="button" onClick={goToNextPage} disabled={loading || !nextCursor}>下一页</button>
      </nav>
    </section>
  )
}
