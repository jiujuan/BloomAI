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
  const { toolsRoutes } = await import('./tools')
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  app.route('/tools', toolsRoutes)
  return { app, client }
}

async function requestJson(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, route: string, init?: RequestInit) {
  const response = await app.request(route, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return { response, body: await response.json() as any }
}

describe('tools route contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-tools-route-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('lists tools with their permission projection and keeps category filtering', async () => {
    const { app } = await createApp()
    const result = await requestJson(app, '/tools?category=fs')

    expect(result.response.status).toBe(200)
    expect(result.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fs_write', category: 'fs', permission: null }),
    ]))
  })

  it('grants then revokes a tool permission through the stable response shapes', async () => {
    const { app } = await createApp()
    const granted = await requestJson(app, '/tools/permissions/fs_write/grant', {
      method: 'POST', body: JSON.stringify({ scope: 'persistent' }),
    })
    expect(granted.response.status).toBe(200)
    expect(granted.body.data).toEqual({ tool_id: 'fs_write', granted: true, scope: 'persistent' })

    const revoked = await requestJson(app, '/tools/permissions/fs_write/revoke', { method: 'POST', body: '{}' })
    expect(revoked.response.status).toBe(200)
    expect(revoked.body.data).toEqual({ tool_id: 'fs_write', granted: false })

    const permissions = await requestJson(app, '/tools/permissions')
    expect(permissions.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool_id: 'fs_write', granted: 0, scope: 'persistent' }),
    ]))
  })

  it('keeps missing and denied execution errors in the shared HTTP error envelope', async () => {
    const { app } = await createApp()
    const missing = await requestJson(app, '/tools/missing')
    expect(missing.response.status).toBe(404)
    expect(missing.body.error).toEqual({ code: 'NOT_FOUND', message: 'Tool not found' })

    const denied = await requestJson(app, '/tools/fs_write/run', {
      method: 'POST', body: JSON.stringify({ input: { path: 'ignored.txt', content: 'no write' } }),
    })
    expect(denied.response.status).toBe(403)
    expect(denied.body.error.code).toBe('CAPABILITY_APPROVAL_REQUIRED')
  })

  it('keeps run history pagination endpoints available without invoking an external provider', async () => {
    const { app } = await createApp()
    const byTool = await requestJson(app, '/tools/fs_write/runs?limit=1')
    const all = await requestJson(app, '/tools/runs?limit=1')

    expect(byTool.response.status).toBe(200)
    expect(byTool.body.data).toEqual([])
    expect(all.response.status).toBe(200)
    expect(all.body.data).toEqual([])
  })
})
