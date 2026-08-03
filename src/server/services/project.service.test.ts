import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadProjectService() {
  vi.resetModules(); process.env.DATA_DIR = dataDir
  const client = await import('../db/client'); await client.runMigrations()
  return { client, projectService: (await import('./project.service')).projectService, projectRepo: (await import('../db/repositories/project.repo')).projectRepo }
}

describe('projectService', () => {
  beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-project-service-')); originalEnv = { ...process.env } })
  afterEach(async () => { (await import('../db/client')).closeDb(); vi.restoreAllMocks(); vi.resetModules(); process.env = originalEnv; fs.rmSync(dataDir, { recursive: true, force: true }) })

  it('creates selected projects with an initial project session without modifying the selected directory', async () => {
    const selected = path.join(dataDir, 'selected'); fs.mkdirSync(selected); fs.writeFileSync(path.join(selected, 'keep.txt'), 'keep')
    const { projectService } = await loadProjectService()
    const result = projectService.createProject({ name: '  Selected  ', sourceDirectory: selected })
    expect(result.project).toMatchObject({ name: 'Selected', root_path: fs.realpathSync(selected), directory_kind: 'selected' })
    expect(result.initialSession).toMatchObject({ title: 'New Chat', project_id: result.project.id })
    expect(fs.readFileSync(path.join(selected, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('creates sequential auto directories from existing gaps and registered projects', async () => {
    const { projectService } = await loadProjectService()
    const workspaces = path.join(dataDir, 'workspaces'); fs.mkdirSync(workspaces, { recursive: true }); fs.mkdirSync(path.join(workspaces, 'NewProject1')); fs.mkdirSync(path.join(workspaces, 'NewProject3'))
    const created = projectService.createProject({ name: 'Auto' })
    const next = projectService.createProject({ name: 'Auto next' })
    expect(created.project.root_path).toBe(fs.realpathSync(path.join(workspaces, 'NewProject4')))
    expect(next.project.root_path).toBe(fs.realpathSync(path.join(workspaces, 'NewProject5')))
  })

  it('rejects duplicate or invalid selected directories', async () => {
    const selected = path.join(dataDir, 'selected'); fs.mkdirSync(selected); const file = path.join(dataDir, 'file'); fs.writeFileSync(file, 'file')
    const { projectService } = await loadProjectService()
    projectService.createProject({ name: 'One', sourceDirectory: selected })
    expect(() => projectService.createProject({ name: 'Two', sourceDirectory: selected })).toThrow(/already registered/)
    expect(() => projectService.createProject({ name: ' ', sourceDirectory: selected })).toThrow(/1 to 80/)
    expect(() => projectService.createProject({ name: 'Missing', sourceDirectory: path.join(dataDir, 'missing') })).toThrow(/does not exist/)
    expect(() => projectService.createProject({ name: 'File', sourceDirectory: file })).toThrow(/must be a directory/)
  })

  it('compensates only a newly-created empty auto directory when its database transaction fails', async () => {
    const { projectService, projectRepo } = await loadProjectService()
    vi.spyOn(projectRepo, 'createWithInitialSession').mockImplementation(() => { throw new Error('db failed') })
    expect(() => projectService.createProject({ name: 'Will fail' })).toThrow('db failed')
    expect(fs.readdirSync(path.join(dataDir, 'workspaces'))).toEqual([])
  })

  it('pages project sessions and resolves a project only through session ownership', async () => {
    const { projectService } = await loadProjectService()
    const { project, initialSession } = projectService.createProject({ name: 'Owned' })
    projectService.createProjectSession(project.id); projectService.createProjectSession(project.id)
    expect(projectService.listProjectSessions(project.id, { limit: 2, offset: 0 })).toMatchObject({ meta: { total: 3, limit: 2, offset: 0 } })
    expect(projectService.resolveProjectForSession(initialSession.id)?.id).toBe(project.id)
    expect(projectService.resolveProjectForSession('missing')).toBeNull()
  })
})
