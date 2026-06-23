import { LlmConfigError, LlmProviderError } from '../errors'
import { llmRepo, importOllamaModel as importOllamaModelRecord } from '../../db/repositories/llm.repo'
import { getProviderBaseUrl } from '../settings'
import { parseOllamaNdjsonLine } from '../stream'
import type { ChatProvider, LlmProviderConfig, ResolvedLlmModel } from '../types'

export type OllamaRemoteModel = {
  name: string
  modifiedAt?: string
  size?: number
  digest?: string
  details?: Record<string, unknown>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ollama request failed'
}

function getOllamaProviderConfig(): LlmProviderConfig {
  const provider = llmRepo.getProvider('ollama')
  if (!provider) {
    throw new LlmConfigError('Ollama provider is not configured')
  }

  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.base_url,
    apiKeySettingKey: provider.api_key_setting_key,
    isEnabled: provider.is_enabled === 1,
    config: JSON.parse(provider.config_json || '{}') as Record<string, unknown>,
  }
}

function joinOllamaUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

export function createOllamaProvider(resolved: ResolvedLlmModel): ChatProvider {
  return {
    async *streamChat(input) {
      const baseUrl = getProviderBaseUrl(resolved.provider)
      const messages = [
        ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
        ...input.messages.map((message) => ({ role: message.role, content: message.content })),
      ]

      let response: Response
      try {
        response = await fetch(joinOllamaUrl(baseUrl, '/api/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: resolved.model.modelId,
            messages,
            stream: true,
          }),
        })
      } catch (error) {
        throw new LlmProviderError(getErrorMessage(error), { cause: error })
      }

      if (!response.ok) {
        throw new LlmProviderError(`Ollama chat request failed with HTTP ${response.status}`)
      }
      if (!response.body) {
        throw new LlmProviderError('Ollama response did not include a stream body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''

        for (const line of lines) {
          const parsed = parseOllamaNdjsonLine(line)
          if (parsed.type === 'ignore') continue
          if (parsed.type === 'done') {
            yield { type: 'done' }
            return
          }
          yield parsed
        }
      }

      buffer += decoder.decode()
      if (buffer.trim()) {
        const parsed = parseOllamaNdjsonLine(buffer)
        if (parsed.type === 'done') {
          yield { type: 'done' }
          return
        }
        if (parsed.type !== 'ignore') yield parsed
      }
    },
  }
}

export async function listOllamaRemoteModels(): Promise<OllamaRemoteModel[]> {
  const baseUrl = getProviderBaseUrl(getOllamaProviderConfig())
  let response: Response
  try {
    response = await fetch(joinOllamaUrl(baseUrl, '/api/tags'))
  } catch (error) {
    throw new LlmProviderError(getErrorMessage(error), { cause: error })
  }

  if (!response.ok) {
    throw new LlmProviderError(`Ollama model discovery failed with HTTP ${response.status}`)
  }

  const payload = await response.json() as { models?: Array<Record<string, any>> }
  return (payload.models || []).map((model) => ({
    name: String(model.name),
    modifiedAt: typeof model.modified_at === 'string' ? model.modified_at : undefined,
    size: typeof model.size === 'number' ? model.size : undefined,
    digest: typeof model.digest === 'string' ? model.digest : undefined,
    details: model.details && typeof model.details === 'object' ? model.details : undefined,
  }))
}

export function importOllamaModel(modelName: string) {
  return importOllamaModelRecord(modelName)
}
