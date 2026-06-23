import React, { useState } from 'react'
import { ChevronDown, Loader2, Check, X, Copy, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface ToolCallData {
  toolId: string
  category: string
  status: 'running' | 'success' | 'error'
  input: Record<string, any>
  output?: any
  error?: string
  durationMs?: number
}

const CATEGORY_ICON: Record<string, string> = {
  web: '🌐', fs: '📁', document: '📄', multimodal: '🖼️', execution: '⚡'
}

function formatValue(v: any): string {
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v
  return JSON.stringify(v)
}

export function ToolCallCard({ data, onRetry }: { data: ToolCallData; onRetry?: () => void }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify(data.output, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={cn('tool-call-card', data.status === 'error' && 'error')}>
      <div className="tcc-head" onClick={() => setOpen(!open)}>
        <div className="tcc-icon">{CATEGORY_ICON[data.category] || '🔧'}</div>
        <span className="tcc-name">{data.toolId}</span>
        {data.status === 'running' && <span className="tcc-status running"><Loader2 size={11} className="spin" /> Running</span>}
        {data.status === 'success' && (
          <>
            <span className="tcc-status success"><Check size={11} /> Done</span>
            {data.durationMs !== undefined && <span className="tcc-time">{data.durationMs}ms</span>}
          </>
        )}
        {data.status === 'error' && <span className="tcc-status error"><X size={11} /> Failed</span>}
        <ChevronDown size={13} className={cn('tcc-chevron', open && 'open')} />
      </div>

      {open && (
        <div className="tcc-body">
          <div className="tcc-section">
            <div className="tcc-label">Parameters</div>
            {Object.entries(data.input).map(([k, v]) => (
              <div key={k} className="tcc-kv">
                <span className="tcc-key">{k}</span>
                <span className="tcc-val">{formatValue(v)}</span>
              </div>
            ))}
          </div>

          {data.status === 'running' && (
            <div className="tcc-section">
              <div className="tcc-progress-track"><div className="tcc-progress-fill" /></div>
            </div>
          )}

          {data.status === 'success' && data.output && (
            <div className="tcc-section">
              <div className="tcc-label">Result</div>
              <ToolResultView output={data.output} />
              <div className="tcc-actions">
                <button className="tcc-action-btn" onClick={copy}>
                  {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy result'}
                </button>
              </div>
            </div>
          )}

          {data.status === 'error' && (
            <div className="tcc-section">
              <div className="tcc-label">Error</div>
              <div className="tcc-error-box">{data.error}</div>
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
