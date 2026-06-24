import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadSettingsRepo() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../client')
  await client.runMigrations()
  const { settingsRepo } = await import('./settings.repo')

  return { settingsRepo, client }
}

describe('settingsRepo', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-settings-repo-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('lists seeded settings and updates multiple values', async () => {
    const { settingsRepo } = await loadSettingsRepo()

    expect(await settingsRepo.getValue('theme')).toBe('system')

    await settingsRepo.setMany({
      theme: 'dark',
      openai_api_key: 'secret-openai-key',
    })

    const settings = await settingsRepo.list()
    expect(settings.theme).toBe('dark')
    expect(settings.openai_api_key).toBe('secret-openai-key')
    expect(await settingsRepo.getValue('openai_api_key')).toBe('secret-openai-key')
  })
})
