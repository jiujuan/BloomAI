import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseStreamEvent } from '@shared/schemas/response'
import { deriveStreamingText, deriveToolCalls } from './chat-response-reducer'

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

  it('uses streamingResponsesBySession as the only active streaming response state', async () => {
    const { useChatStore } = await import('./index')
    const gate = deferred()
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        responseStarted('response-1'),
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
          output: { results: [{ title: 'BloomAI' }] },
          outputSummary: '1 results',
          durationMs: 12,
          completedAt: 3,
        },
        markdownStarted('response-1', 'block-1'),
        { type: 'content_delta', responseId: 'response-1', blockId: 'block-1', delta: 'Hi' },
        { type: 'usage_updated', responseId: 'response-1', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
      ])
      await gate.promise
      yield { type: 'content_block_completed', responseId: 'response-1', blockId: 'block-1', completedAt: 6 }
      yield { type: 'response_completed', responseId: 'response-1', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, finishReason: 'stop', completedAt: 7 }
    })

    const sendPromise = useChatStore.getState().sendMessage('s1', 'hello')
    await waitForState(() => deriveStreamingText(useChatStore.getState().streamingResponsesBySession.s1) === 'Hi')
    const streamingState = useChatStore.getState()

    expectRemovedActiveStreamFieldsAbsent(streamingState)
    expect(streamingState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-1',
      sessionId: 's1',
      isComplete: false,
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    })
    expect(deriveStreamingText(streamingState.streamingResponsesBySession.s1)).toBe('Hi')
    expect(deriveToolCalls(streamingState.streamingResponsesBySession.s1)).toEqual([
      expect.objectContaining({ callId: 'c1', status: 'success', output: { results: [{ title: 'BloomAI' }] } }),
    ])
    expect(streamingState.tokenUsage.s1).toEqual({ input: 1, output: 2 })

    gate.resolve()
    await sendPromise

    const finalState = useChatStore.getState()
    expectRemovedActiveStreamFieldsAbsent(finalState)
    expect(finalState.streamingResponsesBySession.s1).toBeNull()
    expect(finalState.tokenUsage.s1).toEqual({ input: 1, output: 2 })
  })

  it('keeps response_failed blocks as the only active failure state', async () => {
    const { useChatStore } = await import('./index')
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        responseStarted('response-fail'),
        markdownStarted('response-fail', 'block-1'),
        { type: 'content_delta', responseId: 'response-fail', blockId: 'block-1', delta: 'partial' },
        { type: 'response_failed', responseId: 'response-fail', error: { code: 'LLM_PROVIDER_ERROR', message: 'failed' }, completedAt: 3 },
      ])
    })

    await useChatStore.getState().sendMessage('s1', 'hello')

    const finalState = useChatStore.getState()
    expectRemovedActiveStreamFieldsAbsent(finalState)
    expect(finalState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-fail',
      isComplete: true,
      error: { code: 'LLM_PROVIDER_ERROR', message: 'failed' },
    })
    expect(deriveStreamingText(finalState.streamingResponsesBySession.s1)).toBe('partial')
    expect(finalState.streamingResponsesBySession.s1?.blocks.map((block) => block.type)).toEqual(['markdown', 'error'])
    expect(finalState.messagesBySession.s1.some((message) => message.role === 'assistant' && message.content === '')).toBe(false)
    expect(platformMock.getMessages).not.toHaveBeenCalled()
  })

  it('keeps failed tool blocks in the v1 response after summarization fails', async () => {
    const { useChatStore } = await import('./index')
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        responseStarted('response-web-fail'),
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
        { type: 'tool_call_completed', responseId: 'response-web-fail', callId: 'c1', outputSummary: '1 results', completedAt: 3 },
        { type: 'response_failed', responseId: 'response-web-fail', error: { code: 'AGENT_RUNTIME_ERROR', message: 'summary failed' }, completedAt: 4 },
      ])
    })

    await useChatStore.getState().sendMessage('s1', 'search news')

    const finalState = useChatStore.getState()
    expectRemovedActiveStreamFieldsAbsent(finalState)
    expect(finalState.streamingResponsesBySession.s1?.blocks.map((block) => block.type)).toEqual(['tool_call', 'error'])
    expect(deriveToolCalls(finalState.streamingResponsesBySession.s1)).toEqual([
      expect.objectContaining({ callId: 'c1', status: 'success' }),
    ])
    expect(platformMock.getMessages).not.toHaveBeenCalled()
  })

  it('reduces skill response streams into v1 blocks without a special skill UI state', async () => {
    const { useChatStore } = await import('./index')
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        responseStarted('response-skill'),
        {
          type: 'tool_call_started',
          responseId: 'response-skill',
          block: {
            id: 'skill-block-1',
            type: 'tool_call',
            callId: 'skill-call-1',
            toolId: 'skill:writer',
            category: 'tool',
            status: 'running',
            input: { topic: 'release notes' },
            createdAt: 2,
          },
        },
        {
          type: 'tool_call_completed',
          responseId: 'response-skill',
          callId: 'skill-call-1',
          outputSummary: 'Skill completed',
          durationMs: 4,
          completedAt: 3,
        },
        markdownStarted('response-skill', 'block-skill-answer'),
        { type: 'content_delta', responseId: 'response-skill', blockId: 'block-skill-answer', delta: 'Draft ready.' },
      ])
      yield { type: 'content_block_completed', responseId: 'response-skill', blockId: 'block-skill-answer', completedAt: 5 }
      yield { type: 'response_completed', responseId: 'response-skill', finishReason: 'stop', completedAt: 6 }
    })

    platformMock.getMessages.mockResolvedValueOnce([
      { id: 'persisted-user', session_id: 's1', role: 'user', content: 'run writer skill', created_at: 1 },
      { id: 'persisted-assistant', session_id: 's1', role: 'assistant', content: 'Draft ready.', created_at: 2 },
    ])

    await useChatStore.getState().sendMessage('s1', 'run writer skill')

    const assistant = useChatStore.getState().messagesBySession.s1.find((message) => message.role === 'assistant')
    expect(assistant?.content).toBe('Draft ready.')
    expect(platformMock.getMessages).toHaveBeenCalledWith('s1')
    expect(useChatStore.getState().streamingResponsesBySession.s1).toBeNull()
    expectRemovedActiveStreamFieldsAbsent(useChatStore.getState())
  })
  it('converts thrown stream errors into response_failed blocks without dropping running tools', async () => {
    const { useChatStore } = await import('./index')
    platformMock.chatStream.mockImplementation(async function* () {
      yield* streamEvents([
        responseStarted('response-throw'),
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
    expectRemovedActiveStreamFieldsAbsent(finalState)
    expect(finalState.streamingResponsesBySession.s1).toMatchObject({
      responseId: 'response-throw',
      isComplete: true,
      error: { code: 'UNKNOWN_ERROR', message: 'agent stream crashed' },
    })
    expect(finalState.streamingResponsesBySession.s1?.blocks.map((block) => block.type)).toEqual(['tool_call', 'error'])
    expect(deriveToolCalls(finalState.streamingResponsesBySession.s1)).toEqual([
      expect.objectContaining({ callId: 'c-throw', status: 'error', interrupted: true }),
    ])
  })

  it('clears only v1 streaming response state when a new message starts', async () => {
    const { useChatStore } = await import('./index')
    useChatStore.setState({
      streamingResponsesBySession: {
        s1: { responseId: 'old-response', sessionId: 's1', blocks: [], isComplete: false },
      },
    })
    platformMock.chatStream.mockImplementation(emptyStream)

    const sendPromise = useChatStore.getState().sendMessage('s1', 'next')
    expectRemovedActiveStreamFieldsAbsent(useChatStore.getState())
    expect(useChatStore.getState().streamingResponsesBySession.s1).toBeNull()
    await sendPromise
  })
})

function responseStarted(responseId: string): ResponseStreamEvent {
  return {
    type: 'response_started',
    responseId,
    sessionId: 's1',
    runtime: 'mastra-chat-agent-v1',
    createdAt: 1,
  }
}

function markdownStarted(responseId: string, blockId: string): ResponseStreamEvent {
  return {
    type: 'content_block_started',
    responseId,
    block: { id: blockId, type: 'markdown', status: 'streaming', role: 'answer', createdAt: 2 },
  }
}

function expectRemovedActiveStreamFieldsAbsent(state: object): void {
  const removedFields = [
    ['streaming', 'Text'].join(''),
    ['stream', 'Error'].join(''),
    ['toolCalls', 'BySession'].join(''),
    ['clearStreaming', 'ToolCalls'].join(''),
  ]
  for (const field of removedFields) expect(field in state).toBe(false)
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitForState(assertion: () => boolean): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(assertion()).toBe(true)
}
