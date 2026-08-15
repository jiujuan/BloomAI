import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@shared/constants'
import { platform } from '@renderer/api'
import { useSkillRuntimeStore } from './skill-runtime.store'
import type { CapabilityDto, PackageDetail, SkillInstallation, SkillRun, SkillRunEvent } from './skill-runtime.types'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const run = {
  id: 'run-1', skill_version_id: 'version-1', status: 'running', revision: 1, input: {}, output: null, context: {},
  surface: 'skills', session_id: null, image_session_id: null, waiting_reason: null, cancel_requested: false,
  started_at: 1, updated_at: 1, finished_at: null, error_code: null, error_message: null,
}
const event = (seq: number) => ({ id: `event-${seq}`, run_id: 'run-1', seq, schema_version: 1, producer: 'worker', type: 'progress', payload: { seq }, occurred_at: seq, created_at: seq })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  useSkillRuntimeStore.setState({
    packages: [], packagePage: null, selectedPackage: null, selectedVersion: null, installations: [],
    runs: [], runPage: null, selectedRun: null, eventsByRun: {}, eventCursorByRun: {}, artifactsByRun: {}, drafts: {},
    pendingMutations: {}, mutationStates: {}, toasts: [], loadingByResource: {}, requestRevisions: {}, streamStatusByRun: {}, streamReconnectAttemptsByRun: {}, streamErrorsByRun: {}, capabilities: null, settings: null, featureFlags: null, diagnostics: null, diagnosticsLoading: false, diagnosticsError: null, loading: false, error: null, errorDetails: null, errorScope: null,
  })
})

