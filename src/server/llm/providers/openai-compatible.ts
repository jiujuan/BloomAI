import { LlmUnsupportedModelError } from '../errors'
import type { ChatProvider, ResolvedLlmModel } from '../types'

export function createOpenAICompatibleProvider(resolved: ResolvedLlmModel): ChatProvider {
  return {
    async *streamChat() {
      throw new LlmUnsupportedModelError(
        `OpenAI-compatible provider is not implemented for model "${resolved.model.id}"`
      )
    },
  }
}
