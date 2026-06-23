import { createOpenAICompatibleProvider } from './openai-compatible'
import type { ChatProvider, ResolvedLlmModel } from '../types'

export function createAgnesTextProvider(resolved: ResolvedLlmModel): ChatProvider {
  return createOpenAICompatibleProvider(resolved)
}
