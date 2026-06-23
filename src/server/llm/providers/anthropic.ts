import { LlmUnsupportedModelError } from '../errors'
import type { ChatProvider, ResolvedLlmModel } from '../types'

export function createAnthropicProvider(resolved: ResolvedLlmModel): ChatProvider {
  return {
    async *streamChat() {
      throw new LlmUnsupportedModelError(`Anthropic provider is not implemented for model "${resolved.model.id}"`)
    },
  }
}
