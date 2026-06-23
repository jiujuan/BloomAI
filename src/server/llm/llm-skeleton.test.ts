import { describe, expect, it } from 'vitest'
import {
  LlmUnsupportedModelError,
  parseOpenAICompatibleSseLine,
  streamChatCompletion,
} from './index'

describe('LLM runtime skeleton', () => {
  it('exports streamChatCompletion and throws a typed error for an unknown model', async () => {
    await expect(async () => {
      for await (const _event of streamChatCompletion({
        model: 'unknown-model',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        // Exhaust the async generator so thrown errors are observable.
      }
    }).rejects.toBeInstanceOf(LlmUnsupportedModelError)
  })

  it('parses OpenAI-compatible done SSE lines', () => {
    expect(parseOpenAICompatibleSseLine('data: [DONE]')).toEqual({ type: 'done' })
  })

  it('preserves LLM error code and message', () => {
    const error = new LlmUnsupportedModelError('Model is not configured')

    expect(error.code).toBe('LLM_UNSUPPORTED_MODEL')
    expect(error.message).toBe('Model is not configured')
  })
})
