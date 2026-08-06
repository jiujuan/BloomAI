import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@shared/constants'
import { platform } from '@renderer/api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const packageRow = {
  id: 'pkg-1',
  name: 'Demo',
  description: 'A demo package',
  source_type: 'local',
  source_uri: null,
  source_ref: null,
  created_at: 10,
  updated_at: 11,
  deleted_at: null,
  delete_reason: null,
}

const runRow = {
  id: 'run-1',
  skill_version_id: 'version-1',
  status: 'running',
  revision: 2,
  input: {},
  output: null,
  context: {},
  surface: 'skills',
  session_id: null,
  image_session_id: null,
  waiting_reason: null,
  cancel_requested: false,
  started_at: 12,
  updated_at: 13,
  finished_at: null,
  error_code: null,
  error_message: null,
}

const eventRow = {
  id: 'event-2',
  run_id: 'run-1',
  seq: 2,
  schema_version: 1,
  producer: 'worker',
  type: 'progress',
  payload: { percent: 50 },
  occurred_at: 14,
  created_at: 14,
}

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly url: string
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === 'function' ? listener as (event: MessageEvent) => void : (event: MessageEvent) => listener.handleEvent(event)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const current = this.listeners.get(type) ?? []
    const callback = typeof listener === 'function' ? listener as (event: MessageEvent) => void : (event: MessageEvent) => listener.handleEvent(event)
    this.listeners.set(type, current.filter((candidate) => candidate !== callback))
  }

  close() { this.closed = true }

  emit(type: string, value: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(value) })
    if (type === 'message') this.onmessage?.(event)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Package Runtime renderer API', () => {
  it('provides typed package, version, installation and run pagination without exposing DB row names', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [packageRow], meta: { limit: 2, offset: 4, total: 5, hasMore: false, nextOffset: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: [runRow], meta: { limit: 10, offset: 0, total: 1, hasMore: false, nextOffset: null } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(platform.getSkillPackages({ limit: 2, offset: 4 })).resolves.toEqual({
      data: [{
        id: 'pkg-1', name: 'Demo', description: 'A demo package', sourceType: 'local', sourceUri: null,
        sourceRef: null, createdAt: 10, updatedAt: 11, deletedAt: null, deleteReason: null,
      }],
      meta: { limit: 2, offset: 4, total: 5, hasMore: false, nextOffset: null },
    })
    await expect(platform.listSkillRuns({ limit: 10, offset: 0 })).resolves.toMatchObject({ data: [{ id: 'run-1', skillVersionId: 'version-1', cancelRequested: false }], meta: { total: 1 } })

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/skill-packages?limit=2&offset=4`, expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/skill-runs?limit=10&offset=0`, expect.any(Object))
  })

  it('normalizes run events and exposes stream URLs with an afterSeq cursor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [eventRow], meta: { afterSeq: 1 } })))

    await expect(platform.listSkillRunEvents('run/1', 1)).resolves.toEqual([{
      id: 'event-2', runId: 'run-1', seq: 2, schemaVersion: 1, producer: 'worker', type: 'progress',
      payload: { percent: 50 }, occurredAt: 14, createdAt: 14,
    }])
    expect(platform.skillRunEventsStreamUrl('run/1', 2)).toBe(`${API_BASE}/skill-runs/run%2F1/stream?afterSeq=2`)
  })


  it('loads run capabilities and consumes named SSE events with an afterSeq cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{
      id: 'grant-1', skill_version_id: 'version-1', capability: 'image.generate', status: 'approved',
      scope_json: '{\"allowedModels\":[\"medium\"]}', requested_scope_json: '{\"allowedModels\":[\"medium\"]}',
      granted_scope_json: '{\"allowedModels\":[\"medium\"]}', grant_mode: 'run', granted_at: 15,
    }] }))
    vi.stubGlobal('fetch', fetchMock)
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)

    await expect(platform.getSkillRunCapabilities('run/1')).resolves.toEqual([expect.objectContaining({
      id: 'grant-1', skillVersionId: 'version-1', capability: 'image.generate', scope: { allowedModels: ['medium'] },
      requestedScope: { allowedModels: ['medium'] }, grantedScope: { allowedModels: ['medium'] },
    })])
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/skill-runs/run%2F1/capabilities`, expect.any(Object))

    const received: unknown[] = []
    const subscription = platform.subscribeSkillRunEvents('run/1', 7, { onEvent: (event) => received.push(event) })
    const source = MockEventSource.instances[0]
    source.emit('run.status_changed', { ...eventRow, type: 'run.status_changed', seq: 8 })

    expect(source.url).toBe(`${API_BASE}/skill-runs/run%2F1/stream?afterSeq=7`)
    expect(received).toEqual([expect.objectContaining({ runId: 'run-1', seq: 8, type: 'run.status_changed' })])
    subscription.close()
    expect(source.closed).toBe(true)
  })

  it('sends typed commands, drafts and artifact exports and normalizes structured errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: runRow }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'draft-1', revision: 1 } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { path: 'out/file.md' } }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'REVISION_CONFLICT', message: 'stale', requestId: 'req-1', retryable: false } }, 409))
    vi.stubGlobal('fetch', fetchMock)

    await expect(platform.dispatchSkillRunCommand('run-1', { type: 'cancel', expectedRevision: 2, idempotencyKey: 'idem-1' })).resolves.toMatchObject({ id: 'run-1', skillVersionId: 'version-1' })
    await expect(platform.createSkillDraft({ content: { name: 'Demo', slug: 'demo', skillMd: '# Demo' } })).resolves.toMatchObject({ id: 'draft-1', revision: 1 })
    await expect(platform.exportSkillArtifact('artifact-1', { runId: 'run-1', destinationDir: 'D:/exports', confirmed: true, auditReason: 'test export' })).resolves.toEqual({ path: 'out/file.md' })
    await expect(platform.enableSkillInstallation('install-1', { expectedRevision: 2, idempotencyKey: 'idem-2' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 409, requestId: 'req-1', retryable: false })

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/skill-runs/run-1/commands`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ type: 'cancel', expectedRevision: 2, idempotencyKey: 'idem-1' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/skill-drafts`, expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/skill-artifacts/artifact-1/export`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ runId: 'run-1', destinationDir: 'D:/exports', confirmed: true, auditReason: 'test export' }) }))
  })
})