import React from 'react'
import { ShieldAlert, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@renderer/utils'

export type ApprovalRequest = {
  approvalId: string
  toolName: string
  args: Record<string, unknown>
}

// Extracts an approval request from a Mastra `data-tool-call-approval` part.
export function toApprovalRequest(part: any): ApprovalRequest | null {
  const d = part?.data
  if (!d || !d.runId || !d.toolCallId) return null
  return {
    approvalId: `${d.runId}::${d.toolCallId}`,
    toolName: String(d.toolName || 'tool'),
    args: d.args && typeof d.args === 'object' ? d.args : {},
  }
}

function summarizeArgs(toolName: string, args: Record<string, unknown>): string {
  for (const key of ['command', 'path', 'url', 'code', 'pattern']) {
    const v = args[key]
    if (typeof v === 'string' && v) return `${key}: ${v.length > 120 ? v.slice(0, 117) + '…' : v}`
  }
  try {
    return JSON.stringify(args).slice(0, 140)
  } catch {
    return ''
  }
}

/**
 * Human-in-the-loop approval card (P6d-2). Shown when the coder agent wants to run a
 * mutating/exec tool. Approve → the tool runs and the agent continues; Deny → the tool
 * does not run and the agent is told it was declined (it won't retry).
 */
export function ApprovalCard({
  request,
  decided,
  onDecide,
}: {
  request: ApprovalRequest
  decided?: boolean // true=approved, false=denied, undefined=pending
  onDecide: (approvalId: string, approved: boolean) => void
}) {
  const pending = decided === undefined
  return (
    <div className={cn('approval-card', pending ? 'pending' : decided ? 'approved' : 'denied')} role="alertdialog">
      <div className="approval-head">
        <ShieldAlert size={13} />
        <span className="approval-title">需要你确认</span>
        <span className="approval-tool">{request.toolName}</span>
      </div>
      <div className="approval-body">{summarizeArgs(request.toolName, request.args)}</div>
      {pending ? (
        <div className="approval-actions">
          <button className="approval-btn approve" onClick={() => onDecide(request.approvalId, true)}>
            <Check size={12} /> 通过并执行
          </button>
          <button className="approval-btn deny" onClick={() => onDecide(request.approvalId, false)}>
            <X size={12} /> 拒绝
          </button>
        </div>
      ) : (
        <div className={cn('approval-result', decided ? 'approved' : 'denied')}>
          {decided ? <><Check size={12} /> 已通过，执行中…</> : <><X size={12} /> 已拒绝，未执行</>}
        </div>
      )}
    </div>
  )
}
