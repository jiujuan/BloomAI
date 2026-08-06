import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@shared/constants'
import { platform } from '@renderer/api'
import { useSkillRuntimeStore } from './skill-runtime.store'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const run = {
  id: 'run-1', skill_version_id: 'version-1', status: 'running', revision: 1, input: {}, output: null, context: {},
  surface: 'skills', session_id: null, image_session_id: null, waiting_reason: null, cancel_requested: false,
  started_at: 1, updated_at: 1, finished_at: null, error_code: null, error_message: null,
}
const event = (seq: number) => ({ id: `event-${seq}`, run_id: 'run-1', seq, schema_version: 1, producer: 'worker', type: 'progress', payload: { seq }, occurred_at: seq, created_at: seq })

beforeEach(() => {
  useSkillRuntimeStore.setState({
    packages: [], packagePage: null, selectedPackage: null, selectedVersion: null, installations: [],
    runs: [], runPage: null, selectedRun: null, eventsByRun: {}, eventCursorByRun: {}, artifactsByRun: {}, drafts: {},
    pendingMutations: {}, capabilities: null, loading: false, error: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Package Runtime Zustand store', () => {
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

  it('keeps package runs out of the legacy store boundary', async () => {
    vi.spyOn(platform, 'getSkillRun').mockResolvedValue({ id: 'run-1', skillVersionId: 'version-1', status: 'running', revision: 1, input: {}, output: null, context: {}, surface: 'skills', sessionId: null, imageSessionId: null, waitingReason: null, waitingSince: null, waitingExpiresAt: null, requiredAction: null, cancelRequested: false, startedAt: 1, updatedAt: 1, finishedAt: null, errorCode: null, errorMessage: null, resultSummary: null })
    const loaded = await useSkillRuntimeStore.getState().loadRun('run-1')
    expect(loaded.id).toBe('run-1')
    expect(useSkillRuntimeStore.getState().runs).toEqual([])
  })

  it('exports an Artifact through the typed runtime action with an audit reason', async () => {
    const exportMock = vi.spyOn(platform, 'exportSkillArtifact').mockResolvedValue({ path: 'D:/exports/report.md' })
    await expect(useSkillRuntimeStore.getState().exportArtifact('artifact-1', { runId: 'run-1', destinationDir: 'D:/exports', confirmed: true, auditReason: 'Skills Center acceptance' })).resolves.toEqual({ path: 'D:/exports/report.md' })
    expect(exportMock).toHaveBeenCalledWith('artifact-1', { runId: 'run-1', destinationDir: 'D:/exports', confirmed: true, auditReason: 'Skills Center acceptance' })
    expect(useSkillRuntimeStore.getState().pendingMutations).toEqual({})
  })
})