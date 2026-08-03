import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRepo() {
  vi.resetModules(); process.env.DATA_DIR = dataDir
  const client = await import('../client'); await client.runMigrations()
  return { client, projectRepo: (await import('./project.repo')).projectRepo }
}

describe('projectRepo', () => {
  beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-project-repo-')); originalEnv = { ...process.env } })
  afterEach(async () => { (await import('../client')).closeDb(); vi.resetModules(); process.env = originalEnv; fs.rmSync(dataDir, { recursive: true, force: true }) })

  it('creates, orders, aggregates, pages, and ignores archived project sessions', async () => {
    const { projectRepo } = await loadRepo()
    const first = projectRepo.create({ name: 'First', root_path: path.join(dataDir, 'first'), directory_kind: 'auto' })
    const second = projectRepo.create({ name: 'Second', root_path: path.join(dataDir, 'second'), directory_kind: 'auto' })
    const firstSession = projectRepo.createProjectSession(first.id)
    projectRepo.createProjectSession(first.id)
    projectRepo.createProjectSession(second.id)
    const { sessionRepo } = await import('./session.repo')
    sessionRepo.delete(firstSession.id)

    expect(projectRepo.getByRootPath(path.join(dataDir, 'FIRST'))?.id).toBe(first.id)
    expect(projectRepo.countProjectSessions(first.id)).toBe(1)
    expect(projectRepo.listProjectSessions(first.id, { limit: 10, offset: 0 })).toHaveLength(1)
    expect(projectRepo.listSummaries()).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id, sessionCount: 1 })]))
  })
})
