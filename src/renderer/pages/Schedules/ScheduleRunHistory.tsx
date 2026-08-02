import React from 'react'
import { AlertTriangle, CheckCircle2, Clipboard, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ScheduleTaskRunDto } from '@shared/schedules/contracts'
import { formatScheduleTimestamp, statusLabel } from './schedule-task.types'

interface ScheduleRunHistoryProps {
  runs: ScheduleTaskRunDto[]
  nextCursor: string | null
  onRefresh: () => void
  onLoadMore: () => void
}

export function runOutputText(run: ScheduleTaskRunDto): string {
  return run.outputText?.trim() || '本次任务没有返回可展示的文本输出。'
}

export function ScheduleRunHistory({ runs, nextCursor, onRefresh, onLoadMore }: ScheduleRunHistoryProps) {
  const copyOutput = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
    }
  }

  return (
    <section className="schedule-run-history" aria-label="运行历史">
      <header>
        <div>
          <h3>运行历史</h3>
          <p>执行结果会异步写入此处；立即执行后可刷新查看。</p>
        </div>
        <button className="btn-secondary" type="button" onClick={onRefresh}><RefreshCw size={14} />刷新</button>
      </header>

      {runs.length === 0 ? (
        <div className="schedule-empty-runs">尚无运行记录。</div>
      ) : (
        <div className="schedule-run-list">
          {runs.map((run) => {
            const output = runOutputText(run)
            const failed = run.status === 'failed' || run.status === 'aborted'
            return (
              <article className={`schedule-run-card ${failed ? 'failed' : 'succeeded'}`} key={run.id}>
                <div className="schedule-run-card-header">
                  <div>
                    <span className={`schedule-status run-${run.status}`}>{failed ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}{statusLabel(run.status)}</span>
                    <strong>{run.triggerKind === 'manual' ? '手动执行' : '定时触发'}</strong>
                    <time>{formatScheduleTimestamp(run.finishedAt ?? run.startedAt)}</time>
                  </div>
                  {run.outputText && <button className="btn-icon" type="button" title="复制输出" aria-label="复制输出" onClick={() => void copyOutput(run.outputText!)}><Clipboard size={14} /></button>}
                </div>
                {failed && run.errorMessage ? <p className="schedule-run-error">{run.errorMessage}</p> : (
                  <div className="schedule-run-output"><ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown></div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {nextCursor && <button className="btn-secondary schedule-load-more" type="button" onClick={onLoadMore}>加载更多记录</button>}
    </section>
  )
}
