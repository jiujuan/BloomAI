import React, { useMemo, useState } from 'react'
import { Check, ChevronDown, FileText, Folder, Image, Loader2, Search, TerminalSquare, Video, X } from 'lucide-react'
import { cn } from '@renderer/utils'
import type { ResponseError, ToolCallBlock } from '@shared/schemas'

export type ToolCallGroup = {
  key: string
  toolId: string
  category: ToolCallBlock['category']
  calls: ToolCallBlock[]
}

type ToolStatus = ToolCallBlock['status']

const STATUS_ORDER: ToolStatus[] = ['running', 'success', 'error']

const STATUS_LABEL: Record<ToolStatus, string> = {
  running: 'Running',
  success: 'Done',
  error: 'Failed',
}

const STATUS_ICON: Record<ToolStatus, React.ReactNode> = {
  running: <Loader2 size={11} className="spin" />,
  success: <Check size={11} />,
  error: <X size={11} />,
}

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  search: <Search size={12} />,
  web: <Search size={12} />,
  file: <Folder size={12} />,
  shell: <TerminalSquare size={12} />,
  image: <Image size={12} />,
  video: <Video size={12} />,
  tool: <span>tool</span>,
  document: <FileText size={12} />,
}

export function createToolCallGroupKey(call: Pick<ToolCallBlock, 'category' | 'toolId'>): string {
  return `${call.category}:${call.toolId}`
}

export function ToolCallGroupCard({ group }: { group: ToolCallGroup }) {
  const [open, setOpen] = useState(true)
  const [openStatuses, setOpenStatuses] = useState<Record<string, boolean>>({
    running: true,
    success: true,
    error: true,
  })
  const statusGroups = useMemo(() => groupCallsByStatus(group.calls), [group.calls])
  const overallStatus = getOverallStatus(group.calls)

  return (
    <div className={cn('tool-call-group-card', overallStatus === 'error' && 'error')} data-tool-group-key={group.key}>
      <button className="tcg-head" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tcg-icon">{CATEGORY_ICON[group.category] || group.category}</span>
        <span className="tcg-name">{group.toolId}</span>
        <span className={cn('tcg-status', overallStatus)}>{STATUS_ICON[overallStatus]} {STATUS_LABEL[overallStatus]}</span>
        <span className="tcg-count">{group.calls.length} calls</span>
        <ChevronDown size={13} className={cn('tcg-chevron', open && 'open')} />
      </button>

      {open && (
        <div className="tcg-body">
          {STATUS_ORDER.map((status) => {
            const calls = statusGroups[status]
            if (!calls.length) return null
            const sectionOpen = openStatuses[status] ?? true
            return (
              <div key={status} className="tcg-section">
                <button
                  type="button"
                  className="tcg-section-head"
                  onClick={() => setOpenStatuses((current) => ({ ...current, [status]: !sectionOpen }))}
                  aria-expanded={sectionOpen}
                >
                  <span className={cn('tcg-section-status', status)}>{STATUS_ICON[status]} {STATUS_LABEL[status]} {calls.length}</span>
                  <ChevronDown size={12} className={cn('tcg-chevron', sectionOpen && 'open')} />
                </button>
                {sectionOpen && (
                  <div className="tcg-call-list">
                    {calls.map((call, index) => <ToolCallSummaryRow key={call.callId} call={call} index={index + 1} />)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ToolCallSummaryRow({ call, index }: { call: ToolCallBlock; index: number }) {
  return (
    <div className="tcg-call-row" data-call-id={call.callId}>
      <span className="tcg-call-index">#{index}</span>
      <span className="tcg-call-main">{formatInput(call.input)}</span>
      {call.outputSummary && <span className="tcg-call-summary">{call.outputSummary}</span>}
      {call.error && <span className="tcg-call-error">{getErrorMessage(call.error)}</span>}
      {call.durationMs !== undefined && <span className="tcg-call-time">{call.durationMs}ms</span>}
    </div>
  )
}

function groupCallsByStatus(calls: ToolCallBlock[]): Record<ToolStatus, ToolCallBlock[]> {
  return calls.reduce<Record<ToolStatus, ToolCallBlock[]>>((groups, call) => {
    groups[call.status].push(call)
    return groups
  }, { running: [], success: [], error: [] })
}

function getOverallStatus(calls: ToolCallBlock[]): ToolStatus {
  if (calls.some((call) => call.status === 'running')) return 'running'
  if (calls.some((call) => call.status === 'error')) return 'error'
  return 'success'
}

function formatInput(input: Record<string, unknown>): string {
  const preferred = ['query', 'path', 'url', 'prompt', 'command']
  for (const key of preferred) {
    const value = input[key]
    if (typeof value === 'string' && value) return `${key}: ${truncate(value, 80)}`
  }
  const [key, value] = Object.entries(input)[0] ?? []
  if (!key) return 'no parameters'
  return `${key}: ${truncate(formatValue(value), 80)}`
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 3) + '...' : value
}

function getErrorMessage(error: ResponseError): string {
  return error.message
}