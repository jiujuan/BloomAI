import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseStreamEvent } from '@shared/schemas/response'
import { platform } from './index'

const originalFetch = globalThis.fetch
const originalCrypto = globalThis.crypto

describe('platform.chatStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1234)
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => 'generated-response-id' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
    globalThis.fetch = originalFetch
  })

  it('passes backend v1 response events through unchanged', async () => {
    const events: ResponseStreamEvent[] = [
      {
        type: 'response_started',
        responseId: 'response-1',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 1,
      },
      {
        type: 'content_block_started',
        responseId: 'response-1',
        block: {
          id: 'block-1',
          type: 'markdown',
          status: 'streaming',
          role: 'answer',
          createdAt: 2,
        },
      },
      { type: 'content_delta', responseId: 'response-1', blockId: 'block-1', delta: 'Hello' },
      { type: 'response_completed', responseId: 'response-1', finishReason: 'stop', completedAt: 3 },
    ]
    mockFetchStream(events.map((event) => 'data: ' + JSON.stringify(event) + '\n').join(''))

    await expect(collectChatStream()).resolves.toEqual(events)
  })

  it('stops without extra events when [DONE] is received', async () => {
    const event: ResponseStreamEvent = {
      type: 'response_started',
      responseId: 'response-done',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      createdAt: 1,
    }
    mockFetchStream('data: ' + JSON.stringify(event) + '\ndata: [DONE]\ndata: ' + JSON.stringify({ type: 'response_completed' }) + '\n')

    await expect(collectChatStream()).resolves.toEqual([event])
  })

  it('turns malformed JSON into a visible v1 response failure', async () => {
    mockFetchStream('data: {bad json}\n')

    await expect(collectChatStream()).resolves.toEqual([
      {
        type: 'response_started',
        responseId: 'generated-response-id',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 1234,
      },
      {
        type: 'response_failed',
        responseId: 'generated-response-id',
        error: expect.objectContaining({ code: 'MALFORMED_CHAT_STREAM_EVENT' }),
        completedAt: 1234,
      },
    ])
  })

  it('turns network aborts into STREAM_ABORTED failures', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      body: {
        getReader: () => ({
          read: vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')),
        }),
      },
    } as unknown as Response)

    await expect(collectChatStream()).resolves.toEqual([
      {
        type: 'response_started',
        responseId: 'generated-response-id',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 1234,
      },
      {
        type: 'response_failed',
        responseId: 'generated-response-id',
        error: { code: 'STREAM_ABORTED', message: 'The operation was aborted' },
        completedAt: 1234,
      },
    ])
  })
})

async function collectChatStream(): Promise<ResponseStreamEvent[]> {
  const events: ResponseStreamEvent[] = []
  for await (const event of platform.chatStream({ sessionId: 'session-1', content: 'Hello' })) {
    events.push(event)
  }
  return events
}

function mockFetchStream(sse: string): void {
  const encoder = new TextEncoder()
  let sent = false
  globalThis.fetch = vi.fn().mockResolvedValue({
    body: {
      getReader: () => ({
        read: vi.fn().mockImplementation(async () => {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: encoder.encode(sse) }
        }),
      }),
    },
  } as unknown as Response)
}