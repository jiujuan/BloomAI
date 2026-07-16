import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function createApp() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { Hono } = await import('hono')
  const { createHttpErrorHandler } = await import('../error-mapper')
  const { skillsRoutes } = await import('./skills')
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  app.route('/skills', skillsRoutes)
  return { app, client, skillPackageRepo }
}

async function requestJson(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, route: string, init?: RequestInit) {
  const response = await app.request(route, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return { response, body: await response.json() as any }
}

describe('skills route contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-skills-route-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('keeps market listing and install/missing responses compatible', async () => {
    const { app } = await createApp()
    const market = await requestJson(app, '/skills/market?limit=2')
    expect(market.response.status).toBe(200)
    expect(market.body.data).toHaveLength(2)
    expect(market.body.meta).toEqual({ limit: 2 })

    const missing = await requestJson(app, '/skills/install', { method: 'POST', body: JSON.stringify({ id: 'missing' }) })
    expect(missing.response.status).toBe(404)
    expect(missing.body.error).toEqual({ code: 'NOT_FOUND', message: 'Skill not found' })

    const installed = await requestJson(app, '/skills/install', { method: 'POST', body: JSON.stringify({ id: 'json-formatter' }) })
    expect(installed.response.status).toBe(200)
    expect(installed.body.data).toMatchObject({ id: 'json-formatter', is_installed: 1 })
  })

  it('creates and deletes custom skills while uninstalling official skills', async () => {
    const { app } = await createApp()
    const created = await requestJson(app, '/skills', {
      method: 'POST',
      body: JSON.stringify({ name: 'Custom route skill', description: 'test', type: 'js-function', source: 'function run(){ return { ok: true } }', params_schema: '{"value":{"type":"string"}}' }),
    })
    expect(created.response.status).toBe(201)
    expect(created.body.data).toMatchObject({ name: 'Custom route skill', author: 'custom', params_schema: '{"value":{"type":"string"}}' })

    const deleted = await app.request(`/skills/${created.body.data.id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(204)

    const official = await requestJson(app, '/skills/install', { method: 'POST', body: JSON.stringify({ id: 'json-formatter' }) })
    expect(official.response.status).toBe(200)
    const uninstalled = await requestJson(app, '/skills/web-search-skill', { method: 'DELETE' })
    expect(uninstalled.response.status).toBe(200)
    expect(uninstalled.body.data).toEqual({ uninstalled: true })
  })

  it('runs legacy skills and retains their run history endpoint', async () => {
    const { app } = await createApp()
    const run = await requestJson(app, '/skills/legacy:json-formatter/run', {
      method: 'POST', body: JSON.stringify({ input: { json: '{"answer":42}' } }),
    })
    expect(run.response.status).toBe(200)
    expect(run.body.data).toMatchObject({ valid: true, keys: 1 })

    const history = await requestJson(app, '/skills/legacy:json-formatter/runs?limit=1')
    expect(history.response.status).toBe(200)
    expect(history.body.data).toHaveLength(1)
    expect(history.body.data[0]).toMatchObject({ skill_id: 'json-formatter', status: 'success' })
  })

  it('keeps package references async-only on the legacy skill endpoint', async () => {
    const { app, skillPackageRepo } = await createApp()
    const packageRecord = skillPackageRepo.createPackage({ name: 'Package route skill', description: '', sourceType: 'local-directory' })
    const guarded = await requestJson(app, `/skills/package:${packageRecord.id}/run`, { method: 'POST', body: JSON.stringify({ input: {} }) })

    expect(guarded.response.status).toBe(409)
    expect(guarded.body.error).toEqual({
      code: 'PACKAGE_SKILL_ASYNC_ONLY',
      message: 'Package Skills must be started through POST /skill-runs',
    })
  })
})
