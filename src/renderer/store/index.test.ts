import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseStreamEvent } from '@shared/schemas/response'

const platformMock = vi.hoisted(() => ({
  chatStream: vi.fn(),
  getMessages: vi.fn(),
  getSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  updateSession: vi.fn(),
  getPersonas: vi.fn(),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  deletePersona: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getLlmModels: vi.fn(),
  getLlmProviders: vi.fn(),
  updateLlmProvider: vi.fn(),
  createLlmModel: vi.fn(),
  updateLlmModel: vi.fn(),
  getOllamaModels: vi.fn(),
  setTheme: vi.fn(),
  readClipboard: vi.fn(),
  getActiveWindow: vi.fn(),
}))

vi.mock('@renderer/api', () => ({
  platform: platformMock,
}))

async function* emptyStream() {}

async function* streamEvents(items: ResponseStreamEvent[]): AsyncGenerator<ResponseStreamEvent> {
  for (const item of items) yield item
}

describe('chat store response events', () => {
  beforeEach(() => {
    vi.resetModules()
    platformMock.chatStream.mockReset()
    platformMock.getMessages.mockReset()
    platformMock.getSessions.mockReset()
    platformMock.createSession.mockReset()
    platformMock.deleteSession.mockReset()
    platformMock.updateSession.mockReset()
    platformMock.getPersonas.mockReset()
    platformMock.createPersona.mockReset()
    platformMock.updatePersona.mockReset()
    platformMock.deletePersona.mockReset()
    platformMock.getSettings.mockReset()
    platformMock.updateSettings.mockReset()
    platformMock.getLlmModels.mockReset()
    platformMock.getLlmProviders.mockReset()
    platformMock.updateLlmProvider.mockReset()
    platformMock.createLlmModel.mockReset()
    platformMock.updateLlmModel.mockReset()
    platformMock.getOllamaModels.mockReset()
    platformMock.setTheme.mockReset()
    platformMock.readClipboard.mockReset()
    platformMock.getActiveWindow.mockReset()
    platformMock.getMessages.mockResolvedValue([])
    platformMock.getSessions.mockResolvedValue([])
  })

  it('derives streaming text, tool calls, token usage, and v1 response state from response events', async () => {
    const { useChatStore } = await import('./index')
    const gate = deferred()
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        {
          type: 'response_started',
          responseId: 'response-1',
          sessionId: 's1',
          runtime: 'mastra-chat-agent-v1',
          model: 'gpt-4o',
          createdAt: 1,
        },
        {
          type: 'tool_call_started',
          responseId: 'response-1',
          block: {
            id: 'tool-block-1',
            type: 'tool_call',
            callId: 'c1',
            toolId: 'web_search',
            category: 'web',
            status: 'running',
            input: { query: 'bloomai' },
            createdAt: 2,
          },
        },
        {
          type: 'tool_call_completed',
          responseId: 'response-1',
          callId: 'c1',
          output: { results: [{ title: 'BloomAI', url: 'https://example.com', snippet: 'hello' }] },
          outputSummary: '1 results',
          durationMs: 12,
          completedAt: 3,
        },
        {
          type: 'tool_call_started',
          responseId: 'response-1',
          block: {
            id: 'tool-block-2',
            type: 'tool_call',
            callId: 'c2',
            toolId: 'web_search',
            category: 'web',
            status: 'running',
            input: { query: 'oops' },
            createdAt: 4,
          },
        },
        {
          type: 'tool_call_failed',
          responseId: 'response-1',
          callId: 'c2',
          error: { code: 'TOOL_CALL_ERROR', message: 'boom' },
          completedAt: 5,
        },
        {
          type: 'content_block_started',
          responseId: 'response-1',
          block: {
            id: 'block-1',
            type: 'markdown',
            status: 'streaming',
            role: 'answer',
            createdAt: 6,
          },
        },
        { type: 'content_delta', responseId: 'response-1', blockId: 'block-1', delta: 'Hi' },
        {
          type: 'usage_updated',
          responseId: 'response-1',
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        },
      ])
      await gate.promise
      yield {
        type: 'response_completed',
        responseId: 'response-1',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        finishReason: 'stop',
        completedAt: 7,
      }
    })

    const sendPromise = useChatStore.getState().sendMessage('s1', 'hello')
    await waitForState(() => useChatStore.getState().streamingText === 'Hi')
    const streamingState = useChatStore.getState()

    expect(streamingState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-1',
      sessionId: 's1',
      isComplete: false,
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    })
    expect(streamingState.toolCallsBySession.s1).toEqual([
      {
        callId: 'c1',
        toolId: 'web_search',
        category: 'web',
        status: 'success',
        input: { query: 'bloomai' },
        output: { results: [{ title: 'BloomAI', url: 'https://example.com', snippet: 'hello' }] },
        durationMs: 12,
      },
      {
        callId: 'c2',
        toolId: 'web_search',
        category: 'web',
        status: 'error',
        input: { query: 'oops' },
        error: 'boom',
      },
    ])
    expect(streamingState.tokenUsage.s1).toEqual({ input: 1, output: 2 })

    gate.resolve()
    await sendPromise

    const finalState = useChatStore.getState()
    expect(finalState.streamingResponsesBySession.s1).toBeNull()
    expect(finalState.streamingText).toBe('')
    expect(finalState.tokenUsage.s1).toEqual({ input: 1, output: 2 })
  })

  it('keeps partial streaming response state after response failures so Timeline can render the error', async () => {
    const { useChatStore } = await import('./index')
    const gate = deferred()
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        {
          type: 'response_started',
          responseId: 'response-2',
          sessionId: 's1',
          runtime: 'direct-llm',
          createdAt: 1,
        },
        {
          type: 'content_block_started',
          responseId: 'response-2',
          block: { id: 'block-1', type: 'markdown', status: 'streaming', role: 'answer', createdAt: 2 },
        },
        { type: 'content_delta', responseId: 'response-2', blockId: 'block-1', delta: 'partial' },
        {
          type: 'response_failed',
          responseId: 'response-2',
          error: { code: 'LLM_PROVIDER_ERROR', message: 'failed' },
          completedAt: 3,
        },
      ])
      await gate.promise
    })

    const sendPromise = useChatStore.getState().sendMessage('s1', 'hello')
    await waitForState(() => useChatStore.getState().streamError === 'failed')
    const streamingState = useChatStore.getState()

    expect(streamingState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-2',
      isComplete: true,
      error: { code: 'LLM_PROVIDER_ERROR', message: 'failed' },
    })
    expect(streamingState.streamingText).toBe('partial')

    gate.resolve()
    await sendPromise

    const finalState = useChatStore.getState()
    expect(finalState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-2',
      isComplete: true,
      error: { code: 'LLM_PROVIDER_ERROR', message: 'failed' },
    })
    expect(finalState.streamingResponsesBySession.s1?.blocks.map((block) => block.type)).toEqual(['markdown', 'error'])
    expect(finalState.streamError).toBe('failed')
    expect(finalState.streamingText).toBe('')
  })

  it('keeps failed web search response blocks after summarization fails so Timeline can render one group and error', async () => {
    const { useChatStore } = await import('./index')
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        {
          type: 'response_started',
          responseId: 'response-web-fail',
          sessionId: 's1',
          runtime: 'mastra-chat-agent-v1',
          model: 'gpt-4o',
          createdAt: 1,
        },
        {
          type: 'tool_call_started',
          responseId: 'response-web-fail',
          block: {
            id: 'tool-block-1',
            type: 'tool_call',
            callId: 'c1',
            toolId: 'web_search',
            category: 'web',
            status: 'running',
            input: { query: 'World Cup news' },
            createdAt: 2,
          },
        },
        {
          type: 'tool_call_completed',
          responseId: 'response-web-fail',
          callId: 'c1',
          output: { results: [{ title: 'World Cup', url: 'https://example.com', snippet: 'news' }] },
          outputSummary: '1 results',
          completedAt: 3,
        },
        {
          type: 'response_failed',
          responseId: 'response-web-fail',
          error: { code: 'AGENT_RUNTIME_ERROR', message: 'summary failed' },
          completedAt: 4,
        },
      ])
    })

    await useChatStore.getState().sendMessage('s1', 'search news')

    const finalState = useChatStore.getState()
    expect(finalState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-web-fail',
      isComplete: true,
      error: { code: 'AGENT_RUNTIME_ERROR', message: 'summary failed' },
    })
    expect(finalState.streamingResponsesBySession.s1?.blocks.map((block) => block.type)).toEqual(['tool_call', 'error'])
    expect(finalState.toolCallsBySession.s1).toHaveLength(1)
    expect(finalState.streamError).toBe('summary failed')
    expect(platformMock.getMessages).not.toHaveBeenCalled()
  })

  it('converts thrown stream errors into response_failed state without dropping existing tool blocks', async () => {
    const { useChatStore } = await import('./index')
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        {
          type: 'response_started',
          responseId: 'response-throw',
          sessionId: 's1',
          runtime: 'mastra-chat-agent-v1',
          model: 'gpt-4o',
          createdAt: 1,
        },
        {
          type: 'tool_call_started',
          responseId: 'response-throw',
          block: {
            id: 'tool-block-throw',
            type: 'tool_call',
            callId: 'c-throw',
            toolId: 'web_search',
            category: 'web',
            status: 'running',
            input: { query: 'World Cup news' },
            createdAt: 2,
          },
        },
      ])
      throw new Error('agent stream crashed')
    })

    await useChatStore.getState().sendMessage('s1', 'search news')

    const finalState = useChatStore.getState()
    expect(finalState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-throw',
      isComplete: true,
      error: { code: 'UNKNOWN_ERROR', message: 'agent stream crashed' },
    })
    expect(finalState.streamingResponsesBySession.s1?.blocks.map((block) => block.type)).toEqual(['tool_call', 'error'])
    expect(finalState.toolCallsBySession.s1).toEqual([
      expect.objectContaining({ callId: 'c-throw', status: 'error', interrupted: true }),
    ])
    expect(finalState.streamError).toBe('agent stream crashed')
  })
  it('clears streaming response and tool calls when a new message starts', async () => {
    const { useChatStore } = await import('./index')
    useChatStore.setState({
      streamingResponsesBySession: {
        s1: {
          responseId: 'old-response',
          sessionId: 's1',
          blocks: [],
          isComplete: false,
        },
      },
      toolCallsBySession: {
        s1: [
          { callId: 'old', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'old' } },
        ],
      },
    })
    platformMock.chatStream.mockImplementation(emptyStream)

    const sendPromise = useChatStore.getState().sendMessage('s1', 'next')
    expect(useChatStore.getState().toolCallsBySession.s1).toEqual([])
    expect(useChatStore.getState().streamingResponsesBySession.s1).toBeNull()
    await sendPromise
  })

  it('does not append an empty assistant message when the stream fails before content', async () => {
    const { useChatStore } = await import('./index')
    platformMock.getMessages.mockResolvedValueOnce([
      { id: 'server-user-1', session_id: 's1', role: 'user', content: 'hello', created_at: 1 },
    ])
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        {
          type: 'response_started',
          responseId: 'response-empty-fail',
          sessionId: 's1',
          runtime: 'direct-llm',
          createdAt: 1,
        },
        {
          type: 'response_failed',
          responseId: 'response-empty-fail',
          error: { code: 'LLM_PROVIDER_ERROR', message: 'failed before content' },
          completedAt: 2,
        },
      ])
    })

    await useChatStore.getState().sendMessage('s1', 'hello')

    const finalState = useChatStore.getState()
    expect(finalState.streamError).toBe('failed before content')
    expect(finalState.messagesBySession.s1.some((message) => message.role === 'assistant' && message.content === '')).toBe(false)
    expect(finalState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-empty-fail',
      isComplete: true,
      error: { code: 'LLM_PROVIDER_ERROR', message: 'failed before content' },
    })
    expect(finalState.streamingResponsesBySession.s1?.blocks.map((block) => block.type)).toEqual(['error'])
  })

  it('keeps legacy-normalized streams compatible with store derived fields', async () => {
    const { createChatStreamNormalizer } = await import('@renderer/api/chat-stream-normalizer')
    const { useChatStore } = await import('./index')
    const gate = deferred()
    platformMock.chatStream.mockImplementation(async function* () {
      const normalizer = createChatStreamNormalizer({
        sessionId: 's1',
        responseId: 'legacy-response',
        now: createNow(100),
        idFactory: createIds(['block-1']),
      })
      for (const event of normalizer.normalize({ type: 'delta', text: 'Hel' })) yield event
      for (const event of normalizer.normalize({ type: 'delta', text: 'lo' })) yield event
      await gate.promise
      for (const event of normalizer.normalize({ type: 'done', tokens: { input: 2, output: 3 } })) yield event
    })

    const sendPromise = useChatStore.getState().sendMessage('s1', 'hello')
    await waitForState(() => useChatStore.getState().streamingText === 'Hello')

    expect(useChatStore.getState().streamingResponsesBySession.s1).toMatchObject({
      responseId: 'legacy-response',
      blocks: [expect.objectContaining({ type: 'markdown', markdown: 'Hello' })],
    })

    gate.resolve()
    await sendPromise

    expect(useChatStore.getState().tokenUsage.s1).toEqual({ input: 2, output: 3 })
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createNow(start: number): () => number {
  let current = start
  return () => current++
}

function createIds(ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? `id-${index}`
}

async function waitForState(assertion: () => boolean): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(assertion()).toBe(true)
}