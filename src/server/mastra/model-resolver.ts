import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { MastraModelConfig } from '@mastra/core/llm'
import { resolveRuntimeModel } from '../llm/model-selection'
import { getProviderApiKey, getProviderBaseUrl } from '../llm/settings'
import type { ResolvedLlmModel } from '../llm/types'

/**
 * Bridges BloomAI's provider/model registry to a concrete AI SDK v6 model.
 *
 * We build the AI SDK provider directly per kind instead of passing a bare
 * `provider/model` string, because Mastra's default model gateway treats
 * unknown providers as OpenAI-compatible (it posts to `/chat/completions`),
 * which 404s against Anthropic's `/v1/messages`. Resolving the real provider
 * here keeps anthropic/openai/openai-compatible/ollama all working.
 *
 * Used as the Agent's dynamic `model` so the request-selected model wins per turn.
 */
export async function resolveMastraModel(requestedModel?: string): Promise<MastraModelConfig> {
  const { resolved } = await resolveRuntimeModel({
    consumer: 'agent',
    modality: 'text',
    requestedModel,
  })
  return toAiSdkModel(resolved)
}

function toAiSdkModel(resolved: ResolvedLlmModel): MastraModelConfig {
  const modelId = resolved.model.modelId
  const apiKey = getProviderApiKey(resolved.provider)
  const baseURL = getProviderBaseUrl(resolved.provider) || undefined

  switch (resolved.provider.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId)
    case 'openai':
      return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId)
    case 'openai-compatible':
    case 'ollama':
      return createOpenAICompatible({
        name: resolved.provider.id,
        apiKey: apiKey || 'not-needed',
        baseURL: baseURL ?? 'http://localhost:11434/v1',
      })(modelId)
    default:
      throw new Error(`Unsupported provider kind: ${resolved.provider.kind}`)
  }
}
