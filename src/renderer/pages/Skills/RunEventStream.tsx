import React from 'react'
import { Activity, CheckCircle2, Clock3, Download, Info, RefreshCw } from 'lucide-react'
import type { RuntimeError } from './skill-runtime.types'
import type { SkillRunEvent } from './skill-runtime.types'
import { formatDate } from './skill-runtime.types'

export type RunStreamStatus = 'connected' | 'reconnecting' | 'disconnected' | 'error'

export function mergeRunEvents(current: SkillRunEvent[], incoming: SkillRunEvent[]): SkillRunEvent[] {
  const bySeq = new Map<number, SkillRunEvent>()
  for (const event of [...current, ...incoming]) {
    if (!event || !Number.isFinite(event.seq)) continue
    bySeq.set(event.seq, event)
  }
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}

export function summarizeRunEvent(payload: Record<string, unknown>): string {
  const title = typeof payload.title === 'string' ? payload.title : null
  if (title) return title
  const reason = typeof payload.reason === 'string' ? payload.reason : null
  if (reason) return reason
  const entries = Object.entries(payload)
    .filter(([key]) => !/(secret|token|password|api[_-]?key)/i.test(key))
    .slice(0, 5)
  if (entries.length === 0) return '已记录'
  return entries.map(([key, value]) => `${key}: ${safeValue(value)}`).join(' · ')
}

function safeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return '[object]' }
  }
  return String(value)
}

export function RunEventStream({ events, live = false, streamStatus, reconnectAttempts = 0, streamError, onReconnect, onExportEvents }: { events: SkillRunEvent[]; live?: boolean; streamStatus?: RunStreamStatus; reconnectAttempts?: number; streamError?: string | RuntimeError | null; onReconnect?: () => void; onExportEvents?: () => void }) {
  const ordered = mergeRunEvents([], events)
  const status = streamStatus ?? (live ? 'connected' : 'disconnected')
  const statusLabel = { connected: 'connected', reconnecting: 'reconnecting', disconnected: 'disconnected', error: 'error' }[status]
  const statusMessage = { connected: 'SSE 已连接', reconnecting: 'SSE 正在重连', disconnected: 'SSE 已断开', error: 'SSE 连接错误' }[status]
  const errorMessage = typeof streamError === 'string' ? streamError : streamError?.message
  return <section className="skills-detail-section skills-event-stream" aria-labelledby="run-event-stream-title">
    <div className="skills-detail-heading skills-event-stream-head"><div><h3 id="run-event-stream-title">Event log</h3><span className="skills-event-stream-state">{live ? '实时' : '历史'} <Clock3 size={13} aria-hidden="true" /></span></div><div className={`skills-event-stream-status ${status}`} data-stream-status={status} role="status"><StatusIcon status={status} /><span>{statusMessage}</span><small>{statusLabel}{reconnectAttempts > 0 ? ` · ${reconnectAttempts} 次` : ''}</small></div></div>
    {errorMessage && <p className="skills-event-stream-error" role="alert"><Info size={13} aria-hidden="true" />{errorMessage}</p>}
    {ordered.length === 0 ? <p className="skills-muted">尚无可展示的运行事件。</p> : <ol className="skills-timeline" aria-live={live ? 'polite' : undefined}>{ordered.map((event) => <li key={`${event.runId}:${event.seq}`} data-event-seq={event.seq}>
      <span className="skills-timeline-dot" aria-hidden="true" />
      <div><strong>{event.type}</strong><p>{summarizeRunEvent(event.payload)}</p><small className="skills-muted">seq {event.seq} · {event.producer}</small></div>
      <time dateTime={new Date(event.createdAt).toISOString()}>{formatDate(event.createdAt)}</time>
    </li>)}</ol>}
    <div className="skills-event-stream-actions">{onReconnect && <button type="button" className="skills-button" onClick={onReconnect} aria-label={status === 'connected' ? '刷新事件' : '重新连接事件流'}>{status === 'connected' ? <RefreshCw size={13} aria-hidden="true" /> : <Activity size={13} aria-hidden="true" />}{status === 'connected' ? '刷新事件' : '重新连接'}</button>}{onExportEvents && <button type="button" className="skills-button" onClick={onExportEvents} aria-label="Export Events"><Download size={13} aria-hidden="true" />Export Events</button>}</div>
  </section>
}

function StatusIcon({ status }: { status: RunStreamStatus }) { return status === 'connected' ? <CheckCircle2 size={13} aria-hidden="true" /> : status === 'reconnecting' ? <RefreshCw size={13} aria-hidden="true" /> : status === 'error' ? <Info size={13} aria-hidden="true" /> : <Activity size={13} aria-hidden="true" /> }
