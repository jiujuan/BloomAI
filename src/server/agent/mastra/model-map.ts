import type { MastraModelResolution } from './types'

const MODEL_MAP: Record<string, string> = {
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'claude-3-5-sonnet-20241022': 'anthropic/claude-3-5-sonnet-20241022',
}

export function resolveMastraModel(modelId: string): MastraModelResolution {
  const model = MODEL_MAP[modelId]
  if (!model) {
    return {
      ok: false,
      modelId,
      reason: `Model ${modelId} is not mapped for Mastra Agent v1`,
    }
  }
  return { ok: true, model }
}
