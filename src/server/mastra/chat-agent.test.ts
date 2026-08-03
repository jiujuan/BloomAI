import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCached: vi.fn() }))
vi.mock('./workspace/project-workspace.factory', () => ({
  projectWorkspaceFactory: { getCached: mocks.getCached },
}))

import { omitWorkspaceToolCollisions, resolveProjectWorkspace } from './chat-agent'

describe('chatAgent project workspace resolver', () => {
  it('uses only a server-provided projectId and gives ordinary chats no workspace', () => {
    const workspace = { id: 'workspace-a' }
    mocks.getCached.mockReturnValue(workspace)

    expect(resolveProjectWorkspace({ get: vi.fn(() => 'project-a') })).toBe(workspace)
    expect(mocks.getCached).toHaveBeenCalledWith('project-a')

    mocks.getCached.mockClear()
    expect(resolveProjectWorkspace({ get: vi.fn(() => undefined) })).toBeUndefined()
    expect(mocks.getCached).not.toHaveBeenCalled()
  })

  it('reserves Mastra workspace tool ids for a project workspace', () => {
    expect(omitWorkspaceToolCollisions({
      web_search: { id: 'web_search' },
      mastra_workspace_read_file: { id: 'legacy-collision' },
    })).toEqual({ web_search: { id: 'web_search' } })
  })
})
