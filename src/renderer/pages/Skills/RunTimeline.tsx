import React from 'react'
import { Clock3 } from 'lucide-react'
import type { SkillRunEvent } from './skill-runtime.types'
import { formatDate } from './skill-runtime.types'
import { mergeRunEvents, summarizeRunEvent } from './RunEventStream'

export function RunTimeline({ events }: { events: SkillRunEvent[] }) {
  const ordered = mergeRunEvents([], events)
  return <section className="skills-detail-section" aria-labelledby="run-timeline-title"><div className="skills-detail-heading"><div><h3 id="run-timeline-title">Execution Timeline</h3><p className="skills-muted">事件按 server seq 去重并按顺序展示。</p></div><Clock3 size={15} aria-hidden="true" /></div>
    {ordered.length === 0 ? <p className="skills-muted">尚无可展示的状态变化。</p> : <ol className="skills-timeline">{ordered.map((event) => <li key={`${event.runId}:${event.seq}`} data-event-seq={event.seq}><span className={'skills-timeline-dot ' + eventTone(event.type)} aria-hidden="true" /><div><strong>{event.type}</strong><p>{summarizeRunEvent(event.payload)}</p></div><time>{formatDate(event.createdAt)}</time></li>)}</ol>}
  </section>
}

function eventTone(type: string) { if (type.includes('failed') || type.includes('error')) return 'danger'; if (type.includes('completed')) return 'success'; if (type.includes('approval') || type.includes('waiting')) return 'warning'; return 'info' }
