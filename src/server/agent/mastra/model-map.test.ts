import { describe, expect, it } from 'vitest'
import { resolveMastraModel } from './model-map'

describe('Mastra model mapping', () => {
  it('maps supported BloomAI model ids to Mastra model ids', () => {
    expect(resolveMastraModel('gpt-4o')).toEqual({
      ok: true,
      model: 'openai/gpt-4o',
    })
    expect(resolveMastraModel('agnes-2.0-flash')).toEqual({
      ok: true,
      model: 'openai/agnes-2.0-flash',
    })
  })

  it('returns unsupported for unknown model ids', () => {
    expect(resolveMastraModel('unknown-model')).toEqual({
      ok: false,
      modelId: 'unknown-model',
      reason: 'Model unknown-model is not mapped for Mastra Agent v1',
    })
  })
})

