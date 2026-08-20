import React, { useEffect, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { platform, type SkillRunDto } from '@renderer/api'
import { cn } from '@renderer/utils'

export type SkillRunPartData = {
  runId: string
  skillVersionId: string
  status: string
  sessionId: string
}

const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'])

export function skillRunStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    created: '已创建',
    validating: '校验中',
    running: '运行中',
    waiting_input: '等待输入',
    waiting_approval: '等待审批',
    completed: '已完成',
    completed_with_errors: '部分完成',
    failed: '失败',
    cancelled: '已取消',
    interrupted: '已中断',
  }
  return labels[status] || '处理中'
}

export function SkillRunPart({ data, onOpen }: { data: SkillRunPartData; onOpen?: (runId: string) => void }) {
  const [run, setRun] = useState<SkillRunDto | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      setRun(await platform.getSkillRun(data.runId))
    } catch {
      // The compact message remains useful even when the runtime is temporarily unavailable.
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    if (TERMINAL_STATUSES.has(data.status)) return
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [data.runId, data.status])

  const status = run?.status || data.status
  const waiting = status === 'waiting_approval' || status === 'waiting_input'
  const error = run?.errorMessage

  return (
    <div className={cn('skill-run-card', `skill-run-${status}`)} data-run-id={data.runId}>
      <div className="skill-run-card-header">
        <strong>技能运行</strong>
        <span className="skill-run-status" role="status">{skillRunStatusLabel(status)}</span>
      </div>
      <div className="skill-run-card-meta">
        <span>运行 {data.runId.slice(0, 8)}</span>
        <span>版本 {data.skillVersionId.slice(0, 8)}</span>
      </div>
      {waiting && <div className="skill-run-waiting">{status === 'waiting_approval' ? '需要审批后继续' : '需要补充输入后继续'}</div>}
      {error && <div className="skill-run-error" role="alert">{error}</div>}
      <div className="skill-run-card-actions">
        <button type="button" onClick={() => void refresh()} disabled={loading} title="刷新运行状态" aria-label="刷新运行状态">
          {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          刷新
        </button>
        {onOpen && <button type="button" onClick={() => onOpen(data.runId)}><ExternalLink size={14} />打开详情</button>}
      </div>
    </div>
  )
}
