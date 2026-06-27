import React, { useState } from 'react'
import { Check, ChevronDown, Copy, FileText, Folder, Image, Loader2, RefreshCw, Search, TerminalSquare, Video, X } from 'lucide-react'
import { cn } from '@renderer/utils'
import type { ToolCallBlock } from '@shared/schemas'
import { isKnownResponseErrorCode, resolveErrorTimeline } from '@shared/llm-response-contract/error-timeline-registry'

type NormalizedToolCallData = {
  callId: string
  toolId: string
  category: string
  status: 'running' | 'success' | 'error'
  input: Record<string, any>
  output?: any
  outputSummary?: string
  errorMessage?: string
  durationMs?: number
}

const CATEGORY_LABEL: Record<string, React.ReactNode> = {
  search: <Search size={12} />,
  web: <Search size={12} />,
  file: <Folder size={12} />,
  shell: <TerminalSquare size={12} />,
  image: <Image size={12} />,
  video: <Video size={12} />,
  tool: <span>tool</span>,
  fs: <Folder size={12} />,
  document: <FileText size={12} />,
  multimodal: <span>multimodal</span>,
  execution: <TerminalSquare size={12} />,
}

function formatValue(v: any): string {
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '...' : v
  return JSON.stringify(v)
}

export function ToolCallCard({ data, onRetry }: { data: ToolCallBlock; onRetry?: () => void }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const normalized = normalizeToolCall(data)

  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify(normalized.output, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={cn('tool-call-card', normalized.status === 'error' && 'error')} data-call-id={normalized.callId}>
      <div className="tcc-head" onClick={() => setOpen(!open)}>
        <div className="tcc-icon">{CATEGORY_LABEL[normalized.category] || normalized.category}</div>
        <span className="tcc-name">{normalized.toolId}</span>
        {normalized.status === 'running' && <span className="tcc-status running"><Loader2 size={11} className="spin" /> Running</span>}
        {normalized.status === 'success' && (
          <>
            <span className="tcc-status success"><Check size={11} /> Done</span>
            {normalized.durationMs !== undefined && <span className="tcc-time">{normalized.durationMs}ms</span>}
          </>
        )}
        {normalized.status === 'error' && <span className="tcc-status error"><X size={11} /> Failed</span>}
        <ChevronDown size={13} className={cn('tcc-chevron', open && 'open')} />
      </div>

      {open && (
        <div className="tcc-body">
          <div className="tcc-section">
            <div className="tcc-label">Parameters</div>
            {Object.entries(normalized.input).map(([k, v]) => (
              <div key={k} className="tcc-kv">
                <span className="tcc-key">{k}</span>
                <span className="tcc-val">{formatValue(v)}</span>
              </div>
            ))}
          </div>

          {normalized.status === 'running' && (
            <div className="tcc-section">
              <div className="tcc-progress-track"><div className="tcc-progress-fill" /></div>
            </div>
          )}

          {normalized.status === 'success' && (normalized.output || normalized.outputSummary) && (
            <div className="tcc-section">
              <div className="tcc-label">Result</div>
              <ToolResultView output={normalized.output ?? { description: normalized.outputSummary }} />
              {normalized.output && (
                <div className="tcc-actions">
                  <button className="tcc-action-btn" onClick={copy}>
                    {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy result'}
                  </button>
                </div>
              )}
            </div>
          )}

          {normalized.status === 'error' && (
            <div className="tcc-section">
              <div className="tcc-label">Error</div>
              <div className="tcc-error-box">{normalized.errorMessage}</div>
              {onRetry && (
                <div className="tcc-actions">
                  <button className="tcc-action-btn" onClick={onRetry}><RefreshCw size={11} /> Retry</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function normalizeToolCall(data: ToolCallBlock): NormalizedToolCallData {
  return {
    callId: data.callId,
    toolId: data.toolId,
    category: data.category,
    status: data.status,
    input: data.input,
    output: data.output,
    // Convert the v1 block into a compact view model without accepting legacy tool-call shapes.
    outputSummary: data.outputSummary,
    errorMessage: getErrorMessage(data.error),
    durationMs: data.durationMs,
  }
}

function getErrorMessage(error: ToolCallBlock['error']): string | undefined {
  if (!error) return undefined
  const definition = resolveErrorTimeline(error)
  if (isKnownResponseErrorCode(error.code)) {
    return `${error.code}: ${definition.timelineMessage} - ${error.message}`
  }
  return error.message
}

function ToolResultView({ output }: { output: any }) {
  if (output.results && Array.isArray(output.results)) {
    return (
      <div className="tcc-result-list">
        {output.results.slice(0, 3).map((r: any, i: number) => (
          <div key={i} className="tcc-result-item">
            <div className="tcc-result-title">{r.title}</div>
            {r.url && <div className="tcc-result-url">{r.url}</div>}
            {r.snippet && <div className="tcc-result-snippet">{r.snippet}</div>}
          </div>
        ))}
      </div>
    )
  }
  if (output.description) return <div className="tcc-result-text">{output.description}</div>
  if (output.content) return <div className="tcc-code-pre">{String(output.content).slice(0, 300)}</div>
  if (output.stdout !== undefined) return <div className="tcc-code-pre">{output.stdout || '(no output)'}{output.stderr ? '\n' + output.stderr : ''}</div>
  return <div className="tcc-code-pre">{JSON.stringify(output, null, 2).slice(0, 400)}</div>
}
