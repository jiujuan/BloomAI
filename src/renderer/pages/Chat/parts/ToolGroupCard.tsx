import React, { useState } from 'react'
import { Check, ChevronDown, Loader2, Search, Folder, TerminalSquare, Image, Video, FileText, X, AlertTriangle, ShieldAlert } from 'lucide-react'
import { cn } from '@renderer/utils'
import {
  type ToolCallView,
  type ToolStatus,
  toolStatus,
  summarizeInput,
  summarizeOutput,
  extractResultLinks,
  getScreenshotArtifactUrl,
  getScreenshotArtifactView,
} from './tool-part'

const STATUS_META: Record<ToolStatus, { label: string; icon: React.ReactNode }> = {
  running: { label: '运行中', icon: <Loader2 size={11} className="spin" /> },
  success: { label: '已完成', icon: <Check size={11} /> },
  error: { label: '失败', icon: <X size={11} /> },
  permission: { label: '等待确认', icon: <ShieldAlert size={11} /> },
}

function toolIcon(name: string): React.ReactNode {
  const normalized = name.toLowerCase()
  if (normalized.includes('search') || normalized.includes('web')) return <Search size={12} />
  if (normalized.includes('fs') || normalized.includes('doc') || normalized.includes('file')) return <Folder size={12} />
  if (normalized.includes('shell') || normalized.includes('bash') || normalized.includes('runner')) return <TerminalSquare size={12} />
  if (normalized.includes('image')) return <Image size={12} />
  if (normalized.includes('video')) return <Video size={12} />
  return <FileText size={12} />
}

// Aggregate status for a group of same-tool calls: running > error > permission > success.
function groupStatus(calls: ToolCallView[]): ToolStatus {
  const statuses = calls.map(toolStatus)
  if (statuses.includes('running')) return 'running'
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('permission')) return 'permission'
  return 'success'
}

/** Rich card for a run of adjacent same-tool calls (parallel/retried activity stays one section). */
export function ToolGroupCard({
  name,
  calls,
  detailsOnly = false,
}: {
  name: string
  calls: ToolCallView[]
  /** Hides the duplicate inner toggle when the parent activity row owns disclosure. */
  detailsOnly?: boolean
}) {
  const [open, setOpen] = useState(true)
  const overall = groupStatus(calls)

  if (detailsOnly) {
    return (
      <div className={cn('tool-call-group-card', 'details-only', overall)} data-tool-group={name} data-tool-status={overall}>
        <div className="tcg-body">
          {calls.map((call, i) => (
            <ToolCallRow key={call.toolCallId || i} call={call} index={i + 1} multi={calls.length > 1} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('tool-call-group-card', overall)} data-tool-group={name} data-tool-status={overall}>
      <button className="tcg-head" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tcg-icon">{toolIcon(name)}</span>
        <span className="tcg-name">{name}</span>
        <span className={cn('tcg-status', overall)}>{STATUS_META[overall].icon} {STATUS_META[overall].label}</span>
        <span className="tcg-count">{calls.length} 次</span>
        <ChevronDown size={13} className={cn('tcg-chevron', open && 'open')} />
      </button>
      {open && (
        <div className="tcg-body">
          {calls.map((call, i) => (
            <ToolCallRow key={call.toolCallId || i} call={call} index={i + 1} multi={calls.length > 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolCallRow({ call, index, multi }: { call: ToolCallView; index: number; multi: boolean }) {
  const status = toolStatus(call)
  const inputLine = summarizeInput(call.input)
  const outputLine = summarizeOutput(call.output)
  const links = extractResultLinks(call.output)
  const screenshot = getScreenshotArtifactView(call.output)
  const screenshotUrl = getScreenshotArtifactUrl(call.name, call.output)
  const permissionMsg = status === 'permission' ? String(call.output?.error || '需要确认后才能继续') : undefined
  const softError = status === 'error' && call.output && typeof call.output.error === 'string' ? call.output.error : undefined
  const hardError = call.errorText

  return (
    <div className="tcg-call-row" data-call-id={call.toolCallId}>
      {multi && <span className="tcg-call-index">#{index}</span>}
      {inputLine && <span className="tcg-call-main">{inputLine}</span>}
      {status === 'running' && <span className="tcg-call-summary"><Loader2 size={10} className="spin" /> 运行中…</span>}
      {outputLine && status === 'success' && <span className="tcg-call-summary">{outputLine}</span>}
      {call.name.startsWith('web_') && call.output?.rendered === true && status === 'success' && (
        <span className="tcg-call-summary">已渲染</span>
      )}
      {screenshot && screenshotUrl && status === 'success' && (
        <a href={screenshotUrl} target="_blank" rel="noopener noreferrer" className="tcg-screenshot-link" title="打开截图结果">
          <img src={screenshotUrl} alt="截图结果" className="tcg-screenshot-thumb" />
        </a>
      )}
      {permissionMsg && (
        <span className="tcg-call-permission"><AlertTriangle size={10} /> {permissionMsg}</span>
      )}
      {(softError || hardError) && <span className="tcg-call-error">{softError || hardError}</span>}
      {links.length > 0 && (
        <span className="tcg-call-links">
          {links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="tcg-call-link" title={link.url}>
              {link.title}
            </a>
          ))}
        </span>
      )}
    </div>
  )
}
