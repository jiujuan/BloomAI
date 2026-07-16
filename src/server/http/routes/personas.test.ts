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
  const { personasRoutes } = await import('./personas')
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  app.route('/personas', personasRoutes)
  return { app, client }
}

describe('personas route contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-personas-route-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates a persona with the existing 201 response shape', async () => {
    const { app } = await createApp()

    const response = await app.request('/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Route persona', system_prompt: 'Be helpful.' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: { name: 'Route persona', system_prompt: 'Be helpful.', model_override: null },
    })
  })

  it('keeps the NOT_FOUND error envelope when a persona is absent', async () => {
    const { app } = await createApp()
    const response = await app.request('/personas/missing')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'Persona not found' },
    })
  })

  it('maps a built-in deletion refusal through the standard error envelope', async () => {
    const { app } = await createApp()
    const response = await app.request('/personas/developer', { method: 'DELETE' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'FORBIDDEN', message: 'Cannot delete built-in persona' },
    })
  })
})