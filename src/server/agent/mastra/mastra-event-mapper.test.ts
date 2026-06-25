import { describe, expect, it } from 'vitest'
import { mapMastraChunkToBloomEvent, mapMastraFinalOutputToBloomEvents } from './mastra-event-mapper'

describe('mapMastraChunkToBloomEvent', () => {
  it('maps text delta chunks to delta events', () => {
    expect(mapMastraChunkToBloomEvent({ type: 'text-delta', textDelta: 'hello' })).toEqual({
      type: 'delta',
      text: 'hello',
    })

    expect(mapMastraChunkToBloomEvent({ type: 'text-delta', delta: ' world' })).toEqual({
      type: 'delta',
      text: ' world',
    })

    expect(mapMastraChunkToBloomEvent({ type: 'text-delta', payload: { text: ' from payload' } })).toEqual({
      type: 'delta',
      text: ' from payload',
    })
  })

  it('maps tool call chunks to running tool call cards', () => {
    expect(
      mapMastraChunkToBloomEvent({
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'web_search',
        args: { query: 'Mastra' },
      }),
    ).toEqual({
      type: 'tool_call_start',
      call: {
        callId: 'call-1',
        toolId: 'web_search',
        category: 'search',
        status: 'running',
        input: { query: 'Mastra' },
      },
    })

    expect(
      mapMastraChunkToBloomEvent({
        type: 'tool-call',
        payload: {
          toolCallId: 'call-2',
          toolName: 'web_search',
          args: { query: 'NBA trades' },
        },
      }),
    ).toEqual({
      type: 'tool_call_start',
      call: {
        callId: 'call-2',
        toolId: 'web_search',
        category: 'search',
        status: 'running',
        input: { query: 'NBA trades' },
      },
    })
  })

  it('maps tool result chunks to result updates with the same call id', () => {
    const output = { query: 'Mastra', results: [{ title: 'Mastra', url: 'https://mastra.ai', snippet: 'Docs' }] }

    expect(
      mapMastraChunkToBloomEvent({
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'web_search',
        result: output,
      }),
    ).toEqual({
      type: 'tool_call_result',
      callId: 'call-1',
      output,
    })

    expect(
      mapMastraChunkToBloomEvent({
        type: 'tool-result',
        payload: {
          toolCallId: 'call-2',
          toolName: 'web_search',
          result: output,
        },
      }),
    ).toEqual({
      type: 'tool_call_result',
      callId: 'call-2',
      output,
    })
  })

  it('maps tool error chunks to error updates with the same call id', () => {
    expect(
      mapMastraChunkToBloomEvent({
        type: 'tool-error',
        toolCallId: 'call-1',
        toolName: 'web_search',
        error: new Error('search failed'),
      }),
    ).toEqual({
      type: 'tool_call_error',
      callId: 'call-1',
      error: 'search failed',
    })

    expect(
      mapMastraChunkToBloomEvent({
        type: 'tool-error',
        payload: {
          toolCallId: 'call-2',
          toolName: 'web_search',
          error: { message: 'payload search failed' },
        },
      }),
    ).toEqual({
      type: 'tool_call_error',
      callId: 'call-2',
      error: 'payload search failed',
    })
  })

  it('maps finish usage into a done trace when maxSteps is provided', () => {
    expect(
      mapMastraChunkToBloomEvent(
        {
          type: 'finish',
          usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
        },
        { maxSteps: 10 },
      ),
    ).toEqual({
      type: 'done',
      trace: {
        runtime: 'mastra-chat-agent-v1',
        maxSteps: 10,
        toolCalls: [],
        tokens: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      },
    })

    expect(
      mapMastraChunkToBloomEvent(
        {
          type: 'finish',
          payload: {
            output: {
              usage: { inputTokens: 13, outputTokens: 8, totalTokens: 21 },
            },
          },
        },
        { maxSteps: 10 },
      ),
    ).toEqual({
      type: 'done',
      trace: {
        runtime: 'mastra-chat-agent-v1',
        maxSteps: 10,
        toolCalls: [],
        tokens: { inputTokens: 13, outputTokens: 8, totalTokens: 21 },
      },
    })
  })

  it('ignores unknown chunks', () => {
    expect(mapMastraChunkToBloomEvent({ type: 'unknown-kind', value: true })).toBeNull()
  })
})

describe('mapMastraFinalOutputToBloomEvents', () => {
  it('backfills missing tool start and result events from final toolCalls/toolResults', () => {
    const events = mapMastraFinalOutputToBloomEvents({
      toolCalls: [{ toolCallId: 'call-1', toolName: 'web_search', args: { query: 'Mastra' } }],
      toolResults: [{ toolCallId: 'call-1', toolName: 'web_search', result: { query: 'Mastra', results: [] } }],
    })

    expect(events).toEqual([
      {
        type: 'tool_call_start',
        call: {
          callId: 'call-1',
          toolId: 'web_search',
          category: 'search',
          status: 'running',
          input: { query: 'Mastra' },
        },
      },
      {
        type: 'tool_call_result',
        callId: 'call-1',
        output: { query: 'Mastra', results: [] },
      },
    ])
  })

  it('does not backfill events already emitted in the realtime stream', () => {
    const events = mapMastraFinalOutputToBloomEvents(
      {
        toolCalls: [{ toolCallId: 'call-1', toolName: 'web_search', args: { query: 'Mastra' } }],
        toolResults: [{ toolCallId: 'call-1', toolName: 'web_search', result: { query: 'Mastra', results: [] } }],
      },
      { emittedCallIds: new Set(['call-1']), emittedResultIds: new Set(['call-1']) },
    )

    expect(events).toEqual([])
  })
})
