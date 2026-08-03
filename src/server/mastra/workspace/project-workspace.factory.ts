import fs from 'fs'
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace'
import type { Project } from '../../../shared/schemas'

export const PROJECT_WORKSPACE_UNAVAILABLE = 'PROJECT_WORKSPACE_UNAVAILABLE' as const

/** Raised when a persisted project root can no longer safely provide a workspace. */
export class ProjectWorkspaceUnavailableError extends Error {
  readonly name = 'ProjectWorkspaceUnavailableError'
  readonly code = PROJECT_WORKSPACE_UNAVAILABLE

  constructor(readonly projectId: string, readonly rootPath: string) {
    super(`Project workspace is unavailable: ${rootPath}`)
  }
}

type ProjectWorkspace = Workspace
type CachedWorkspace = { rootPath: string; workspace: ProjectWorkspace }

export type ProjectWorkspaceFactoryDependencies = {
  createWorkspace: (rootPath: string) => ProjectWorkspace
  isDirectory: (rootPath: string) => boolean
}

export type ProjectWorkspaceFactory = {
  get(project: Project): Promise<ProjectWorkspace>
  getCached(projectId: string): ProjectWorkspace | undefined
  dispose(projectId: string): Promise<void>
  shutdown(): Promise<void>
}

function isDirectory(rootPath: string): boolean {
  try {
    return fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory()
  } catch {
    return false
  }
}

function createWorkspace(rootPath: string): Workspace {
  return new Workspace({
    filesystem: new LocalFilesystem({ basePath: rootPath }),
    sandbox: new LocalSandbox({ workingDirectory: rootPath }),
  })
}

/**
 * Keeps project workspaces keyed by durable project ID, never by client supplied paths.
 * A saved root is validated before every access so a deleted directory cannot silently
 * fall back to the process working directory.
 */
export function createProjectWorkspaceFactory(
  overrides: Partial<ProjectWorkspaceFactoryDependencies> = {},
): ProjectWorkspaceFactory {
  const dependencies: ProjectWorkspaceFactoryDependencies = {
    createWorkspace,
    isDirectory,
    ...overrides,
  }
  const cache = new Map<string, CachedWorkspace>()

  async function destroy(workspace: ProjectWorkspace): Promise<void> {
    await workspace.destroy()
  }

  async function dispose(projectId: string): Promise<void> {
    const cached = cache.get(projectId)
    if (!cached) return
    cache.delete(projectId)
    await destroy(cached.workspace)
  }

  return {
    async get(project: Project): Promise<ProjectWorkspace> {
      if (!dependencies.isDirectory(project.root_path)) {
        throw new ProjectWorkspaceUnavailableError(project.id, project.root_path)
      }

      const cached = cache.get(project.id)
      if (cached?.rootPath === project.root_path) return cached.workspace
      if (cached) await dispose(project.id)

      const workspace = dependencies.createWorkspace(project.root_path)
      cache.set(project.id, { rootPath: project.root_path, workspace })
      return workspace
    },

    getCached(projectId: string): ProjectWorkspace | undefined {
      return cache.get(projectId)?.workspace
    },

    dispose,

    async shutdown(): Promise<void> {
      const projectIds = [...cache.keys()]
      await Promise.all(projectIds.map((projectId) => dispose(projectId)))
    },
  }
}

export const projectWorkspaceFactory = createProjectWorkspaceFactory()
