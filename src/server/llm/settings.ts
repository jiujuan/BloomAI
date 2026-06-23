import { LlmConfigError } from './errors'
import type { LlmProviderConfig } from './types'

export function getSettingValue(_key: string): string {
  return ''
}

export function getProviderApiKey(provider: LlmProviderConfig): string {
  throw new LlmConfigError(`API key is not configured for provider "${provider.name}"`)
}

export function getProviderBaseUrl(provider: LlmProviderConfig): string {
  if (provider.baseUrl) return provider.baseUrl
  if (provider.kind === 'ollama') return 'http://127.0.0.1:11434'

  throw new LlmConfigError(`Base URL is not configured for provider "${provider.name}"`)
}
