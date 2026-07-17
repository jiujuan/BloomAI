import type { ResearchEventDto } from '@shared/deepresearch/contracts'

type ResearchEventListener = (event: ResearchEventDto) => void

const listenersByRunId = new Map<string, Set<ResearchEventListener>>()

export function publishResearchEvent(event: ResearchEventDto): void {
  for (const listener of listenersByRunId.get(event.runId) ?? []) {
    try {
      listener(event)
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
