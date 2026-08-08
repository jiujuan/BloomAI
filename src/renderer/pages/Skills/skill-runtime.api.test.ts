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
  it('unwraps the runtime diagnostics response envelope and calls the protected endpoint', async () => {
    const diagnostics = {
      health: { liveness: true, readiness: true, status: 'ready', checks: [] },
      worker: { status: 'running', workerId: 'worker-1' },
      queue: { depth: 0, queued: 0, leased: 0, retryWait: 0, dead: 0, lagMs: 0 },
      migration: { current: '043', applied: ['043'], pending: [] },
      policy: { version: 'skills-policy-v1.1', configVersion: '2026-08-06' },
      recentFailures: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: diagnostics, meta: { requestId: 'req-diagnostics-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(platform.getSkillRuntimeDiagnostics()).resolves.toEqual(diagnostics)
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/skill-runtime/diagnostics`, expect.any(Object))
  })

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

  it('encodes package filters and normalizes runtime settings and feature flag DTOs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [packageRow], meta: { limit: 5, offset: 0, total: 1, hasMore: false, nextOffset: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { import: { allowedKinds: ['github'] }, security: {}, artifacts: {}, runtime: {}, revision: 3 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { runtime_enabled: true, creator_enabled: false } }))
    vi.stubGlobal('fetch', fetchMock)

    await platform.getSkillPackages({ limit: 5, search: 'a/b & c', sourceType: 'github/archive', includeArchived: true, sort: 'updatedAt', direction: 'desc' })
    await expect(platform.getSkillRuntimeSettings()).resolves.toMatchObject({ import: { allowedKinds: ['github'] }, revision: 3 })
    await expect(platform.getSkillRuntimeFeatureFlags()).resolves.toEqual({ runtime_enabled: true, creator_enabled: false })

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/skill-packages?limit=5&offset=0&search=a%2Fb+%26+c&sourceType=github%2Farchive&includeArchived=true&sort=updatedAt&direction=desc`, expect.any(Object))
  })

  it('encodes dynamic ids, converts inspection DTOs and wires import review decisions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { review_id: 'review-1', source_fingerprint: 'fingerprint-1', packages: [{ source_type: 'github', relative_skill_path: 'skills/demo', manifest_hash: 'sha', source_fingerprint: 'fingerprint-1', diagnostics: [{ severity: 'warning', message: 'Review required' }], import_review_required: true, manifest: { name: 'Demo', runtime: 'package-runtime', requested_capabilities: [] }, source_snapshot: { source_sha256: 'source-sha', files: [] } }] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'draft/1', content: { name: 'Demo', slug: 'demo', skillMd: '# Demo' }, revision: 2, status: 'draft' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'review/1', source: 'github', source_sha: 'source-sha', source_ref: 'main', security_findings: {}, status: 'pending', reviewer: null, decision: null, created_at: 10, updated_at: 11 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'review/1', source: 'github', source_sha: 'source-sha', source_ref: 'main', security_findings: {}, status: 'approved', reviewer: 'local-user', decision: { action: 'approve' }, created_at: 10, updated_at: 12 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'review/1', source: 'github', source_sha: 'source-sha', source_ref: 'main', security_findings: {}, status: 'rejected', reviewer: 'local-user', decision: { action: 'reject', reason: 'unsafe' }, created_at: 10, updated_at: 13 } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(platform.inspectSkillPackage({ kind: 'github-archive', repositoryUrl: 'https://github.com/acme/demo', ref: 'main' })).resolves.toMatchObject({ reviewId: 'review-1', sourceFingerprint: 'fingerprint-1', packages: [expect.objectContaining({ sourceType: 'github', manifestHash: 'sha', sourceFingerprint: 'fingerprint-1', importReviewRequired: true, sourceSnapshot: { sourceSha256: 'source-sha', files: [] } })] })
    await platform.getSkillDraft('draft/1')
    await expect(platform.getImportReview('review/1')).resolves.toMatchObject({ id: 'review/1', status: 'pending' })
    await expect(platform.approveImportReview('review/1', 'local-user')).resolves.toMatchObject({ status: 'approved', reviewer: 'local-user' })
    await expect(platform.rejectImportReview('review/1', 'local-user', 'unsafe')).resolves.toMatchObject({ status: 'rejected', reviewer: 'local-user' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/skill-packages/inspect`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ source: { kind: 'github-archive', repositoryUrl: 'https://github.com/acme/demo', ref: 'main' } }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/skill-drafts/draft%2F1`, expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/skill-import-reviews/review%2F1`, expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(4, `${API_BASE}/skill-import-reviews/review%2F1/approve`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ reviewer: 'local-user' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, `${API_BASE}/skill-import-reviews/review%2F1/reject`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ reviewer: 'local-user', reason: 'unsafe' }) }))
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