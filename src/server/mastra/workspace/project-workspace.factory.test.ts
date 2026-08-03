import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectWorkspaceFactory } from './project-workspace.factory'

const temporaryDirectories: string[] = []

function makeDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-workspace-'))
  temporaryDirectories.push(directory)
  return directory
}

function project(id: string, root_path: string) {
  return {
    id,
    name: id,
    root_path,
    directory_kind: 'selected' as const,
    created_at: 1,
    updated_at: 1,
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('ProjectWorkspaceFactory', () => {
  it('maps every project root to its own workspace and reuses an unchanged cached workspace', async () => {
    const projectA = project('project-a', makeDirectory())
    const projectB = project('project-b', makeDirectory())
    const createWorkspace = vi.fn((rootPath: string) => ({ rootPath, destroy: vi.fn() }))
    const factory = createProjectWorkspaceFactory({ createWorkspace: createWorkspace as any })

    const workspaceA = await factory.get(projectA)
    const workspaceAAgain = await factory.get(projectA)
    const workspaceB = await factory.get(projectB)

    expect(createWorkspace).toHaveBeenCalledTimes(2)
    expect(createWorkspace).toHaveBeenNthCalledWith(1, projectA.root_path)
    expect(createWorkspace).toHaveBeenNthCalledWith(2, projectB.root_path)
    expect(workspaceAAgain).toBe(workspaceA)
    expect(workspaceB).not.toBe(workspaceA)
  })

  it('creates Mastra filesystem and sandbox providers at the saved project root', async () => {
    const rootPath = makeDirectory()
    const factory = createProjectWorkspaceFactory()

    const workspace = await factory.get(project('project-a', rootPath)) as any

    expect(workspace.filesystem.basePath).toBe(rootPath)
    expect(workspace.sandbox.workingDirectory).toBe(rootPath)
    await factory.shutdown()
  })

  it('destroys a stale workspace before rebuilding it when the saved project root changes', async () => {
    const firstRoot = makeDirectory()
    const secondRoot = makeDirectory()
    const firstWorkspace = { destroy: vi.fn().mockResolvedValue(undefined) }
    const secondWorkspace = { destroy: vi.fn().mockResolvedValue(undefined) }
    const createWorkspace = vi.fn().mockReturnValueOnce(firstWorkspace).mockReturnValueOnce(secondWorkspace)
    const factory = createProjectWorkspaceFactory({ createWorkspace: createWorkspace as any })

    await factory.get(project('project-a', firstRoot))
    const rebuilt = await factory.get(project('project-a', secondRoot))

    expect(firstWorkspace.destroy).toHaveBeenCalledOnce()
    expect(createWorkspace).toHaveBeenNthCalledWith(2, secondRoot)
    expect(rebuilt).toBe(secondWorkspace)
  })

  it('rejects a missing or non-directory root instead of falling back to a host working directory', async () => {
    const createWorkspace = vi.fn()
    const factory = createProjectWorkspaceFactory({ createWorkspace: createWorkspace as any })
    const missing = path.join(makeDirectory(), 'missing')
    const file = path.join(makeDirectory(), 'not-a-directory.txt')
    fs.writeFileSync(file, 'not a directory')

    await expect(factory.get(project('missing', missing))).rejects.toMatchObject({
      code: 'PROJECT_WORKSPACE_UNAVAILABLE',
      projectId: 'missing',
    })
    await expect(factory.get(project('file', file))).rejects.toMatchObject({
      code: 'PROJECT_WORKSPACE_UNAVAILABLE',
      projectId: 'file',
    })
    expect(createWorkspace).not.toHaveBeenCalled()
  })

  it('disposes one project or every project during shutdown', async () => {
    const workspaceA = { destroy: vi.fn().mockResolvedValue(undefined) }
    const workspaceB = { destroy: vi.fn().mockResolvedValue(undefined) }
    const createWorkspace = vi.fn().mockReturnValueOnce(workspaceA).mockReturnValueOnce(workspaceB)
    const factory = createProjectWorkspaceFactory({ createWorkspace: createWorkspace as any })

    await factory.get(project('project-a', makeDirectory()))
    await factory.get(project('project-b', makeDirectory()))
    await factory.dispose('project-a')
    await factory.shutdown()
    await factory.shutdown()

    expect(workspaceA.destroy).toHaveBeenCalledOnce()
    expect(workspaceB.destroy).toHaveBeenCalledOnce()
  })
})
