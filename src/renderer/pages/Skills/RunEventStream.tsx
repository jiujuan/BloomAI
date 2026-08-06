import React from 'react'
import { Clock3 } from 'lucide-react'
import type { SkillRunEvent } from './skill-runtime.types'
import { formatDate } from './skill-runtime.types'

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

export function RunEventStream({ events, live = false, onReconnect }: { events: SkillRunEvent[]; live?: boolean; onReconnect?: () => void }) {
  const ordered = mergeRunEvents([], events)
  return <section className="skills-detail-section skills-event-stream" aria-labelledby="run-event-stream-title">
    <div className="skills-detail-heading"><h3 id="run-event-stream-title">Event log</h3><span className="skills-event-stream-state">{live ? '实时' : '历史'} <Clock3 size={13} aria-hidden="true" /></span></div>
    {ordered.length === 0 ? <p className="skills-muted">尚无可展示的运行事件。</p> : <ol className="skills-timeline" aria-live={live ? 'polite' : undefined}>{ordered.map((event) => <li key={`${event.runId}:${event.seq}`} data-event-seq={event.seq}>
      <span className="skills-timeline-dot" aria-hidden="true" />
      <div><strong>{event.type}</strong><p>{summarizeRunEvent(event.payload)}</p><small className="skills-muted">seq {event.seq} · {event.producer}</small></div>
      <time dateTime={new Date(event.createdAt).toISOString()}>{formatDate(event.createdAt)}</time>
    </li>)}</ol>}
    {onReconnect && <button type="button" className="skills-text-button" onClick={onReconnect}>刷新事件</button>}
  </section>
}
