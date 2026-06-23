import { describe, expect, it } from 'vitest'
import { parseOpenAICompatibleSseLine } from './stream'

describe('OpenAI-compatible stream parser', () => {
  it('parses delta content from a normal SSE line', () => {
    expect(
      parseOpenAICompatibleSseLine('data: {"choices":[{"delta":{"content":"Hello"}}]}')
    ).toEqual({ type: 'delta', text: 'Hello' })
  })

  it('parses done markers', () => {
    expect(parseOpenAICompatibleSseLine('data: [DONE]')).toEqual({ type: 'done' })
  })

  it('ignores empty and keepalive lines', () => {
    expect(parseOpenAICompatibleSseLine('')).toEqual({ type: 'ignore' })
    expect(parseOpenAICompatibleSseLine(': keepalive')).toEqual({ type: 'ignore' })
  })
})
