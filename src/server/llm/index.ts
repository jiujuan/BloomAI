import { LlmUnsupportedModelError } from './errors'
import { generateImage } from './media/image'
import { createVideoTask, getVideoTask } from './media/video'
import { createAgnesTextProvider } from './providers/agnes'
import { createAnthropicProvider } from './providers/anthropic'
import { createDeepSeekProvider } from './providers/deepseek'
import { createOllamaProvider } from './providers/ollama'
import { createOpenAIProvider } from './providers/openai'
import { listModels, listProviders, resolveModel } from './registry'
import { parseOllamaNdjsonLine, parseOpenAICompatibleSseLine } from './stream'
import type { ChatStreamEvent, ChatStreamRequest } from './types'

export async function* streamChatCompletion(input: ChatStreamRequest): AsyncGenerator<ChatStreamEvent> {
  const resolved = await resolveModel(input.model, 'text')
  if (resolved.provider.kind === 'anthropic') {
    yield* createAnthropicProvider(resolved).streamChat(input)
    return
  }
  if (resolved.provider.kind === 'openai') {
    yield* createOpenAIProvider(resolved).streamChat(input)
    return
  }
  if (resolved.provider.id === 'agnes') {
    yield* createAgnesTextProvider(resolved).streamChat(input)
    return
  }
  if (resolved.provider.id === 'deepseek') {
    yield* createDeepSeekProvider(resolved).streamChat(input)
    return
  }
  if (resolved.provider.kind === 'ollama') {
    yield* createOllamaProvider(resolved).streamChat(input)
    return
  }

  throw new LlmUnsupportedModelError(`Chat streaming is not implemented for model "${input.model}"`)
}

export { generateImage, createVideoTask, getVideoTask }
export { createAgnesTextProvider }
export { createAnthropicProvider }
export { createDeepSeekProvider }
export { createOllamaProvider, importOllamaModel, listOllamaRemoteModels } from './providers/ollama'
export { createOpenAICompatibleProvider } from './providers/openai-compatible'
export { createOpenAIProvider }
export { listModels, listProviders, resolveModel }
export { resolveRuntimeModel, selectRuntimeModel } from './model-selection'
export type { ModelConsumer, ResolvedRuntimeModel, ResolveRuntimeModelInput, RuntimeModelSource } from './model-selection'
export { parseOpenAICompatibleSseLine, parseOllamaNdjsonLine }
export * from './errors'
export type * from './types'
