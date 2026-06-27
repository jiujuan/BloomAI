import { describe, expect, it } from 'vitest'
import {
  RESPONSE_SCHEMA_VERSION,
  ResponseStreamEventSchema,
  type MarkdownBlock,
  type ToolCallBlock,
} from './response'

describe('response contract v1', () => {
  it('validates content delta stream events', () => {
    const event = ResponseStreamEventSchema.parse({
      type: 'content_delta',
      responseId: 'resp-1',
      blockId: 'block-1',
      delta: 'hello',
    })

    expect(event).toEqual({
      type: 'content_delta',
      responseId: 'resp-1',
      blockId: 'block-1',
      delta: 'hello',
    })
  })


  it('validates active response start events with the agent runtime', () => {
    const event = ResponseStreamEventSchema.parse({
      type: 'response_started',
      responseId: 'resp-agent',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      model: 'gpt-4o',
      createdAt: 100,
    })

    expect(event).toMatchObject({
      type: 'response_started',
      runtime: 'mastra-chat-agent-v1',
    })
  })

  it('keeps direct-llm valid only for legacy response compatibility', () => {
    const event = ResponseStreamEventSchema.parse({
      type: 'response_started',
      responseId: 'resp-legacy',
      runtime: 'direct-llm',
      createdAt: 100,
    })

    expect(event).toMatchObject({
      type: 'response_started',
      runtime: 'direct-llm',
    })
  })
  it('validates tool call started stream events', () => {
    const event = ResponseStreamEventSchema.parse({
      type: 'tool_call_started',
      responseId: 'resp-1',
      block: {
        id: 'block-tool-1',
        type: 'tool_call',
        callId: 'call-1',
        toolId: 'web_search',
        category: 'search',
        status: 'running',
        input: { query: 'BloomAI' },
        createdAt: 100,
      },
    })

    if (event.type !== 'tool_call_started') {
      throw new Error('Expected tool_call_started')
    }
    expect(event.block).toMatchObject({
      callId: 'call-1',
      toolId: 'web_search',
      status: 'running',
    })
  })

  it('accepts optional status messages on tool call delta patches', () => {
    const event = ResponseStreamEventSchema.parse({
      type: 'tool_call_delta',
      responseId: 'resp-1',
      callId: 'call-1',
      patch: {
        outputSummary: 'Primary search failed',
        statusMessage: 'Switching to fallback search',
      },
    })

    if (event.type !== 'tool_call_delta') {
      throw new Error('Expected tool_call_delta')
    }
    expect(event.patch.statusMessage).toBe('Switching to fallback search')
  })

  it('accepts optional metadata on tool call delta patches', () => {
    const event = ResponseStreamEventSchema.parse({
      type: 'tool_call_delta',
      responseId: 'resp-1',
      callId: 'call-1',
      patch: {
        metadata: {
          provider: 'duckduckgo',
          fallbackFrom: 'tavily',
        },
      },
    })

    if (event.type !== 'tool_call_delta') {
      throw new Error('Expected tool_call_delta')
    }
    expect(event.patch.metadata).toEqual({
      provider: 'duckduckgo',
      fallbackFrom: 'tavily',
    })
  })

  it('keeps legacy tool call delta payloads valid without optional fields', () => {
    const event = ResponseStreamEventSchema.parse({
      type: 'tool_call_delta',
      responseId: 'resp-1',
      callId: 'call-1',
      patch: {
        outputSummary: 'Fetched 3 results',
        durationMs: 120,
      },
    })

    expect(event).toMatchObject({
      type: 'tool_call_delta',
      responseId: 'resp-1',
      callId: 'call-1',
      patch: {
        outputSummary: 'Fetched 3 results',
        durationMs: 120,
      },
    })
  })
  it('rejects unknown stream event types', () => {
    expect(() =>
      ResponseStreamEventSchema.parse({
        type: 'unknown_event',
        responseId: 'resp-1',
      }),
    ).toThrow()
  })

  it('keeps markdown and tool call status types independent', () => {
    const markdown: MarkdownBlock = {
      id: 'block-md',
      type: 'markdown',
      status: 'streaming',
      markdown: 'hello',
      createdAt: 100,
    }
    const toolCall: ToolCallBlock = {
      id: 'block-tool',
      type: 'tool_call',
      callId: 'call-1',
      toolId: 'web_search',
      category: 'search',
      status: 'running',
      input: {},
      createdAt: 100,
    }

    expect(markdown.status).toBe('streaming')
    expect(toolCall.status).toBe('running')
  })

  it('exposes the v1 schema version constant', () => {
    expect(RESPONSE_SCHEMA_VERSION).toBe('bloom-response-v1')
  })
})

