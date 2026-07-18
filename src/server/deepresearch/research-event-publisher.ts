import type { ResearchEventDto } from '@shared/deepresearch/contracts'

type ResearchEventListener = (event: ResearchEventDto) => void

const listenersByRunId = new Map<string, Set<ResearchEventListener>>()

/**
 * Normalizes the additive V2 event ID even for in-process test or compatibility
 * publishers that have not yet populated the durable database event ID.
 */
function withStableEventId(event: ResearchEventDto): ResearchEventDto {
  return event.eventId ? event : { ...event, eventId: `${event.runId}:${event.sequence}` }
}

export function publishResearchEvent(event: ResearchEventDto): void {
  const published = withStableEventId(event)
  for (const listener of listenersByRunId.get(published.runId) ?? []) {
    try {
      listener(published)
    } catch {
      // Listener failures must never affect durable event persistence.
    }
  }
}

export function subscribeToResearchEvents(runId: string, listener: ResearchEventListener): () => void {
  const listeners = listenersByRunId.get(runId) ?? new Set<ResearchEventListener>()
  listeners.add(listener)
  listenersByRunId.set(runId, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByRunId.delete(runId)
  }
}
