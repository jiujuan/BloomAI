import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string; let originalEnv: NodeJS.ProcessEnv
async function createApp() {
  vi.resetModules(); process.env.DATA_DIR = dataDir
  const client = await import('../../db/client'); await client.runMigrations()
  const { Hono } = await import('hono'); const { createHttpErrorHandler } = await import('../error-mapper'); const { projectsRoutes } = await import('./projects')
  const app = new Hono(); app.onError(createHttpErrorHandler(() => undefined)); app.route('/projects', projectsRoutes)
  return { app, client }
}
describe('projects route contract', () => {
  beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-project-route-')); originalEnv = { ...process.env } })
  afterEach(async () => { (await import('../../db/client')).closeDb(); vi.resetModules(); process.env = originalEnv; fs.rmSync(dataDir, { recursive: true, force: true }) })
  it('creates auto and selected projects, their initial sessions, and pages project sessions', async () => {
    const { app } = await createApp(); const selected = path.join(dataDir, 'selected'); fs.mkdirSync(selected)
    const autoResponse = await app.request('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Auto' }) })
    expect(autoResponse.status).toBe(201); const autoBody = await autoResponse.json() as any
    expect(autoBody.data).toMatchObject({ project: { directory_kind: 'auto', sessionCount: 1 }, initialSession: { project_id: autoBody.data.project.id } })
    const selectedResponse = await app.request('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Selected', sourceDirectory: selected }) })
    expect(selectedResponse.status).toBe(201)
    const projectId = autoBody.data.project.id
    const listed = await app.request('/projects'); expect(await listed.json()).toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ id: projectId, sessionCount: 1 })]) })
    const createdSession = await app.request(`/projects/${projectId}/sessions`, { method: 'POST' }); expect(createdSession.status).toBe(201)
    const page = await app.request(`/projects/${projectId}/sessions?limit=10&offset=0`); expect(await page.json()).toMatchObject({ meta: { total: 2, limit: 10, offset: 0 } })
  })
  it('maps validation, conflict, pagination, and missing project errors', async () => {
    const { app } = await createApp(); const selected = path.join(dataDir, 'selected'); fs.mkdirSync(selected)
    expect((await app.request('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ' ' }) })).status).toBe(400)
    expect((await app.request('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'One', sourceDirectory: selected }) })).status).toBe(201)
    expect((await app.request('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Two', sourceDirectory: selected }) })).status).toBe(409)
    expect((await app.request('/projects/missing/sessions')).status).toBe(404)
    expect((await app.request('/projects/missing/sessions?limit=-1')).status).toBe(400)
  })
})
