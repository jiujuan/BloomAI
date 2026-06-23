import { LlmUnsupportedModelError } from '../errors'
import type { ChatProvider, ResolvedLlmModel } from '../types'

export type OllamaRemoteModel = {
  name: string
  modifiedAt?: string
  size?: number
  digest?: string
  details?: Record<string, unknown>
}

export function createOllamaProvider(resolved: ResolvedLlmModel): ChatProvider {
  return {
    async *streamChat() {
      throw new LlmUnsupportedModelError(`Ollama provider is not implemented for model "${resolved.model.id}"`)
    },
  }
}

export async function listOllamaRemoteModels(): Promise<OllamaRemoteModel[]> {
  return []
}
