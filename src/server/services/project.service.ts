import fs from 'fs'
import path from 'path'
import type { CreateProjectInput, Project, ProjectSummary, Session, SessionPage } from '../../shared/schemas'
import { getWorkspacesDir } from '../db/paths'
import { projectRepo } from '../db/repositories/project.repo'
import { sessionRepo } from '../db/repositories/session.repo'
import { settingsRepo } from '../db/repositories/settings.repo'
import { ServiceError } from './errors'

export interface ProjectSessionInput { title?: string; persona_id?: string; model?: string }
export interface PageInput { limit: number; offset: number }

function validatePage({ limit, offset }: PageInput): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ServiceError('VALIDATION_ERROR', 'limit must be an integer between 1 and 100')
  if (!Number.isInteger(offset) || offset < 0) throw new ServiceError('VALIDATION_ERROR', 'offset must be a non-negative integer')
}

function validateName(name: unknown): string {
  if (typeof name !== 'string') throw new ServiceError('VALIDATION_ERROR', 'Project name is required')
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 80) throw new ServiceError('VALIDATION_ERROR', 'Project name must contain 1 to 80 characters')
  return trimmed
}

function resolveSelectedDirectory(sourceDirectory: string): string {
  const resolved = path.resolve(sourceDirectory)
  if (!fs.existsSync(resolved)) throw new ServiceError('VALIDATION_ERROR', 'Selected directory does not exist')
  if (!fs.statSync(resolved).isDirectory()) throw new ServiceError('VALIDATION_ERROR', 'Selected path must be a directory')
  return fs.realpathSync(resolved)
}

function highestProjectNumber(workspacesDir: string): number {
  const directoryNumbers = fs.readdirSync(workspacesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^NewProject(\d+)$/.exec(entry.name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  const registeredNumbers = projectRepo.listSummaries().filter((project) => project.directory_kind === 'auto')
    .map((project) => path.basename(project.root_path)).map((name) => /^NewProject(\d+)$/.exec(name)?.[1])
    .filter((value): value is string => value !== undefined).map(Number)
  return Math.max(0, ...directoryNumbers, ...registeredNumbers)
}

function createAutoDirectory(): string {
  const workspacesDir = getWorkspacesDir()
  fs.mkdirSync(workspacesDir, { recursive: true })
  for (let number = highestProjectNumber(workspacesDir) + 1; ; number += 1) {
    const candidate = path.join(workspacesDir, `NewProject${number}`)
    try {
      fs.mkdirSync(candidate)
      return fs.realpathSync(candidate)
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
}

function removeEmptyAutoDirectory(directory: string): void {
  try {
    if (fs.existsSync(directory) && fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory)
  } catch {
    // Best effort only: never risk removing non-empty user data.
  }
}

export const projectService = {
  createProject(input: CreateProjectInput): { project: ProjectSummary; initialSession: Session } {
    const name = validateName(input?.name)
    let rootPath: string; let directoryKind: 'auto' | 'selected'; let autoDirectory: string | undefined
    if (input.sourceDirectory) {
      rootPath = resolveSelectedDirectory(input.sourceDirectory)
      directoryKind = 'selected'
    } else {
      autoDirectory = createAutoDirectory()
      rootPath = autoDirectory
      directoryKind = 'auto'
    }

    const existing = projectRepo.getByRootPath(rootPath)
    if (existing) {
      if (autoDirectory) removeEmptyAutoDirectory(autoDirectory)
      throw new ServiceError('CONFLICT', `Directory is already registered to project ${existing.name}`, { projectName: existing.name })
    }

    try {
      const created = projectRepo.createWithInitialSession({ name, root_path: rootPath, directory_kind: directoryKind })
      return { project: { ...created.project, sessionCount: 1 }, initialSession: created.initialSession }
    } catch (error) {
      if (autoDirectory) removeEmptyAutoDirectory(autoDirectory)
      throw error
    }
  },

  listProjects(): ProjectSummary[] { return projectRepo.listSummaries() },

  listProjectSessions(projectId: string, page: PageInput): SessionPage {
    if (!projectRepo.get(projectId)) throw new ServiceError('NOT_FOUND', 'Project not found')
    validatePage(page)
    return { data: projectRepo.listProjectSessions(projectId, page), meta: { total: projectRepo.countProjectSessions(projectId), ...page } }
  },

  createProjectSession(projectId: string, input: ProjectSessionInput = {}): Session {
    if (!projectRepo.get(projectId)) throw new ServiceError('NOT_FOUND', 'Project not found')
    const session = projectRepo.createProjectSession(projectId, { ...input, model: input.model ?? settingsRepo.getValue('model') ?? undefined })
    projectRepo.updateTimestamp(projectId)
    return session
  },

  resolveProjectForSession(sessionId: string): Project | null {
    const session = sessionRepo.get(sessionId)
    return session?.project_id ? projectRepo.get(session.project_id) ?? null : null
  },
}