afterEach(() => {
  useSkillRuntimeStore.getState().stopRunEvents('run-1')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Package Runtime Zustand store', () => {
  it('scopes import inspection failures to the import workflow', async () => {
    const failure = { code: 'FEATURE_DISABLED', message: 'Skill Runtime feature is disabled: importEnabled', status: 403, retryable: false }
    vi.spyOn(platform, 'inspectSkillPackage').mockRejectedValue(failure)

    await expect(useSkillRuntimeStore.getState().inspectPackage({ kind: 'local-directory', directory: 'D:/skills/example' })).rejects.toEqual(failure)
    expect(useSkillRuntimeStore.getState().error).toBe(failure.message)
    expect(useSkillRuntimeStore.getState().errorDetails).toEqual(failure)
    expect(useSkillRuntimeStore.getState().errorScope).toBe('import')
  })

  it('scopes failed Package Skill starts to Runs instead of the Skill Catalog', async () => {
    const failure = { code: 'NOT_FOUND', message: 'Installed and enabled Package Skill was not found', status: 404, retryable: false }
    vi.spyOn(platform, 'createSkillRun').mockRejectedValue(failure)

    await expect(useSkillRuntimeStore.getState().startRun({ skillVersionId: 'version-1', input: {} })).rejects.toEqual(failure)
    expect(useSkillRuntimeStore.getState()).toMatchObject({
      error: failure.message,
      errorDetails: failure,
      errorScope: 'runs',
    })
  })

  it('loads runtime diagnostics and tracks a failed refresh without losing the last snapshot', async () => {
    const diagnostics = {
      health: { liveness: true, readiness: true, status: 'ready', checks: [] },
      worker: { status: 'running', workerId: 'worker-1' },
      queue: { depth: 0, queued: 0, leased: 0, retryWait: 0, dead: 0, lagMs: 0 },
      migration: { current: '043', applied: ['043'], pending: [] },
      policy: { version: 'skills-policy-v1.1', configVersion: '2026-08-06' },
      recentFailures: [],
    }
    const diagnosticsMock = vi.spyOn(platform, 'getSkillRuntimeDiagnostics').mockResolvedValue(diagnostics)

    await expect(useSkillRuntimeStore.getState().loadDiagnostics()).resolves.toEqual(diagnostics)
    expect(diagnosticsMock).toHaveBeenCalledTimes(1)
    expect(useSkillRuntimeStore.getState()).toMatchObject({ diagnostics, diagnosticsLoading: false, diagnosticsError: null })

    diagnosticsMock.mockRejectedValueOnce({ code: 'FORBIDDEN', message: 'administrator-only detail', status: 403, retryable: false })
    await expect(useSkillRuntimeStore.getState().loadDiagnostics()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(useSkillRuntimeStore.getState()).toMatchObject({ diagnostics, diagnosticsLoading: false, diagnosticsError: 'administrator-only detail' })
  })

  it('loads and deduplicates events while advancing the per-run cursor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [event(1), event(2)], meta: { afterSeq: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: [event(2), event(3)], meta: { afterSeq: 2 } }))
    vi.stubGlobal('fetch', fetchMock)

    await useSkillRuntimeStore.getState().loadRunEvents('run-1')
    await useSkillRuntimeStore.getState().loadRunEvents('run-1')

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/skill-runs/run-1/events?afterSeq=0`, expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/skill-runs/run-1/events?afterSeq=2`, expect.any(Object))
    expect(useSkillRuntimeStore.getState().eventsByRun['run-1'].map((item) => item.seq)).toEqual([1, 2, 3])
    expect(useSkillRuntimeStore.getState().eventCursorByRun['run-1']).toBe(3)
  })

  it('does not let an older package request overwrite a newer response', async () => {
    const first = deferred<Awaited<ReturnType<typeof platform.getSkillPackages>>>()
    const second = deferred<Awaited<ReturnType<typeof platform.getSkillPackages>>>()
    const packagesMock = vi.spyOn(platform, 'getSkillPackages')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const olderRequest = useSkillRuntimeStore.getState().loadPackages({ search: 'older' })
    const newerRequest = useSkillRuntimeStore.getState().loadPackages({ search: 'newer' })
    second.resolve({ data: [{ id: 'newer', name: 'Newer', description: '', sourceType: 'github', sourceUri: null, sourceRef: null, createdAt: 2, updatedAt: 2, deletedAt: null, deleteReason: null }], meta: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null } })
    await newerRequest
    first.resolve({ data: [{ id: 'older', name: 'Older', description: '', sourceType: 'local', sourceUri: null, sourceRef: null, createdAt: 1, updatedAt: 1, deletedAt: null, deleteReason: null }], meta: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null } })
    await olderRequest

    expect(packagesMock).toHaveBeenNthCalledWith(1, { search: 'older' })
    expect(packagesMock).toHaveBeenNthCalledWith(2, { search: 'newer' })
    expect(useSkillRuntimeStore.getState().packages).toEqual([expect.objectContaining({ id: 'newer', name: 'Newer' })])
    expect(useSkillRuntimeStore.getState().packagePage?.data).toEqual([expect.objectContaining({ id: 'newer' })])
    expect(useSkillRuntimeStore.getState().loadingByResource.packages).toBe(false)
  })

  it('loads every package page for the Skills Center catalog', async () => {
    const packagePage = (id: string, offset: number, hasMore: boolean, nextOffset: number | null) => ({
      data: [{ id, name: id, description: '', sourceType: 'github', sourceUri: null, sourceRef: 'main', createdAt: offset, updatedAt: offset, deletedAt: null, deleteReason: null }],
      meta: { limit: 100, offset, total: 21, hasMore, nextOffset },
    })
    const packagesMock = vi.spyOn(platform, 'getSkillPackages')
      .mockResolvedValueOnce(packagePage('first', 0, true, 1))
      .mockResolvedValueOnce(packagePage('second', 1, false, null))

    await useSkillRuntimeStore.getState().loadPackages()

    expect(packagesMock).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 })
    expect(packagesMock).toHaveBeenNthCalledWith(2, { limit: 100, offset: 1 })
    expect(useSkillRuntimeStore.getState().packages.map((item) => item.id)).toEqual(['first', 'second'])
    expect(useSkillRuntimeStore.getState().packagePage?.meta).toMatchObject({ offset: 0, total: 21, hasMore: false, nextOffset: null })
  })
  it('keeps the complete installation collection when loading package detail', async () => {
    const catalogInstallations: SkillInstallation[] = [
      { id: 'install-1', packageId: 'pkg-1', currentVersionId: 'version-1', revision: 1, status: 'installed', enabled: true, installedAt: 1, updatedAt: 1, previousVersionId: null, changedAt: null, disabledAt: null, uninstalledAt: null, deletedAt: null, rollbackReason: null },
      { id: 'install-2', packageId: 'pkg-2', currentVersionId: 'version-2', revision: 1, status: 'installed', enabled: true, installedAt: 1, updatedAt: 1, previousVersionId: null, changedAt: null, disabledAt: null, uninstalledAt: null, deletedAt: null, rollbackReason: null },
    ]
    const detail: PackageDetail = {
      package: { id: 'pkg-1', name: 'First Skill', description: '', sourceType: 'github', sourceUri: null, sourceRef: 'main', createdAt: 1, updatedAt: 1, deletedAt: null, deleteReason: null },
      versions: [],
      installations: [catalogInstallations[0]],
      capabilityGrants: [],
    }
    useSkillRuntimeStore.setState({ installations: catalogInstallations })
    vi.spyOn(platform, 'getSkillPackage').mockResolvedValue(detail)

    await useSkillRuntimeStore.getState().loadPackage('pkg-1')

    expect(useSkillRuntimeStore.getState().installations).toEqual(catalogInstallations)
    expect(useSkillRuntimeStore.getState().selectedPackage?.installations).toHaveLength(1)
  })

  it('optimistically toggles an installation and restores the snapshot with an error toast on failure', async () => {
    const installation: SkillInstallation = { id: 'install-1', packageId: 'pkg-1', currentVersionId: 'version-1', revision: 1, status: 'enabled', enabled: true, installedAt: 1, updatedAt: 1, previousVersionId: null, changedAt: null, disabledAt: null, uninstalledAt: null, deletedAt: null, rollbackReason: null }
    useSkillRuntimeStore.setState({ installations: [installation] })
    const failure = { code: 'NETWORK_ERROR', message: 'worker unavailable', status: 503, retryable: true }
    vi.spyOn(platform, 'disableSkillInstallation').mockRejectedValue(failure)

    const request = useSkillRuntimeStore.getState().disableInstallation('install-1', { expectedRevision: 1, idempotencyKey: 'disable-1' })
    expect(useSkillRuntimeStore.getState().installations[0]).toMatchObject({ enabled: false, status: 'disabled' })
    await expect(request).rejects.toMatchObject(failure)
    expect(useSkillRuntimeStore.getState().installations).toEqual([installation])
    expect(useSkillRuntimeStore.getState().mutationStates['installation:install-1']).toMatchObject({ status: 'error', error: failure })
    expect(useSkillRuntimeStore.getState().toasts).toEqual([expect.objectContaining({ tone: 'error', message: 'worker unavailable' })])
    expect(useSkillRuntimeStore.getState().pendingMutations).toEqual({})
  })

  it('records a successful mutation and emits a success toast', async () => {
    const installation: SkillInstallation = { id: 'install-1', packageId: 'pkg-1', currentVersionId: 'version-1', revision: 1, status: 'disabled', enabled: false, installedAt: 1, updatedAt: 1, previousVersionId: null, changedAt: null, disabledAt: null, uninstalledAt: null, deletedAt: null, rollbackReason: null }
    useSkillRuntimeStore.setState({ installations: [installation] })
    const enabled = { ...installation, enabled: true, status: 'enabled', updatedAt: 2 }
    vi.spyOn(platform, 'enableSkillInstallation').mockResolvedValue(enabled)

    await expect(useSkillRuntimeStore.getState().enableInstallation('install-1', { expectedRevision: 2, idempotencyKey: 'enable-1' })).resolves.toEqual(enabled)
    expect(useSkillRuntimeStore.getState().mutationStates['installation:install-1']).toMatchObject({ status: 'success' })
    expect(useSkillRuntimeStore.getState().toasts).toEqual([expect.objectContaining({ tone: 'success', title: 'Installation 已启用' })])
  })

  it('reconnects a run stream from the last cursor without duplicating events', async () => {
    const streamHandlers: Array<Parameters<typeof platform.subscribeSkillRunEvents>[2]> = []
    vi.spyOn(platform, 'subscribeSkillRunEvents').mockImplementation((_runId, _afterSeq, handlers) => {
      streamHandlers.push(handlers)
      return { close: vi.fn() }
    })
    const listEventsMock = vi.spyOn(platform, 'listSkillRunEvents').mockResolvedValue([])

    const unsubscribe = useSkillRuntimeStore.getState().subscribeRunEvents('run-1')
    const initialStream = streamHandlers[0]
    if (!initialStream) throw new Error('initial stream was not created')
    initialStream.onEvent?.({ ...event(1), runId: 'run-1', schemaVersion: 1, occurredAt: 1, createdAt: 1 } as SkillRunEvent)
    expect(useSkillRuntimeStore.getState().eventCursorByRun['run-1']).toBe(1)
    await useSkillRuntimeStore.getState().reconnectRunEvents('run-1')
    expect(listEventsMock).toHaveBeenCalledWith('run-1', 1)

    useSkillRuntimeStore.getState().subscribeRunEvents('run-1')
    const reconnect = streamHandlers[1]
    if (!reconnect) throw new Error('reconnect stream was not created')
    reconnect.onEvent?.({ ...event(1), runId: 'run-1', schemaVersion: 1, occurredAt: 1, createdAt: 1 } as SkillRunEvent)
    reconnect.onEvent?.({ ...event(2), runId: 'run-1', schemaVersion: 1, occurredAt: 2, createdAt: 2 } as SkillRunEvent)
    expect(useSkillRuntimeStore.getState().eventsByRun['run-1'].map((item) => item.seq)).toEqual([1, 2])
    expect(useSkillRuntimeStore.getState().eventCursorByRun['run-1']).toBe(2)
    unsubscribe()
  })

  it('uses afterSeq compensation after a failed stream/list refresh and preserves server truth on mutation conflict', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [event(1)], meta: { afterSeq: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'NETWORK_ERROR', message: 'offline', retryable: true } }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: [event(2)], meta: { afterSeq: 1 } }))
    vi.stubGlobal('fetch', fetchMock)

    await useSkillRuntimeStore.getState().loadRunEvents('run-1')
    await expect(useSkillRuntimeStore.getState().reconnectRunEvents('run-1')).resolves.toEqual([expect.objectContaining({ seq: 2 })])
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/skill-runs/run-1/events?afterSeq=1`, expect.any(Object))
    expect(useSkillRuntimeStore.getState().eventCursorByRun['run-1']).toBe(2)

    const conflictFetch = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'REVISION_CONFLICT', message: 'stale', retryable: false } }, 409))
    vi.stubGlobal('fetch', conflictFetch)
    await expect(useSkillRuntimeStore.getState().enableInstallation('install-1', { expectedRevision: 1, idempotencyKey: 'idem' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(useSkillRuntimeStore.getState().pendingMutations).toEqual({})
    expect(useSkillRuntimeStore.getState().errorDetails).toMatchObject({ code: 'REVISION_CONFLICT', status: 409 })
  })

  it('loads a draft for creator editing and refreshes server truth after a revision conflict', async () => {
    const draft = { id: 'draft-1', content: { name: 'Draft', slug: 'draft', skillMd: '# Draft' }, revision: 4, status: 'draft' }
    const getDraftMock = vi.spyOn(platform, 'getSkillDraft').mockResolvedValue(draft)
    await expect(useSkillRuntimeStore.getState().loadDraft('draft-1')).resolves.toEqual(draft)
    expect(getDraftMock).toHaveBeenCalledWith('draft-1')
    expect(useSkillRuntimeStore.getState().drafts['draft-1']).toEqual(draft)
    await useSkillRuntimeStore.getState().refreshAfterConflict('draft', 'draft-1')
    expect(getDraftMock).toHaveBeenCalledTimes(2)
  })

  it('keeps package runs out of the legacy store boundary', async () => {
    vi.spyOn(platform, 'getSkillRun').mockResolvedValue({ id: 'run-1', skillVersionId: 'version-1', status: 'running', revision: 1, input: {}, output: null, context: {}, surface: 'skills', sessionId: null, imageSessionId: null, waitingReason: null, waitingSince: null, waitingExpiresAt: null, requiredAction: null, cancelRequested: false, startedAt: 1, updatedAt: 1, finishedAt: null, errorCode: null, errorMessage: null, resultSummary: null })
    const loaded = await useSkillRuntimeStore.getState().loadRun('run-1')
    expect(loaded.id).toBe('run-1')
    expect(useSkillRuntimeStore.getState().runs).toEqual([])
  })

  it('passes server revision and unique idempotency keys for approval, waiting input, retry and cancel commands', async () => {
    const serverRun: SkillRun = {
      id: 'run-1', skillVersionId: 'version-1', status: 'running', revision: 2, input: {}, output: null, context: {},
      surface: 'skills', sessionId: null, imageSessionId: null, waitingReason: null, requiredAction: null,
      cancelRequested: false, startedAt: 1, updatedAt: 2, finishedAt: null, errorCode: null, errorMessage: null,
    }
    const dispatchMock = vi.spyOn(platform, 'dispatchSkillRunCommand').mockResolvedValue(serverRun)
    const cancelMock = vi.spyOn(platform, 'cancelSkillRun').mockResolvedValue(serverRun)
    vi.spyOn(platform, 'listSkillRunEvents').mockResolvedValue([])

    await useSkillRuntimeStore.getState().approveRun('run-1', 7)
    await useSkillRuntimeStore.getState().rejectRun('run-1', 8, 'not needed')
    await useSkillRuntimeStore.getState().submitRunInput('run-1', 9, { topic: 'image' })
    await useSkillRuntimeStore.getState().retryRun('run-1', 10)
    await useSkillRuntimeStore.getState().cancelRun('run-1', 11, 'user requested')

    expect(dispatchMock).toHaveBeenNthCalledWith(1, 'run-1', expect.objectContaining({ type: 'approve', expectedRevision: 7, idempotencyKey: expect.stringMatching(/^approve-/) }))
    expect(dispatchMock).toHaveBeenNthCalledWith(2, 'run-1', expect.objectContaining({ type: 'reject', expectedRevision: 8, reason: 'not needed', idempotencyKey: expect.stringMatching(/^reject-/) }))
    expect(dispatchMock).toHaveBeenNthCalledWith(3, 'run-1', expect.objectContaining({ type: 'submit_input', expectedRevision: 9, input: { topic: 'image' }, idempotencyKey: expect.stringMatching(/^submit_input-/) }))
    expect(dispatchMock).toHaveBeenNthCalledWith(4, 'run-1', expect.objectContaining({ type: 'retry', expectedRevision: 10, idempotencyKey: expect.stringMatching(/^retry-/) }))
    expect(cancelMock).toHaveBeenCalledWith('run-1', expect.objectContaining({ expectedRevision: 11, reason: 'user requested', idempotencyKey: expect.stringMatching(/^cancel-/) }))
    expect(new Set(dispatchMock.mock.calls.map(([, command]) => command.idempotencyKey)).size).toBe(4)
    expect(new Set([...dispatchMock.mock.calls.map(([, command]) => command.idempotencyKey), cancelMock.mock.calls[0][1].idempotencyKey]).size).toBe(5)
  })

  it('exports an Artifact through the typed runtime action with an audit reason', async () => {
    const exportMock = vi.spyOn(platform, 'exportSkillArtifact').mockResolvedValue({ path: 'D:/exports/report.md' })
    await expect(useSkillRuntimeStore.getState().exportArtifact('artifact-1', { runId: 'run-1', destinationDir: 'D:/exports', confirmed: true, auditReason: 'Skills Center acceptance' })).resolves.toEqual({ path: 'D:/exports/report.md' })
    expect(exportMock).toHaveBeenCalledWith('artifact-1', { runId: 'run-1', destinationDir: 'D:/exports', confirmed: true, auditReason: 'Skills Center acceptance' })
    expect(useSkillRuntimeStore.getState().pendingMutations).toEqual({})
  })

  it('converges capability grant state, deduplicates repeated approval and keeps package context', async () => {
    const grant: CapabilityDto = {
      id: 'grant-1', skillVersionId: 'version-1', capability: 'network.fetch',
      scope: { allowedDomains: ['example.com'], maxCalls: 3 }, status: 'requested', grantMode: 'persistent',
      grantedBy: null, grantedAt: null, expiresAt: null, revokedAt: null, consumedAt: null,
      requestedScope: { allowedDomains: ['example.com'], maxCalls: 3 }, grantedScope: {},
    }
    const detail: PackageDetail = {
      package: { id: 'package-1', name: 'Research', description: 'Research', sourceType: 'github', sourceUri: null, sourceRef: 'main', createdAt: 1, updatedAt: 1, deletedAt: null, deleteReason: null },
      versions: [{ id: 'version-1', packageId: 'package-1', version: '1.0.0', runtime: 'instruction-agent', manifest: {}, manifestHash: 'manifest-1', packagePath: '/packages/package-1', sourceSnapshot: {}, isCompatible: true, status: 'runnable', securityStatus: 'verified', createdAt: 1 }],
      installations: [], capabilityGrants: [grant],
    }
    useSkillRuntimeStore.setState({ selectedPackage: detail })
    const approval = deferred<CapabilityDto>()
    const approveMock = vi.spyOn(platform, 'approveCapabilityGrant').mockReturnValue(approval.promise)

    const first = useSkillRuntimeStore.getState().approve('grant-1', { actor: 'test-user' })
    const second = useSkillRuntimeStore.getState().approve('grant-1', { actor: 'test-user' })
    expect(approveMock).toHaveBeenCalledTimes(1)
    expect(useSkillRuntimeStore.getState().pendingMutations['grant:grant-1']).toBe(true)

    approval.resolve({ ...grant, status: 'approved', grantedBy: 'test-user', grantedAt: 2, grantedScope: grant.requestedScope })
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(useSkillRuntimeStore.getState().selectedPackage?.capabilityGrants[0]).toMatchObject({ id: 'grant-1', status: 'approved', grantedBy: 'test-user' })
    expect(useSkillRuntimeStore.getState().pendingMutations).toEqual({})

    const rejectMock = vi.spyOn(platform, 'rejectCapabilityGrant').mockResolvedValue({ ...grant, status: 'rejected' })
    await useSkillRuntimeStore.getState().reject('grant-1', { actor: 'test-user', reason: 'not needed' })
    expect(useSkillRuntimeStore.getState().selectedPackage?.capabilityGrants[0].status).toBe('rejected')
    expect(rejectMock).toHaveBeenCalledWith('grant-1', { actor: 'test-user', reason: 'not needed' })

    const revokeMock = vi.spyOn(platform, 'revokeCapabilityGrant').mockResolvedValue({})
    await useSkillRuntimeStore.getState().revokeCapabilityGrant('grant-1', { actor: 'test-user', reason: 'policy changed' })
    expect(useSkillRuntimeStore.getState().selectedPackage?.capabilityGrants[0]).toMatchObject({ id: 'grant-1', status: 'revoked' })
    expect(revokeMock).toHaveBeenCalledWith('grant-1', { actor: 'test-user', reason: 'policy changed' })
  })

  it('does not mutate a capability grant when the server rejects the operation', async () => {
    const grant: CapabilityDto = { id: 'grant-2', skillVersionId: 'version-2', capability: 'filesystem.read', scope: {}, status: 'requested' }
    useSkillRuntimeStore.setState({ selectedPackage: { package: { id: 'package-2', name: 'Files', description: '', sourceType: 'local', sourceUri: null, sourceRef: null, createdAt: 1, updatedAt: 1, deletedAt: null, deleteReason: null }, versions: [], installations: [], capabilityGrants: [grant] } })
    const error = { code: 'REVISION_CONFLICT', message: 'Grant 已被其他操作者更新', status: 409, retryable: false }
    vi.spyOn(platform, 'approveCapabilityGrant').mockRejectedValue(error)

    await expect(useSkillRuntimeStore.getState().approve('grant-2', { actor: 'test-user' })).rejects.toEqual(error)
    expect(useSkillRuntimeStore.getState().selectedPackage?.capabilityGrants[0]).toEqual(grant)
    expect(useSkillRuntimeStore.getState().errorDetails).toMatchObject({ code: 'REVISION_CONFLICT', status: 409 })
    expect(useSkillRuntimeStore.getState().toasts.at(-1)).toMatchObject({ tone: 'error' })
    expect(useSkillRuntimeStore.getState().pendingMutations).toEqual({})
  })

})