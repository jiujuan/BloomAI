import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSummary, Session } from '@shared/schemas'

const api = vi.hoisted(() => ({
  getSessions: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn(), updateSession: vi.fn(),
  getRecentSessions: vi.fn(), getProjects: vi.fn(), createProject: vi.fn(),
  getProjectSessions: vi.fn(), createProjectSession: vi.fn(),
}))

vi.mock('@renderer/api', () => ({ platform: api }))

import { initialProjectSessionState, useProjectStore, useSessionStore } from './index'

const project: ProjectSummary = { id: 'project-1', name: 'Alpha', root_path: 'D:/alpha', directory_kind: 'auto', created_at: 1, updated_at: 1, sessionCount: 1 }
const regular: Session = { id: 'regular-1', title: 'Recent', persona_id: null, model: 'model', status: 'active', project_id: null, created_at: 1, updated_at: 1 }
const projectSession: Session = { id: 'project-session-1', title: 'Project chat', persona_id: null, model: 'model', status: 'active', project_id: project.id, created_at: 1, updated_at: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ ...initialProjectSessionState })
  useProjectStore.setState({ projects: [], sessionIdsByProject: {}, sessionTotalsByProject: {}, projectSessionsLoading: {}, projectSessionsError: {}, loading: false, error: null })
})

describe('project and session stores', () => {
  it('loads cumulative recent pages with deduplicated session cache', async () => {
    api.getRecentSessions
      .mockResolvedValueOnce({ data: [regular], meta: { total: 2, limit: 15, offset: 0 } })
      .mockResolvedValueOnce({ data: [{ ...regular, title: 'Updated' }, { ...regular, id: 'regular-2', title: 'Second' }], meta: { total: 2, limit: 30, offset: 0 } })

    await useSessionStore.getState().loadRecentSessions({ replace: true, limit: 15 })
    await useSessionStore.getState().loadRecentSessions({ limit: 30 })

    const state = useSessionStore.getState()
    expect(api.getRecentSessions).toHaveBeenNthCalledWith(1, { limit: 15, offset: 0 })
    expect(api.getRecentSessions).toHaveBeenNthCalledWith(2, { limit: 30, offset: 0 })
    expect(state.recentSessionIds).toEqual(['regular-1', 'regular-2'])
    expect(state.recentVisibleCount).toBe(2)
    expect(state.sessions).toHaveLength(2)
    expect(state.sessions.find((session) => session.id === 'regular-1')?.title).toBe('Updated')
  })

  it('creates a project with its initial session cached and active', async () => {
    api.createProject.mockResolvedValue({ project, initialSession: projectSession })

    await expect(useProjectStore.getState().createProject({ name: 'Alpha' })).resolves.toEqual({ project, initialSession: projectSession })

    expect(useProjectStore.getState().projects).toEqual([project])
    expect(useProjectStore.getState().sessionIdsByProject).toEqual({ [project.id]: [projectSession.id] })
    expect(useSessionStore.getState()).toMatchObject({ activeSessionId: projectSession.id })
    expect(useSessionStore.getState().sessions).toEqual([projectSession])
  })

  it('creates and activates a project session while incrementing project cache count', async () => {
    useProjectStore.setState({ projects: [project], sessionIdsByProject: {}, sessionTotalsByProject: { [project.id]: 1 }, projectSessionsLoading: {}, projectSessionsError: {}, loading: false, error: null })
    api.createProjectSession.mockResolvedValue(projectSession)

    await expect(useSessionStore.getState().createProjectSession(project.id)).resolves.toEqual(projectSession)

    expect(useSessionStore.getState().activeSessionId).toBe(projectSession.id)
    expect(useProjectStore.getState().sessionIdsByProject[project.id]).toEqual([projectSession.id])
    expect(useProjectStore.getState().projects[0].sessionCount).toBe(2)
  })

  it('removes deleted sessions from recent and project caches only after API confirmation', async () => {
    useSessionStore.setState({ ...initialProjectSessionState, sessions: [regular, projectSession], recentSessionIds: [regular.id], activeSessionId: regular.id })
    useProjectStore.setState({ projects: [project], sessionIdsByProject: { [project.id]: [projectSession.id] }, sessionTotalsByProject: { [project.id]: 1 }, projectSessionsLoading: {}, projectSessionsError: {}, loading: false, error: null })
    api.deleteSession.mockRejectedValueOnce(new Error('offline'))

    await expect(useSessionStore.getState().deleteSession(regular.id)).rejects.toThrow('offline')
    expect(useSessionStore.getState().recentSessionIds).toEqual([regular.id])

    api.deleteSession.mockResolvedValueOnce(undefined)
    await useSessionStore.getState().deleteSession(projectSession.id)

    expect(useProjectStore.getState().sessionIdsByProject[project.id]).toEqual([])
    expect(useProjectStore.getState().sessionTotalsByProject[project.id]).toBe(0)
    expect(useProjectStore.getState().projects[0].sessionCount).toBe(0)
  })

  it('preserves store state when project creation fails', async () => {
    api.createProject.mockRejectedValue(new Error('Directory unavailable'))

    await expect(useProjectStore.getState().createProject({ name: 'Alpha' })).rejects.toThrow('Directory unavailable')
    expect(useProjectStore.getState().projects).toEqual([])
    expect(useSessionStore.getState().activeSessionId).toBeNull()
    expect(useProjectStore.getState().error).toBe('Directory unavailable')
  })
})
  it('keeps a project workspace blocked until its unavailable marker is cleared explicitly', () => {
    useProjectStore.getState().markWorkspaceUnavailable(project.id)
    expect(useProjectStore.getState().workspaceUnavailableProjectIds).toEqual({ [project.id]: true })

    useProjectStore.getState().clearWorkspaceUnavailable(project.id)
    expect(useProjectStore.getState().workspaceUnavailableProjectIds).toEqual({})
  })


  it('loads all project sessions across 100-item API pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...projectSession, id: `project-session-${index + 1}` }))
    const secondPage = [{ ...projectSession, id: 'project-session-101' }]
    useProjectStore.setState({
      projects: [{ ...project, sessionCount: 101 }],
      sessionIdsByProject: {},
      sessionTotalsByProject: { [project.id]: 101 },
      projectSessionsLoading: {},
      projectSessionsError: {},
      loading: false,
      error: null,
      workspaceUnavailableProjectIds: {},
    })
    api.getProjectSessions
      .mockResolvedValueOnce({ data: firstPage, meta: { total: 101, limit: 100, offset: 0 } })
      .mockResolvedValueOnce({ data: secondPage, meta: { total: 101, limit: 1, offset: 100 } })

    await useProjectStore.getState().loadProjectSessions(project.id, { limit: 'all', replace: true })

    expect(api.getProjectSessions).toHaveBeenNthCalledWith(1, project.id, { limit: 100, offset: 0 })
    expect(api.getProjectSessions).toHaveBeenNthCalledWith(2, project.id, { limit: 1, offset: 100 })
    expect(useProjectStore.getState().sessionIdsByProject[project.id]).toHaveLength(101)
  })
