import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@shared/constants'
import { platform } from './index'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('project platform API', () => {
  it('uses encoded project paths and typed project/session request bodies', async () => {
    const project = { id: 'project/one', name: 'One', root_path: 'D:/one', directory_kind: 'auto', created_at: 1, updated_at: 1, sessionCount: 1 }
    const session = { id: 'session-1', title: 'Chat', persona_id: null, model: 'model', status: 'active', project_id: project.id, created_at: 1, updated_at: 1 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [project] }))
      .mockResolvedValueOnce(jsonResponse({ data: { project, initialSession: session } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: [session], meta: { total: 1, limit: 10, offset: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: session }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: [session], meta: { total: 1, limit: 15, offset: 0 } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(platform.getProjects()).resolves.toEqual([project])
    await expect(platform.createProject({ name: ' One ', sourceDirectory: 'D:/one' })).resolves.toEqual({ project, initialSession: session })
    await expect(platform.getProjectSessions('project/one', { limit: 10, offset: 0 })).resolves.toEqual({ data: [session], meta: { total: 1, limit: 10, offset: 0 } })
    await expect(platform.createProjectSession('project/one', { title: 'New chat' })).resolves.toEqual(session)
    await expect(platform.getRecentSessions({ limit: 15, offset: 0 })).resolves.toEqual({ data: [session], meta: { total: 1, limit: 15, offset: 0 } })

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/projects`, expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/projects`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: ' One ', sourceDirectory: 'D:/one' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/projects/project%2Fone/sessions?limit=10&offset=0`, expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(4, `${API_BASE}/projects/project%2Fone/sessions`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'New chat' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, `${API_BASE}/sessions?scope=recent&limit=15&offset=0`, expect.any(Object))
  })

  it('preserves the shared HTTP error message for project mutations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'PROJECT_DIRECTORY_CONFLICT', message: 'Directory is already assigned.' } }, 409)))

    await expect(platform.createProject({ name: 'One' })).rejects.toEqual(expect.objectContaining({
      message: 'Directory is already assigned.',
      status: 409,
      code: 'PROJECT_DIRECTORY_CONFLICT',
    }))
  })

  it('uses the Electron directory bridge and safely cancels outside Electron', async () => {
    await expect(platform.selectDirectory()).resolves.toEqual({ canceled: true })

    const selectDirectory = vi.fn().mockResolvedValue({ canceled: false, path: 'D:/selected' })
    vi.stubGlobal('window', { bloomai: { selectDirectory } })

    await expect(platform.selectDirectory()).resolves.toEqual({ canceled: false, path: 'D:/selected' })
    expect(selectDirectory).toHaveBeenCalledOnce()
  })
})