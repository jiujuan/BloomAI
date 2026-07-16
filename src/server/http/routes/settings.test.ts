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
  const { settingsRoutes } = await import('./settings')
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  app.route('/settings', settingsRoutes)
  return { app, client }
}

describe('settings route contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-settings-route-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('does not expose API keys through list or get responses', async () => {
    const { app } = await createApp()
    await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openai_api_key: 'secret-openai-key', theme: 'dark' }),
    })

    const listResponse = await app.request('/settings')
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      data: { openai_api_key: '***masked***', theme: 'dark' },
    })

    const getResponse = await app.request('/settings/openai_api_key')
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toEqual({
      data: { key: 'openai_api_key', value: '***masked***' },
    })
  })

  it('returns the stable validation envelope for a non-writable setting key', async () => {
    const { app } = await createApp()
    const response = await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database_path: 'not-allowed' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Setting key is not writable: database_path' },
    })
  })
})