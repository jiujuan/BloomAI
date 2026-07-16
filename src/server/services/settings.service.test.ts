import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadSettingsService() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const { settingsRepo } = await import('../db/repositories/settings.repo')
  const { settingsService } = await import('./settings.service')
  return { client, settingsRepo, settingsService }
}

describe('settingsService', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-settings-service-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('masks every secret before settings reach a client DTO', async () => {
    const { settingsRepo, settingsService } = await loadSettingsService()
    settingsRepo.setMany({
      openai_api_key: 'secret-openai-key',
      google_api_key: 'secret-google-key',
      theme: 'dark',
    })

    const settings = settingsService.listForClient()

    expect(settings.openai_api_key).toBe('***masked***')
    expect(settings.google_api_key).toBe('***masked***')
    expect(settings.theme).toBe('dark')
    expect(JSON.stringify(settings)).not.toContain('secret-openai-key')
    expect(JSON.stringify(settings)).not.toContain('secret-google-key')
  })

  it('does not expose a secret through the single-setting client DTO', async () => {
    const { settingsRepo, settingsService } = await loadSettingsService()
    settingsRepo.setMany({ anthropic_api_key: 'secret-anthropic-key' })

    expect(settingsService.getForClient('anthropic_api_key')).toEqual({
      key: 'anthropic_api_key',
      value: '***masked***',
    })
  })

  it('supports the existing hyphenated custom-provider API key convention without exposing its value', async () => {
    const { settingsRepo, settingsService } = await loadSettingsService()

    expect(settingsService.update({ 'my-provider_api_key': 'custom-secret' })).toEqual({ updated: 1 })
    expect(settingsRepo.getValue('my-provider_api_key')).toBe('custom-secret')
    expect(settingsService.getForClient('my-provider_api_key')).toEqual({
      key: 'my-provider_api_key',
      value: '***masked***',
    })
  })
  it('rejects missing and non-writable keys while allowing a normalized batch update', async () => {
    const { settingsRepo, settingsService } = await loadSettingsService()

    expect(settingsService.update({ theme: 'dark', font_size: '15px' })).toEqual({ updated: 2 })
    expect(settingsRepo.getValue('theme')).toBe('dark')
    expect(settingsRepo.getValue('font_size')).toBe('15px')

    expect(() => settingsService.getForClient('does_not_exist')).toThrowError('Setting not found')
    expect(() => settingsService.update({ database_path: 'not-allowed' })).toThrowError('Setting key is not writable')
    try {
      settingsService.update({ database_path: 'not-allowed' })
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR' })
    }
  })
})