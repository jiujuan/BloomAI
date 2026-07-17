import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchEventDto, ResearchRunDetailDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { createDeepResearchStore, type DeepResearchEventSource, type DeepResearchStoreDependencies } from './deep-research.store'

class FakeEventSource implements DeepResearchEventSource {
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>()
  closed = false

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener)
  }

  close() {
    this.closed = true
  }

  emit(event: ResearchEventDto) {
    const message = { data: JSON.stringify(event) } as MessageEvent<string>
    this.listeners.get(event.type)?.(message)
  }

  fail() {
    this.onerror?.(new Event('error'))
  }
}

function detail(overrides: Partial<ResearchRunDetailDto> = {}): ResearchRunDetailDto {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    topic: 'Enterprise AI assistant market',
    profile: 'market',
    depth: 'deep',
    status: 'researching',
    phase: 'researching',
    progress: 40,
    brief: null,
    workflowRunId: null,
    budget: {
      maxQuestions: 12, maxIterations: 4, maxSearchQueries: 20, maxNormalizedSources: 30,
      maxFetchedSources: 20, searchConcurrency: 2, fetchConcurrency: 2, maxDurationMs: 60_000,
    },
    usage: {
      questions: 2, iterations: 1, searchQueries: 4, normalizedSources: 5, fetchedSources: 4,
      tokens: 0, providerCostUsd: 0, startedAt: 1, deadlineAt: 60_001,
    },
    quality: null,
    reportArtifactId: null,
    resumePhase: null,
    error: null,
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
    questions: [{
      id: 'question-1', runId: 'run-1', parentQuestionId: null, ordinal: 1, question: 'What is the market size?',
      intent: 'market size', requiredEvidenceTypes: ['primary'], priority: 'high', status: 'researching', coverage: null,
    }],
    searchQueries: [],
    sources: [{
      id: 'source-1', runId: 'run-1', canonicalUrl: 'https://example.com', domain: 'example.com', title: 'Source',
      author: null, publisher: null, publishedAt: null, sourceType: 'web', selectionStatus: 'selected', scores: {},
    }],
    snapshots: [],
    evidence: [{
      id: 'evidence-1', runId: 'run-1', questionId: 'question-1', snapshotId: 'snapshot-1', passage: 'Evidence',
      summary: 'Summary', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 8,
    }],
    report: null,
    events: [],
    artifacts: [],
    ...overrides,
  }
}

function event(sequence: number, type = 'research.questions.planned'): ResearchEventDto {
  return { runId: 'run-1', sequence, type, phase: 'researching', timestamp: sequence, payload: { id: 'event-' + sequence } }
}

function asRun(detailValue: ResearchRunDetailDto): ResearchRunDto {
  const { questions, searchQueries, sources, snapshots, evidence, report, events, artifacts, ...run } = detailValue
  return run
}

function createHarness(options: { eventSource?: boolean } = {}) {
  const run = detail()
  const sources: FakeEventSource[] = []
  const api = {
    start: vi.fn(async () => asRun(run)),
    list: vi.fn(async () => [asRun(run)]),
    get: vi.fn(async () => run),
    listEvents: vi.fn(async () => [] as ResearchEventDto[]),
    answerClarification: vi.fn(async () => asRun(run)),
    cancel: vi.fn(async () => ({ ...asRun(run), status: 'cancelling' as const })),
    resume: vi.fn(async () => ({ ...asRun(run), status: 'queued' as const })),
    streamUrl: vi.fn((runId: string, after: number) => '/api/v1/deep-research/runs/' + runId + '/stream?after=' + after),
  }
  const dependencies: DeepResearchStoreDependencies = {
    api,
    eventSourceFactory: options.eventSource === false ? undefined : (url) => {
      const source = new FakeEventSource()
      sources.push(source)
      return source
    },
  }
  return { store: createDeepResearchStore(dependencies), api, sources, run }
}

