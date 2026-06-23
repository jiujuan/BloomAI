import { createOpenAICompatibleProvider } from './openai-compatible'
import type { ChatProvider, ResolvedLlmModel } from '../types'

export function createDeepSeekProvider(resolved: ResolvedLlmModel): ChatProvider {
  return createOpenAICompatibleProvider(resolved)
}
