import { describe, expect, it } from 'vitest'
import type { ResponseStreamEvent } from '@shared/schemas/response'
import { createChatStreamNormalizer } from './chat-stream-normalizer'

describe('createChatStreamNormalizer', () => {
  it('normalizes legacy delta and done chunks into agent v1 response events', () => {
    const normalizer = createChatStreamNormalizer({
      sessionId: 'session-1',
      responseId: 'response-1',
      now: createNow(100),
      idFactory: createIds(['block-1']),
    })

    const events = [
      ...normalizer.normalize({ type: 'delta', text: 'Hel' }),
      ...normalizer.normalize({ type: 'delta', text: 'lo' }),
      ...normalizer.normalize({ type: 'done', tokens: { input: 3, output: 5 } }),
    ]

    expect(events).toEqual([
      {
        type: 'response_started',
        responseId: 'response-1',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 100,
      },
      {
        type: 'content_block_started',
        responseId: 'response-1',
        block: {
          id: 'block-1',
          type: 'markdown',
          status: 'streaming',
          role: 'answer',
          createdAt: 101,
        },
      },
      { type: 'content_delta', responseId: 'response-1', blockId: 'block-1', delta: 'Hel' },
      { type: 'content_delta', responseId: 'response-1', blockId: 'block-1', delta: 'lo' },
      {
        type: 'usage_updated',
        responseId: 'response-1',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      },
      { type: 'content_block_completed', responseId: 'response-1', blockId: 'block-1', completedAt: 102 },
      {
        type: 'response_completed',
        responseId: 'response-1',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
        trace: {
          schemaVersion: 'bloom-response-v1',
          runtime: 'mastra-chat-agent-v1',
          finishReason: 'stop',
        },
        finishReason: 'stop',
        completedAt: 103,
      },
    ])
    expect(normalizer.flush()).toEqual([])
  })

  it('normalizes legacy tool call chunks into v1 tool events', () => {
    const normalizer = createChatStreamNormalizer({
      sessionId: 'session-1',
      responseId: 'response-2',
      now: createNow(200),
      idFactory: createIds(['tool-block-1']),
    })

    const events = [
      ...normalizer.normalize({
        type: 'tool_call_start',
        call: {
          callId: 'call-1',
          toolId: 'web_search',
          category: 'web',
          status: 'running',
          input: { query: 'BloomAI' },
        },
      }),
      ...normalizer.normalize({
        type: 'tool_call_result',
        callId: 'call-1',
        output: { results: [{ title: 'BloomAI' }] },
        durationMs: 12,
      }),
      ...normalizer.normalize({ type: 'tool_call_error', callId: 'call-2', error: 'boom' }),
    ]

    expect(events).toEqual([
      {
        type: 'response_started',
        responseId: 'response-2',
        sessionId: 'session-1',
        runtime: 'agent-runtime',
        createdAt: 200,
      },
      {
        type: 'tool_call_started',
        responseId: 'response-2',
        block: {
          id: 'tool-block-1',
          type: 'tool_call',
          callId: 'call-1',
          toolId: 'web_search',
          category: 'web',
          status: 'running',
          input: { query: 'BloomAI' },
          createdAt: 201,
        },
      },
      {
        type: 'tool_call_completed',
        responseId: 'response-2',
        callId: 'call-1',
        output: { results: [{ title: 'BloomAI' }] },
        outputSummary: '1 results',
        durationMs: 12,
        completedAt: 202,
      },
      {
        type: 'tool_call_failed',
        responseId: 'response-2',
        callId: 'call-2',
        error: { code: 'TOOL_CALL_ERROR', message: 'boom' },
        completedAt: 203,
      },
    ])
  })

  it('passes v1 chunks through unchanged', () => {
    const normalizer = createChatStreamNormalizer({ sessionId: 'session-1' })
    const event: ResponseStreamEvent = {
      type: 'response_started',
      responseId: 'response-v1',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      createdAt: 1,
    }

    expect(normalizer.normalize(event)).toEqual([event])
  })

  it('passes v1 tool status messages through unchanged', () => {
    const normalizer = createChatStreamNormalizer({ sessionId: 'session-1' })
    const event: ResponseStreamEvent = {
      type: 'tool_call_delta',
      responseId: 'response-v1',
      callId: 'call-1',
      patch: { statusMessage: 'Searching docs' },
    }

    expect(normalizer.normalize(event)).toEqual([event])
  })

  it('flushes an unfinished v1 stream as a completed v1 response', () => {
    const normalizer = createChatStreamNormalizer({
      sessionId: 'session-1',
      now: createNow(500),
    })

    expect(normalizer.normalize({
      type: 'response_started',
      responseId: 'response-v1',
      sessionId: 'session-1',
      runtime: 'agent-runtime',
      createdAt: 1,
    })).toEqual([{
      type: 'response_started',
      responseId: 'response-v1',
      sessionId: 'session-1',
      runtime: 'agent-runtime',
      createdAt: 1,
    }])

    expect(normalizer.flush()).toEqual([{
      type: 'response_completed',
      responseId: 'response-v1',
      usage: undefined,
      trace: {
        schemaVersion: 'bloom-response-v1',
        runtime: 'agent-runtime',
        finishReason: 'stop',
      },
      finishReason: 'stop',
      completedAt: 500,
    }])
  })

  it('flushes an unfinished legacy stream as a completed v1 response', () => {
    const normalizer = createChatStreamNormalizer({
      sessionId: 'session-1',
      responseId: 'response-3',
      now: createNow(300),
      idFactory: createIds(['block-3']),
    })

    const events = normalizer.normalize({ type: 'delta', text: 'partial' })
    const flushed = normalizer.flush()

    expect(events.map((event) => event.type)).toEqual([
      'response_started',
      'content_block_started',
      'content_delta',
    ])
    expect(flushed).toEqual([
      { type: 'content_block_completed', responseId: 'response-3', blockId: 'block-3', completedAt: 302 },
      {
        type: 'response_completed',
        responseId: 'response-3',
        usage: undefined,
        trace: {
          schemaVersion: 'bloom-response-v1',
          runtime: 'mastra-chat-agent-v1',
          finishReason: 'stop',
        },
        finishReason: 'stop',
        completedAt: 303,
      },
    ])
    expect(normalizer.flush()).toEqual([])
  })

  it('normalizes legacy error chunks into response_failed', () => {
    const normalizer = createChatStreamNormalizer({
      sessionId: 'session-1',
      responseId: 'response-4',
      now: createNow(400),
    })

    expect(normalizer.normalize({ type: 'error', error: 'failed' })).toEqual([
      {
        type: 'response_started',
        responseId: 'response-4',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 400,
      },
      {
        type: 'response_failed',
        responseId: 'response-4',
        error: { code: 'LEGACY_CHAT_STREAM_ERROR', message: 'failed' },
        completedAt: 401,
      },
    ])
    expect(normalizer.flush()).toEqual([])
  })
  it('maps aborts and disconnects into STREAM_ABORTED failures', () => {
    const normalizer = createChatStreamNormalizer({
      sessionId: 'session-1',
      responseId: 'response-5',
      now: createNow(600),
    })

    expect(normalizer.fail(new DOMException('The operation was aborted', 'AbortError'))).toEqual([
      {
        type: 'response_started',
        responseId: 'response-5',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 600,
      },
      {
        type: 'response_failed',
        responseId: 'response-5',
        error: { code: 'STREAM_ABORTED', message: 'The operation was aborted' },
        completedAt: 601,
      },
    ])
    expect(normalizer.flush()).toEqual([])
  })

  it('turns malformed or unknown chunks into visible response failures', () => {
    const normalizer = createChatStreamNormalizer({
      sessionId: 'session-1',
      responseId: 'response-6',
      now: createNow(700),
    })

    expect(normalizer.normalize({ type: 'wat' })).toEqual([
      {
        type: 'response_started',
        responseId: 'response-6',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 700,
      },
      {
        type: 'response_failed',
        responseId: 'response-6',
        error: {
          code: 'MALFORMED_CHAT_STREAM_EVENT',
          message: 'Received an unknown chat stream event.',
          details: { type: 'wat' },
        },
        completedAt: 701,
      },
    ])
  })
})

function createNow(start: number): () => number {
  let current = start
  return () => current++
}

function createIds(ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? `id-${index}`
}
