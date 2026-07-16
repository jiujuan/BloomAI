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
  const { sessionsRoutes } = await import('./sessions')
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  app.route('/sessions', sessionsRoutes)
  return { app, client }
}

describe('sessions route contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-sessions-route-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates a session with the existing 201 response shape', async () => {
    const { app } = await createApp()
    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Route session' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ data: { title: 'Route session', status: 'active' } })
  })

  it('keeps the NOT_FOUND error envelope for an absent session', async () => {
    const { app } = await createApp()
    const response = await app.request('/sessions/missing')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'Session not found' },
    })
  })

  it('keeps message pagination metadata compatible', async () => {
    const { app } = await createApp()
    const createResponse = await app.request('/sessions', { method: 'POST' })
    const { data: session } = await createResponse.json() as { data: { id: string } }

    const response = await app.request(`/sessions/${session.id}/messages?limit=1&offset=0`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: [], meta: { total: 0, limit: 1, offset: 0 } })
  })
})