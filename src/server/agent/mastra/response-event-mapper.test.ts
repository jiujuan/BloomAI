import { describe, expect, it } from 'vitest'
import { createAgentResponseEventMapper } from './response-event-mapper'
import type { ChatAgentRuntimeEvent } from './types'

function mapAll(events: ChatAgentRuntimeEvent[]) {
  const mapper = createAgentResponseEventMapper({
    sessionId: 'session-1',
    model: 'gpt-4o',
    maxSteps: 10,
    responseId: 'resp-agent',
    now: () => 100,
    idFactory: (() => {
      const ids = ['block-tool-1', 'block-answer']
      return () => ids.shift() || 'block-extra'
    })(),
  })

  return events.flatMap((event) => mapper.map(event))
}

describe('createAgentResponseEventMapper', () => {
  it('maps tool calls, assistant deltas, and done trace into response events', () => {
    const mapped = mapAll([
      {
        type: 'tool_call_start',
        call: {
          callId: 'call-1',
          toolId: 'web_search',
          category: 'search',
          status: 'running',
          input: { query: 'BloomAI' },
        },
      },
      {
        type: 'tool_call_result',
        callId: 'call-1',
        output: { results: [{ title: 'Result 1' }] },
        durationMs: 12,
      },
      { type: 'delta', text: 'Answer' },
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [
            {
              callId: 'call-1',
              toolId: 'web_search',
              status: 'success',
              input: { query: 'BloomAI' },
              outputSummary: '1 results',
              durationMs: 12,
            },
          ],
          tokens: { inputTokens: 2, outputTokens: 4, totalTokens: 6 },
        },
      },
    ])

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'tool_call_started',
      'tool_call_completed',
      'content_block_started',
      'content_delta',
      'content_block_completed',
      'response_completed',
    ])
    expect(mapped[1]).toMatchObject({
      type: 'tool_call_started',
      responseId: 'resp-agent',
      block: {
        id: 'block-tool-1',
        type: 'tool_call',
        callId: 'call-1',
        toolId: 'web_search',
        category: 'search',
        status: 'running',
        input: { query: 'BloomAI' },
      },
    })
    expect(mapped[2]).toMatchObject({
      type: 'tool_call_completed',
      responseId: 'resp-agent',
      callId: 'call-1',
      outputSummary: '1 results',
      durationMs: 12,
    })
    expect(mapped[6]).toMatchObject({
      type: 'response_completed',
      responseId: 'resp-agent',
      usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6, model: 'gpt-4o' },
      trace: {
        schemaVersion: 'bloom-response-v1',
        runtime: 'mastra-chat-agent-v1',
        model: 'gpt-4o',
        maxSteps: 10,
        finishReason: 'stop',
        toolCalls: [
          {
            callId: 'call-1',
            toolId: 'web_search',
            status: 'success',
            input: { query: 'BloomAI' },
            outputSummary: '1 results',
            durationMs: 12,
          },
        ],
      },
    })
  })

  it('maps no-tool assistant deltas and done into markdown response events', () => {
    const mapped = mapAll([
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [],
        },
      },
    ])

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'content_block_started',
      'content_delta',
      'content_delta',
      'content_block_completed',
      'response_completed',
    ])
    expect(mapped[2]).toMatchObject({
      type: 'content_delta',
      blockId: 'block-tool-1',
      delta: 'Hello',
    })
    expect(mapped[5]).toMatchObject({
      type: 'response_completed',
      trace: {
        runtime: 'mastra-chat-agent-v1',
        toolCalls: [],
      },
    })
  })

  it('maps tool status deltas into tool_call_delta events', () => {
    const mapped = mapAll([
      {
        type: 'tool_call_start',
        call: {
          callId: 'call-1',
          toolId: 'web_search',
          category: 'search',
          status: 'running',
          input: { query: 'BloomAI' },
        },
      },
      {
        type: 'tool_call_delta',
        callId: 'call-1',
        patch: {
          statusMessage: 'Primary search failed, switching to fallback search',
          metadata: { provider: 'duckduckgo', fallbackFrom: 'tavily' },
        },
      },
    ])

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'tool_call_started',
      'tool_call_delta',
    ])
    expect(mapped[2]).toMatchObject({
      type: 'tool_call_delta',
      responseId: 'resp-agent',
      callId: 'call-1',
      patch: {
        statusMessage: 'Primary search failed, switching to fallback search',
        metadata: { provider: 'duckduckgo', fallbackFrom: 'tavily' },
      },
    })
  })
  it('maps tool call errors into failed tool call events', () => {
    const mapped = mapAll([
      {
        type: 'tool_call_start',
        call: {
          callId: 'call-err',
          toolId: 'shell',
          category: 'execution',
          status: 'running',
          input: { command: 'bad' },
        },
      },
      { type: 'tool_call_error', callId: 'call-err', error: 'boom' },
    ])

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'tool_call_started',
      'tool_call_failed',
    ])
    expect(mapped[1]).toMatchObject({
      type: 'tool_call_started',
      block: { category: 'shell' },
    })
    expect(mapped[2]).toMatchObject({
      type: 'tool_call_failed',
      callId: 'call-err',
      error: { code: 'TOOL_CALL_ERROR', message: 'boom' },
    })
  })

  it('allows soft tool failures to continue into completed content with error trace', () => {
    const mapped = mapAll([
      {
        type: 'tool_call_start',
        call: {
          callId: 'call-soft',
          toolId: 'web_search',
          category: 'search',
          status: 'running',
          input: { query: 'BloomAI' },
        },
      },
      { type: 'tool_call_error', callId: 'call-soft', error: 'primary provider failed' },
      { type: 'delta', text: 'Answer from context' },
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [],
        },
      },
    ])

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'tool_call_started',
      'tool_call_failed',
      'content_block_started',
      'content_delta',
      'content_block_completed',
      'response_completed',
    ])
    expect(mapped[6]).toMatchObject({
      type: 'response_completed',
      trace: {
        toolCalls: [
          {
            callId: 'call-soft',
            toolId: 'web_search',
            status: 'error',
            input: { query: 'BloomAI' },
            outputSummary: 'primary provider failed',
          },
        ],
      },
    })
  })

  it('maps hard tool failures followed by agent errors into response_failed', () => {
    const mapped = mapAll([
      {
        type: 'tool_call_start',
        call: {
          callId: 'call-hard',
          toolId: 'required_tool',
          category: 'tool',
          status: 'running',
          input: { id: 1 },
        },
      },
      { type: 'tool_call_error', callId: 'call-hard', error: 'required tool failed' },
      { type: 'error', error: 'agent cannot continue' },
    ])

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'tool_call_started',
      'tool_call_failed',
      'response_failed',
    ])
    expect(mapped[3]).toMatchObject({
      type: 'response_failed',
      responseId: 'resp-agent',
      error: { code: 'AGENT_RUNTIME_ERROR', message: 'agent cannot continue' },
    })
  })
  it('maps agent runtime errors into response failures', () => {
    const mapped = mapAll([{ type: 'error', error: 'agent failed' }])

    expect(mapped).toEqual([
      {
        type: 'response_started',
        responseId: 'resp-agent',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        model: 'gpt-4o',
        createdAt: 100,
      },
      {
        type: 'response_failed',
        responseId: 'resp-agent',
        error: { code: 'AGENT_RUNTIME_ERROR', message: 'agent failed' },
        completedAt: 100,
      },
    ])
  })

  it('can complete without an explicit done event', () => {
    const mapper = createAgentResponseEventMapper({
      sessionId: 'session-1',
      model: 'gpt-4o',
      maxSteps: 10,
      responseId: 'resp-no-done',
      now: () => 200,
      idFactory: () => 'block-answer',
    })

    const mapped = [
      ...mapper.map({ type: 'delta', text: 'partial' }),
      ...mapper.completeWithoutDone(),
    ]

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'content_block_started',
      'content_delta',
      'content_block_completed',
      'response_completed',
    ])
    expect(mapped[4]).toMatchObject({
      type: 'response_completed',
      finishReason: 'unknown',
      trace: {
        runtime: 'mastra-chat-agent-v1',
        model: 'gpt-4o',
        maxSteps: 10,
      },
    })
  })
})

