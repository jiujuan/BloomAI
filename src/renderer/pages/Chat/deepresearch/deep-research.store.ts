import { create } from 'zustand'
import { platform } from '@renderer/api'
import type {
  ResearchArtifactDto,
  ResearchClarificationInput,
  ResearchEventDto,
  ResearchQuestionDto,
  ResearchReportDto,
  ResearchRunDetailDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
  StartResearchInput,
} from '@shared/deepresearch/contracts'
import type { ResearchEventType } from '@shared/deepresearch/events'
import type { DeepResearchDraft, DeepResearchLifecycle, DeepResearchView } from './deep-research.types'
import { deepResearchErrorMessage } from './error-message'

const TERMINAL_STATUSES = new Set<ResearchRunDto['status']>([
  'completed',
  'completed_with_limitations',
  'cancelled',
  'failed',
  'interrupted',
])

const TERMINAL_EVENT_TYPES = new Set<string>([
  'research.run.completed',
  'research.run.failed',
  'research.run.cancelled',
])

const DETAIL_REFRESH_EVENT_TYPES = new Set<string>([
  ...TERMINAL_EVENT_TYPES,
  'research.run.awaiting_input',
  'research.artifact.created',
  'research.clarification.answered',
  'research.attempt.completed',
  'research.checkpoint.completed',
  'research.coverage.assessment_completed',
  'research.iteration.planned',
  'research.iteration.stopped',
  'research.iteration.stop_decided',
  'research.run.cancellation_requested',
  'research.run.interrupted',
  'research.run.resumed',
  'research.recovery.reconciled',
])

const RESEARCH_EVENT_TYPES: ResearchEventType[] = [
  'research.run.created',
  'research.run.status_changed',
  'research.brief.completed',
  'research.questions.planned',
  'research.query.started',
  'research.query.completed',
  'research.query.failed',
  'research.source.discovered',
  'research.source.selected',
  'research.source.fetch_failed',
  'research.sources.fetched',
  'research.evidence.extracted',
  'research.coverage.assessed',
  'research.iteration.started',
  'research.iteration.completed',
  'research.section.drafted',
  'research.claim.verified',
  'research.quality.assessed',
  'research.artifact.created',
  'research.run.awaiting_input',
  'research.clarification.answered',
  'research.run.completed',
  'research.run.failed',
  'research.run.cancelled',
  'research.attempt.created',
  'research.attempt.started',
  'research.attempt.completed',
  'research.checkpoint.completed',
  'research.coverage.assessment_completed',
  'research.coverage.gap_detected',
  'research.iteration.planned',
  'research.iteration.stopped',
  'research.iteration.stop_decided',
  'research.run.cancellation_requested',
  'research.run.interrupted',
  'research.run.resumed',
  'research.recovery.reconciled',
]

export interface DeepResearchEventSource {
  close: () => void
  onerror: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  onopen: ((event: Event) => void) | null
  addEventListener?: (type: string, listener: (event: MessageEvent<string>) => void) => void
}

export interface DeepResearchApiClient {
  start: (input: StartResearchInput) => Promise<ResearchRunDto>
  get: (runId: string) => Promise<ResearchRunDetailDto>
  listEvents: (runId: string, after?: number) => Promise<ResearchEventDto[]>
  answerClarification: (runId: string, input: ResearchClarificationInput) => Promise<ResearchRunDto>
  cancel: (runId: string) => Promise<ResearchRunDto>
  resume: (runId: string) => Promise<ResearchRunDto>
  streamUrl: (runId: string, after: number) => string
}

export interface DeepResearchStoreDependencies {
  api?: DeepResearchApiClient
  eventSourceFactory?: (url: string) => DeepResearchEventSource
}

export interface DeepResearchStoreState {
  draft: DeepResearchDraft
  activeRunId: string | null
  run: ResearchRunDto | null
  lifecycle: DeepResearchLifecycle
  questions: ResearchQuestionDto[]
  sources: ResearchSourceDto[]
  snapshotsById: Record<string, ResearchSourceSnapshotDto>
  report: ResearchReportDto | null
  artifacts: ResearchArtifactDto[]
  evidenceById: Record<string, import('@shared/deepresearch/contracts').ResearchEvidenceDto>
  events: ResearchEventDto[]
  lastSequence: number
  selectedView: DeepResearchView
  selectedEvidenceId: string | null
  loading: boolean
  error: string | null
  setDraft: (patch: Partial<DeepResearchDraft>) => void
  setSelectedView: (view: DeepResearchView) => void
  selectEvidence: (evidenceId: string | null) => void
  setError: (error: string | null) => void
  reset: () => void
  start: () => Promise<void>
  openRun: (runId: string) => Promise<void>
  refreshRun: (runId?: string) => Promise<void>
  applyEvent: (event: ResearchEventDto) => void
  pollEvents: (runId?: string) => Promise<void>
  answerClarification: (clarificationId: string, answer: string) => Promise<void>
  cancel: () => Promise<void>
  resume: () => Promise<void>
}

