import { LlmConfigError } from './errors'
import { db } from '../db/client'
import type { LlmProviderConfig } from './types'

const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  agnes: 'AGNES_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}

export function getSettingValue(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value?: string } | undefined
  return typeof row?.value === 'string' ? row.value : ''
}

export function getProviderApiKey(provider: LlmProviderConfig): string {
  if (!provider.apiKeySettingKey) return ''

  const settingValue = getSettingValue(provider.apiKeySettingKey).trim()
  if (settingValue) return settingValue

  const envKey = PROVIDER_API_KEY_ENV[provider.id]
  const envValue = envKey ? process.env[envKey]?.trim() : ''
  if (envValue) return envValue

  throw new LlmConfigError(`API key is not configured for provider "${provider.name}"`)
}

export function getProviderBaseUrl(provider: LlmProviderConfig): string {
  if (provider.kind === 'ollama') {
    return getSettingValue('ollama_base_url').trim() || provider.baseUrl || 'http://127.0.0.1:11434'
  }
  if (provider.baseUrl) return provider.baseUrl

  throw new LlmConfigError(`Base URL is not configured for provider "${provider.name}"`)
}
