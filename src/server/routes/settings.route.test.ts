import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadApp() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const { createApp } = await import('../app')
  const client = await import('../db/client')
  const app = await createApp()

  return { app, db: client.db }
}

async function withServer<T>(
  app: Awaited<ReturnType<typeof loadApp>>['app'],
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening))
  })
  const address = server.address() as AddressInfo

  try {
    return await fn(`http://127.0.0.1:${address.port}/api/v1`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

describe('settings route', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-settings-route-'))
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('masks provider API keys and leaves Ollama base URL visible', async () => {
    const { app, db } = await loadApp()
    db.prepare("UPDATE settings SET value=? WHERE key='anthropic_api_key'").run('anthropic-secret')
    db.prepare("UPDATE settings SET value=? WHERE key='openai_api_key'").run('openai-secret')
    db.prepare("UPDATE settings SET value=? WHERE key='agnes_api_key'").run('agnes-secret')
    db.prepare("UPDATE settings SET value=? WHERE key='deepseek_api_key'").run('deepseek-secret')
    db.prepare("UPDATE settings SET value=? WHERE key='ollama_base_url'").run('http://localhost:11434')

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/settings`)
      const body = await response.json()

      expect(body.data.anthropic_api_key).toBe('***masked***')
      expect(body.data.openai_api_key).toBe('***masked***')
      expect(body.data.agnes_api_key).toBe('***masked***')
      expect(body.data.deepseek_api_key).toBe('***masked***')
      expect(body.data.ollama_base_url).toBe('http://localhost:11434')
      expect(JSON.stringify(body.data)).not.toContain('secret')
    })
  })
})