function initialState(): Omit<DeepResearchStoreState, 'setDraft' | 'setSelectedView' | 'selectEvidence' | 'setError' | 'reset' | 'start' | 'openRun' | 'refreshRun' | 'applyEvent' | 'pollEvents' | 'answerClarification' | 'cancel' | 'resume'> {
  return {
    draft: { topic: '', profile: 'general', depth: 'standard' },
    activeRunId: null,
    run: null,
    lifecycle: null,
    questions: [],
    sources: [],
    snapshotsById: {},
    report: null,
    artifacts: [],
    evidenceById: {},
    events: [],
    lastSequence: 0,
    selectedView: 'overview',
    selectedEvidenceId: null,
    loading: false,
    error: null,
  }
}

function toRun(detail: ResearchRunDetailDto): ResearchRunDto {
  const { questions, searchQueries, sources, snapshots, evidence, report, events, artifacts, lifecycle, ...run } = detail
  return run
}

function errorMessage(error: unknown): string {
  return deepResearchErrorMessage(error)
}

function isTerminal(run: ResearchRunDto): boolean {
  return TERMINAL_STATUSES.has(run.status)
}

function eventIdentity(event: ResearchEventDto): string {
  return event.eventId ?? `${event.runId}:${event.sequence}`
}

function mergeEvents(current: ResearchEventDto[], incoming: ResearchEventDto[]): ResearchEventDto[] {
  const byEventId = new Map<string, ResearchEventDto>()
  for (const event of current) byEventId.set(eventIdentity(event), event)
  for (const event of incoming) byEventId.set(eventIdentity(event), event)
  return [...byEventId.values()].sort((left, right) => left.sequence - right.sequence)
}
function detailCollections(detail: ResearchRunDetailDto) {
  return {
    run: toRun(detail),
    lifecycle: detail.lifecycle ?? null,
    questions: detail.questions,
    sources: detail.sources,
    snapshotsById: Object.fromEntries(detail.snapshots.map((snapshot) => [snapshot.id, snapshot])),
    report: detail.report,
    artifacts: detail.artifacts,
    evidenceById: Object.fromEntries(detail.evidence.map((evidence) => [evidence.id, evidence])),
  }
}

