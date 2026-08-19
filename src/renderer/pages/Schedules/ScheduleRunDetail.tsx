import React from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Clipboard } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ScheduleTaskRunDto } from '@shared/schedules/contracts'
import { formatScheduleTimestamp, statusLabel } from './schedule-task.types'

interface ScheduleRunDetailProps {
  run: ScheduleTaskRunDto
  onBack: () => void
}

export function runOutputText(run: ScheduleTaskRunDto): string {
  return run.outputText?.trim() || '本次任务没有返回可展示的文本输出。'
}

export function ScheduleRunDetail({ run, onBack }: ScheduleRunDetailProps) {
  const copyOutput = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
    }
  }

  const output = runOutputText(run)
  const failed = run.status === 'failed' || run.status === 'aborted'

  return (
    <section className="schedule-run-detail" aria-label="执行详情">
      <header className="schedule-run-detail-header">
        <button className="btn-secondary" type="button" onClick={onBack}><ArrowLeft size={14} />返回</button>
        <div className="schedule-run-detail-heading">
          <span className={`schedule-status run-${run.status}`}>
            {failed ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
            {statusLabel(run.status)}
          </span>
          <strong>{run.triggerKind === 'manual' ? '手动执行' : '定时触发'}</strong>
          <time>{formatScheduleTimestamp(run.finishedAt ?? run.startedAt)}</time>
        </div>
        {run.outputText && <button className="btn-icon" type="button" title="复制输出" aria-label="复制输出" onClick={() => void copyOutput(run.outputText!)}><Clipboard size={14} /></button>}
      </header>
      {failed && run.errorMessage ? <p className="schedule-run-error">{run.errorMessage}</p> : (
        <div className="schedule-run-output"><ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown></div>
      )}
    </section>
  )
}
