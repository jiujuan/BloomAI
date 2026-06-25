import { describe, expect, it } from 'vitest'
import { parseMessageTrace } from './message-trace'

describe('parseMessageTrace', () => {
  it('wraps legacy tool_calls arrays in a v1 trace object', () => {
    const trace = parseMessageTrace(JSON.stringify([
      {
        callId: 'c1',
        toolId: 'web_search',
        status: 'success',
        input: { query: 'bloomai' },
        outputSummary: '3 results',
        durationMs: 42,
      },
    ]))

    expect(trace).toEqual({
      schemaVersion: 'bloom-response-v1',
      runtime: 'mastra-chat-agent-v1',
      toolCalls: [
        {
          callId: 'c1',
          toolId: 'web_search',
          status: 'success',
          input: { query: 'bloomai' },
          outputSummary: '3 results',
          durationMs: 42,
        },
      ],
    })
  })

  it('returns v1 trace objects as-is', () => {
    const v1Trace = {
      schemaVersion: 'bloom-response-v1',
      runtime: 'direct-llm',
      providerId: 'openai',
      model: 'gpt-4o',
      finishReason: 'stop',
      metadata: { source: 'history' },
    }

    expect(parseMessageTrace(JSON.stringify(v1Trace))).toEqual(v1Trace)
  })

  it('returns null for empty, invalid, or unknown shapes', () => {
    expect(parseMessageTrace(null)).toBeNull()
    expect(parseMessageTrace('')).toBeNull()
    expect(parseMessageTrace('{nope')).toBeNull()
    expect(parseMessageTrace(JSON.stringify({ runtime: 'direct-llm' }))).toBeNull()
    expect(parseMessageTrace(JSON.stringify({ schemaVersion: 'other', runtime: 'direct-llm' }))).toBeNull()
  })
})
