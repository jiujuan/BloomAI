import React from 'react'
import { ListTodo, Check, RotateCcw, Loader2, Ban } from 'lucide-react'
import { cn } from '@renderer/utils'

export type PlanStatus = 'proposing' | 'ready' | 'executing' | 'done' | 'discarded'

/**
 * Plan-mode task card. Step 1 of chat "plan" mode: the assistant proposes a short
 * task list and the user confirms (是) or asks for a new plan (重新计划).
 *
 *   proposing → generating the task list (spinner)
 *   ready     → tasks shown with 是 / 重新计划 buttons
 *   executing → confirmed, tasks read-only while the answer streams
 *   done      → persisted read-only card (rebuilt from a data-plan part on reload)
 *   discarded → superseded by a newer proposal; read-only, buttons greyed out
 */
export function PlanCard({
  tasks,
  status,
  onConfirm,
  onReplan,
}: {
  tasks: string[]
  status: PlanStatus
  onConfirm?: () => void
  onReplan?: () => void
}) {
  const proposing = status === 'proposing'
  const discarded = status === 'discarded'
  return (
    <div className={cn('plan-card', status)} role="group" aria-label="计划任务">
      <div className="plan-head">
        <ListTodo size={13} />
        <span className="plan-title">计划任务</span>
        {!proposing && tasks.length > 0 && <span className="plan-count">{tasks.length}</span>}
      </div>

      {proposing ? (
        <div className="plan-loading">
          <Loader2 size={14} className="spin" /> 正在规划任务…
        </div>
      ) : (
        <ol className="plan-tasks">
          {tasks.map((t, i) => (
            <li key={i} className="plan-task">
              <span className="plan-task-num">{i + 1}</span>
              <span className="plan-task-text">{t}</span>
            </li>
          ))}
        </ol>
      )}

      {status === 'ready' && (
        <div className="plan-actions">
          <button className="plan-btn confirm" onClick={onConfirm}>
            <Check size={12} /> 是
          </button>
          <button className="plan-btn replan" onClick={onReplan}>
            <RotateCcw size={12} /> 重新计划
          </button>
        </div>
      )}
      {discarded && (
        <div className="plan-actions">
          <button className="plan-btn confirm" disabled>
            <Check size={12} /> 是
          </button>
          <button className="plan-btn replan" disabled>
            <RotateCcw size={12} /> 重新计划
          </button>
          <span className="plan-discarded"><Ban size={12} /> 已丢弃</span>
        </div>
      )}
      {status === 'executing' && (
        <div className="plan-status">
          <Loader2 size={12} className="spin" /> 已确认，执行中…
        </div>
      )}
    </div>
  )
}