describe('deep research store', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('provides launcher defaults and maintains independent draft updates', () => {
    const { store } = createHarness()
    store.getState().setDraft({ topic: 'AI assistant market', depth: 'exhaustive' })

    expect(store.getState()).toMatchObject({
      draft: { topic: 'AI assistant market', profile: 'general', depth: 'exhaustive' },
      activeRunId: null,
      selectedView: 'overview',
      selectedEvidenceId: null,
      loading: false,
      error: null,
    })
  })

  it('starts research, hydrates the active run, and derives detail collections', async () => {
    const { store, api } = createHarness()
    store.getState().setDraft({ topic: 'Enterprise AI assistant market', profile: 'market', depth: 'deep', sessionId: 'session-1' })

    await store.getState().start()

    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ topic: 'Enterprise AI assistant market', profile: 'market', depth: 'deep' }))
    expect(api.get).toHaveBeenCalledWith('run-1')
    expect(store.getState()).toMatchObject({
      activeRunId: 'run-1',
      run: expect.objectContaining({ id: 'run-1' }),
      questions: [expect.objectContaining({ id: 'question-1' })],
      sources: [expect.objectContaining({ id: 'source-1' })],
      report: null,
      evidenceById: { 'evidence-1': expect.objectContaining({ id: 'evidence-1' }) },
    })
  })

  it('reduces only ordered, non-duplicate events and retains errors', () => {
    const { store } = createHarness({ eventSource: false })
    store.getState().setError('A previous request failed')
    store.getState().applyEvent(event(2))
    store.getState().applyEvent(event(1, 'research.query.started'))
    store.getState().applyEvent(event(2))
    store.getState().applyEvent(event(3, 'research.evidence.extracted'))

    expect(store.getState().events.map((current) => current.sequence)).toEqual([2, 3])
    expect(store.getState().lastSequence).toBe(3)
    expect(store.getState().error).toBe('A previous request failed')
  })

  it('falls back to two-second polling after a live stream disconnect and reconnects from its cursor', async () => {
    const { store, api, sources } = createHarness()
    await store.getState().openRun('run-1')
    expect(api.streamUrl).toHaveBeenLastCalledWith('run-1', 0)
    expect(sources).toHaveLength(1)

    sources[0].emit(event(1))
    sources[0].fail()
    expect(sources[0].closed).toBe(true)

    api.listEvents.mockResolvedValueOnce([event(2, 'research.source.selected')])
    await vi.advanceTimersByTimeAsync(2_000)

    expect(api.listEvents).toHaveBeenCalledWith('run-1', 1)
    expect(store.getState().lastSequence).toBe(2)
    expect(api.streamUrl).toHaveBeenLastCalledWith('run-1', 2)
    expect(sources).toHaveLength(2)
  })

  it('refreshes details and stops live progress for terminal, clarification, and artifact events', async () => {
    const { store, api, sources } = createHarness()
    await store.getState().openRun('run-1')
    api.get.mockClear()

    sources[0].emit(event(1, 'research.run.awaiting_input'))
    await Promise.resolve()
    expect(api.get).toHaveBeenCalledWith('run-1')

    api.get.mockClear()
    sources[0].emit(event(2, 'research.artifact.created'))
    await Promise.resolve()
    expect(api.get).toHaveBeenCalledWith('run-1')

    sources[0].emit(event(3, 'research.run.completed'))
    await Promise.resolve()
    expect(sources[0].closed).toBe(true)
  })

  it('calls cancel, resume, and clarification APIs before refreshing the active run', async () => {
    const { store, api } = createHarness({ eventSource: false })
    await store.getState().openRun('run-1')
    api.get.mockClear()

    await store.getState().answerClarification('scope', 'United States')
    await store.getState().cancel()
    await store.getState().resume()

    expect(api.answerClarification).toHaveBeenCalledWith('run-1', { clarificationId: 'scope', answer: 'United States' })
    expect(api.cancel).toHaveBeenCalledWith('run-1')
    expect(api.resume).toHaveBeenCalledWith('run-1')
    expect(api.get).toHaveBeenCalledTimes(3)
  })

  it('retains an action error until a later successful user action clears it', async () => {
    const { store, api } = createHarness({ eventSource: false })
    store.getState().setDraft({ topic: 'A valid topic', profile: 'general', depth: 'standard' })
    api.start.mockRejectedValueOnce(new Error('Research service unavailable'))

    await store.getState().start()
    expect(store.getState().error).toBe('Research service unavailable')

    await store.getState().start()
    expect(store.getState().error).toBeNull()
  })
})
