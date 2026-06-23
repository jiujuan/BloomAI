import { LlmUnsupportedModelError } from './errors'
import { generateImage } from './media/image'
import { createVideoTask, getVideoTask } from './media/video'
import { createAnthropicProvider } from './providers/anthropic'
import { listModels, listProviders, resolveModel } from './registry'
import { parseOllamaNdjsonLine, parseOpenAICompatibleSseLine } from './stream'
import type { ChatStreamEvent, ChatStreamRequest } from './types'

export async function* streamChatCompletion(input: ChatStreamRequest): AsyncGenerator<ChatStreamEvent> {
  const resolved = await resolveModel(input.model, 'text')
  if (resolved.provider.kind === 'anthropic') {
    yield* createAnthropicProvider(resolved).streamChat(input)
    return
  }

  throw new LlmUnsupportedModelError(`Chat streaming is not implemented for model "${input.model}"`)
}

export { generateImage, createVideoTask, getVideoTask }
export { createAnthropicProvider }
export { listModels, listProviders, resolveModel }
export { parseOpenAICompatibleSseLine, parseOllamaNdjsonLine }
export * from './errors'
export type * from './types'
