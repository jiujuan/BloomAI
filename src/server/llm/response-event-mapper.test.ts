import { describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent } from './types'

vi.mock('../logger/logger', () => ({
  logError: vi.fn(),
  sanitizeErrorMessage: (error: unknown, fallback = 'Unknown error') =>
    error instanceof Error ? error.message : fallback,
}))

import { mapLlmStreamToResponseEvents } from './response-event-mapper'

async function* events(items: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const item of items) yield item
}

async function collect(source: AsyncGenerator<any>): Promise<any[]> {
  const result: any[] = []
  for await (const item of source) result.push(item)
  return result
}

describe('mapLlmStreamToResponseEvents', () => {
  it('maps delta, usage, and done into response contract events', async () => {
    const mapped = await collect(
      mapLlmStreamToResponseEvents(
        events([
          { type: 'delta', text: 'Hel' },
          { type: 'delta', text: 'lo' },
          { type: 'usage', input: 3, output: 5 },
          { type: 'done' },
        ]),
        {
          sessionId: 'session-1',
          model: 'gpt-4o',
          providerId: 'openai',
          responseId: 'resp-1',
          now: () => 100,
          idFactory: () => 'block-1',
        },
      ),
    )

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'content_block_started',
      'content_delta',
      'content_delta',
      'usage_updated',
      'content_block_completed',
      'response_completed',
    ])
    expect(mapped[0]).toMatchObject({
      type: 'response_started',
      responseId: 'resp-1',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      providerId: 'openai',
      model: 'gpt-4o',
    })
    expect(mapped[1]).toMatchObject({
      type: 'content_block_started',
      responseId: 'resp-1',
      block: { id: 'block-1', type: 'markdown', status: 'streaming', role: 'answer' },
    })
    expect(mapped[2]).toEqual({
      type: 'content_delta',
      responseId: 'resp-1',
      blockId: 'block-1',
      delta: 'Hel',
    })
    expect(mapped[4]).toEqual({
      type: 'usage_updated',
      responseId: 'resp-1',
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
        provider: 'openai',
        model: 'gpt-4o',
      },
    })
    expect(mapped[6]).toMatchObject({
      type: 'response_completed',
      responseId: 'resp-1',
      finishReason: 'stop',
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      },
      trace: {
        schemaVersion: 'bloom-response-v1',
        runtime: 'mastra-chat-agent-v1',
        providerId: 'openai',
        model: 'gpt-4o',
        finishReason: 'stop',
      },
    })
  })

  it('completes an empty stream without starting a content block', async () => {
    const mapped = await collect(
      mapLlmStreamToResponseEvents(events([]), {
        sessionId: 'session-1',
        model: 'gpt-4o',
        responseId: 'resp-empty',
        now: () => 200,
        idFactory: () => 'block-empty',
      }),
    )

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'response_completed',
    ])
  })

  it('does not start an empty content block when the source fails before content', async () => {
    async function* failing(): AsyncGenerator<ChatStreamEvent> {
      throw new Error('provider unavailable')
    }

    const mapped = await collect(
      mapLlmStreamToResponseEvents(failing(), {
        sessionId: 'session-1',
        model: 'gpt-4o',
        responseId: 'resp-before-content-fail',
        now: () => 250,
        idFactory: () => 'block-before-content-fail',
      }),
    )

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'response_failed',
    ])
    expect(mapped[1]).toMatchObject({
      type: 'response_failed',
      responseId: 'resp-before-content-fail',
      error: {
        code: 'LLM_PROVIDER_ERROR',
        message: 'provider unavailable',
      },
    })
  })
  it('emits response_failed when the source stream throws', async () => {
    async function* failing(): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'delta', text: 'partial' }
      throw new Error('stream failed')
    }

    const mapped = await collect(
      mapLlmStreamToResponseEvents(failing(), {
        sessionId: 'session-1',
        model: 'gpt-4o',
        responseId: 'resp-fail',
        now: () => 300,
        idFactory: () => 'block-fail',
      }),
    )

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'content_block_started',
      'content_delta',
      'response_failed',
    ])
    expect(mapped[3]).toMatchObject({
      type: 'response_failed',
      responseId: 'resp-fail',
      error: {
        code: 'LLM_PROVIDER_ERROR',
        message: 'stream failed',
      },
    })
  })

  it('maps aborted streams to STREAM_ABORTED failures', async () => {
    async function* aborted(): AsyncGenerator<ChatStreamEvent> {
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      throw error
    }

    const mapped = await collect(
      mapLlmStreamToResponseEvents(aborted(), {
        sessionId: 'session-1',
        model: 'gpt-4o',
        responseId: 'resp-abort',
        now: () => 400,
        idFactory: () => 'block-abort',
      }),
    )

    expect(mapped.map((event) => event.type)).toEqual([
      'response_started',
      'response_failed',
    ])
    expect(mapped[1]).toMatchObject({
      type: 'response_failed',
      responseId: 'resp-abort',
      error: {
        code: 'STREAM_ABORTED',
        message: 'The operation was aborted',
      },
    })
  })
})