export function createDeepResearchStore(dependencies: DeepResearchStoreDependencies = {}) {
  const api = dependencies.api ?? platform.deepResearch
  const eventSourceFactory = dependencies.eventSourceFactory ?? defaultEventSourceFactory
  let stream: DeepResearchEventSource | null = null
  let pollingTimer: ReturnType<typeof setTimeout> | null = null

  const clearPolling = () => {
    if (pollingTimer !== null) {
      clearTimeout(pollingTimer)
      pollingTimer = null
    }
  }

  const closeStream = () => {
    if (stream) stream.close()
    stream = null
  }

  const disconnect = () => {
    closeStream()
    clearPolling()
  }

  return create<DeepResearchStoreState>((set, get) => {
    const hydrate = (detail: ResearchRunDetailDto) => {
      set((state) => {
        const events = mergeEvents(state.events, detail.events)
        return {
          ...detailCollections(detail),
          events,
          lastSequence: Math.max(state.lastSequence, ...events.map((event) => event.sequence)),
        }
      })
    }

    const schedulePolling = (runId: string) => {
      clearPolling()
      pollingTimer = setTimeout(async () => {
        pollingTimer = null
        await get().pollEvents(runId)
        const run = get().run
        if (get().activeRunId !== runId || !run || isTerminal(run)) return
        if (eventSourceFactory) connect(runId)
        else schedulePolling(runId)
      }, 2_000)
    }

    const handleMessage = (runId: string, message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as ResearchEventDto
        if (event.runId !== runId) return
        get().applyEvent(event)
      } catch {
        set({ error: '研究进度事件格式无效' })
      }
    }

    const connect = (runId: string) => {
      if (!eventSourceFactory || get().activeRunId !== runId) {
        if (get().activeRunId === runId) schedulePolling(runId)
        return
      }
      closeStream()
      const source = eventSourceFactory(api.streamUrl(runId, get().lastSequence))
      stream = source
      const onMessage = (message: MessageEvent<string>) => handleMessage(runId, message)
      source.onmessage = onMessage
      source.onopen = () => { clearPolling() }
      source.onerror = () => {
        if (stream !== source) return
        closeStream()
        const run = get().run
        if (get().activeRunId === runId && run && !isTerminal(run)) schedulePolling(runId)
      }
      for (const type of RESEARCH_EVENT_TYPES) source.addEventListener?.(type, onMessage)
    }

    return {
      ...initialState(),
      setDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
      setSelectedView: (selectedView) => set({ selectedView }),
      selectEvidence: (selectedEvidenceId) => set({ selectedEvidenceId }),
      setError: (error) => set({ error }),
      reset: () => {
        disconnect()
        set(initialState())
      },
      start: async () => {
        set({ loading: true, error: null })
        try {
          const run = await api.start(get().draft)
          await get().openRun(run.id)
        } catch (error) {
          set({ error: errorMessage(error) })
        } finally {
          set({ loading: false })
        }
      },
      openRun: async (runId) => {
        disconnect()
        set({ activeRunId: runId, loading: true, error: null })
        try {
          const detail = await api.get(runId)
          if (get().activeRunId !== runId) return
          hydrate(detail)
          const run = get().run
          if (run && !isTerminal(run)) connect(runId)
        } catch (error) {
          if (get().activeRunId === runId) set({ error: errorMessage(error) })
        } finally {
          if (get().activeRunId === runId) set({ loading: false })
        }
      },
      refreshRun: async (runId = get().activeRunId ?? undefined) => {
        if (!runId) return
        try {
          const detail = await api.get(runId)
          if (get().activeRunId !== runId) return
          hydrate(detail)
          if (isTerminal(detail)) disconnect()
        } catch (error) {
          if (get().activeRunId === runId) set({ error: errorMessage(error) })
        }
      },
      applyEvent: (event) => {
        const state = get()
        if (state.events.some((current) => eventIdentity(current) === eventIdentity(event))) {
          if (event.sequence > state.lastSequence) set({ lastSequence: event.sequence })
          return
        }
        if (event.sequence <= state.lastSequence) return
        set({ events: [...state.events, event], lastSequence: event.sequence })
        if (DETAIL_REFRESH_EVENT_TYPES.has(event.type)) void get().refreshRun(event.runId)
        if (TERMINAL_EVENT_TYPES.has(event.type)) disconnect()
      },
      pollEvents: async (runId = get().activeRunId ?? undefined) => {
        if (!runId || get().activeRunId !== runId) return
        try {
          const events = await api.listEvents(runId, get().lastSequence)
          if (get().activeRunId !== runId) return
          for (const event of events) get().applyEvent(event)
        } catch (error) {
          if (get().activeRunId === runId) set({ error: errorMessage(error) })
        }
      },
      answerClarification: async (clarificationId, answer) => {
        const runId = get().activeRunId
        if (!runId) return
        set({ loading: true, error: null })
        try {
          await api.answerClarification(runId, { clarificationId, answer })
          await get().refreshRun(runId)
        } catch (error) {
          set({ error: errorMessage(error) })
        } finally {
          set({ loading: false })
        }
      },
      cancel: async () => {
        const { activeRunId: runId, run, lifecycle } = get()
        const capabilities = lifecycle?.capabilities ?? run?.capabilities
        if (!runId || !run || run.status === 'cancelling' || (capabilities && !capabilities.canCancel)) return
        set({ loading: true, error: null })
        try {
          await api.cancel(runId)
          await get().refreshRun(runId)
        } catch (error) {
          set({ error: errorMessage(error) })
        } finally {
          set({ loading: false })
        }
      },
      resume: async () => {
        const { activeRunId: runId, run, lifecycle } = get()
        const capabilities = lifecycle?.capabilities ?? run?.capabilities
        if (!runId || !run || run.status === 'cancelled' || (capabilities && !capabilities.canResume && !capabilities.canRetry)) return
        set({ loading: true, error: null })
        try {
          await api.resume(runId)
          await get().refreshRun(runId)
          const run = get().run
          if (get().activeRunId === runId && run && !isTerminal(run)) connect(runId)
        } catch (error) {
          set({ error: errorMessage(error) })
        } finally {
          set({ loading: false })
        }
      },
    }
  })
}

const defaultEventSourceFactory = typeof EventSource === 'undefined'
  ? undefined
  : (url: string): DeepResearchEventSource => new EventSource(url)

export const useDeepResearchStore = createDeepResearchStore()
