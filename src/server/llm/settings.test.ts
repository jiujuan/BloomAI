import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmProviderConfig } from './types'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadSettings() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const settings = await import('./settings')
  const registry = await import('./registry')
  const errors = await import('./errors')

  return { db: client.db, ...settings, ...registry, ...errors }
}

function provider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeySettingKey: 'openai_api_key',
    isEnabled: true,
    config: {},
    ...overrides,
  }
}

describe('LLM settings resolution', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-llm-settings-'))
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('reads setting values from the database', async () => {
    const { getSettingValue } = await loadSettings()

    expect(getSettingValue('model')).toBe('claude-3-5-sonnet-20241022')
  })

  it('uses settings API keys before provider environment variables', async () => {
    const { db, getProviderApiKey } = await loadSettings()
    process.env.OPENAI_API_KEY = 'env-openai-key'
    db.prepare("UPDATE settings SET value=? WHERE key='openai_api_key'").run('settings-openai-key')

    expect(getProviderApiKey(provider())).toBe('settings-openai-key')
  })

  it('falls back to provider environment variables for API keys', async () => {
    const { getProviderApiKey } = await loadSettings()
    process.env.AGNES_API_KEY = 'env-agnes-key'

    expect(
      getProviderApiKey(provider({ id: 'agnes', name: 'Agnes', kind: 'openai-compatible', apiKeySettingKey: 'agnes_api_key' }))
    ).toBe('env-agnes-key')
  })

  it('throws a config error when an API key cannot be resolved', async () => {
    const { LlmConfigError, getProviderApiKey } = await loadSettings()

    expect(() =>
      getProviderApiKey(provider({ id: 'deepseek', name: 'DeepSeek', kind: 'openai-compatible', apiKeySettingKey: 'deepseek_api_key' }))
    ).toThrow(LlmConfigError)
  })

  it('resolves Ollama base URL from settings, provider config, then default', async () => {
    const { db, getProviderBaseUrl } = await loadSettings()
    const ollama = provider({ id: 'ollama', name: 'Ollama', kind: 'ollama', apiKeySettingKey: null })

    db.prepare("UPDATE settings SET value=? WHERE key='ollama_base_url'").run('http://localhost:9999')
    expect(getProviderBaseUrl(ollama)).toBe('http://localhost:9999')

    db.prepare("UPDATE settings SET value=? WHERE key='ollama_base_url'").run('')
    expect(getProviderBaseUrl({ ...ollama, baseUrl: 'http://provider-host:11434' })).toBe('http://provider-host:11434')
    expect(getProviderBaseUrl({ ...ollama, baseUrl: null })).toBe('http://127.0.0.1:11434')
  })
})
