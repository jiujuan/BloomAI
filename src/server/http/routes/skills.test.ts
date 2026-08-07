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

  it('keeps market listing readable while freezing Legacy install/create/delete operations', async () => {
    const { app } = await createApp()
    const market = await requestJson(app, '/skills/market?limit=2')
    expect(market.response.status).toBe(200)
    expect(market.body.data).toHaveLength(2)
    expect(market.body.meta).toEqual({ limit: 2 })

    for (const request of [
      requestJson(app, '/skills/install', { method: 'POST', body: JSON.stringify({ id: 'json-formatter' }) }),
      requestJson(app, '/skills', { method: 'POST', body: JSON.stringify({ name: 'Custom route skill', description: 'test', type: 'js-function', source: 'return {}' }) }),
      requestJson(app, '/skills/json-formatter', { method: 'PATCH', body: JSON.stringify({ description: 'updated' }) }),
      requestJson(app, '/skills/json-formatter', { method: 'DELETE' }),
    ]) {
      const response = await request
      expect(response.response.status).toBe(409)
      expect(response.body.error.code).toBe('LEGACY_SKILL_FROZEN')
    }
  })

  it('exposes a paginated overview without collapsing package skills into legacy DTOs', async () => {
    const { app, skillPackageRepo } = await createApp()
    const packageRecord = skillPackageRepo.createPackage({ name: 'Overview package', description: 'package-only', sourceType: 'local-directory' })

    const packageOverview = await requestJson(app, '/skills/overview?runtimeKind=package&limit=1&q=overview')
    expect(packageOverview.response.status).toBe(200)
    expect(packageOverview.body.data).toHaveLength(1)
    expect(packageOverview.body.data[0]).toMatchObject({
      reference: `package:${packageRecord.id}`,
      runtimeKind: 'package',
      sourceType: 'local-directory',
      version: null,
      capabilities: [],
      supportedActions: ['install', 'versions'],
    })
    expect(packageOverview.body.meta).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false })

    const legacyOverview = await requestJson(app, '/skills/overview?runtimeKind=legacy&limit=100')
    expect(legacyOverview.response.status).toBe(200)
    expect(legacyOverview.body.data.every((item: any) => item.runtimeKind === 'legacy' && item.readOnly === true)).toBe(true)
  })

  it('blocks Legacy run without creating a history row and keeps history readable', async () => {
    const { app } = await createApp()
    const run = await requestJson(app, '/skills/legacy:json-formatter/run', {
      method: 'POST', body: JSON.stringify({ input: { json: '{"answer":42}' } }),
    })
    expect(run.response.status).toBe(409)
    expect(run.body.error).toMatchObject({ code: 'LEGACY_SKILL_RUN_DISABLED' })

    const history = await requestJson(app, '/skills/legacy:json-formatter/runs?limit=1')
    expect(history.response.status).toBe(200)
    expect(history.body.data).toEqual([])
  })

  it('exposes a read-only migration preview for prompt-template Legacy Skills', async () => {
    const { app } = await createApp()
    const preview = await requestJson(app, '/skills/text-summarizer/migration-preview')

    expect(preview.response.status).toBe(200)
    expect(preview.body.data).toMatchObject({
      runtimeKind: 'legacy',
      legacySkillId: 'text-summarizer',
      readOnly: true,
      published: false,
      draft: { manifest: { runtime: 'instruction-agent', entryPath: 'SKILL.md' } },
    })
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
