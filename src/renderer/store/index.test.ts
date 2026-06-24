import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('chat store tool call events', () => {
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
  })

  it('tracks running, success, and error tool call states', async () => {
    const { useChatStore } = await import('./index')
    platformMock.chatStream.mockImplementation(async function* () {
      yield { type: 'tool_call_start', call: { callId: 'c1', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'bloomai' } } }
      yield { type: 'tool_call_result', callId: 'c1', output: { results: [{ title: 'BloomAI', url: 'https://example.com', snippet: 'hello' }] }, durationMs: 12 }
      yield { type: 'tool_call_start', call: { callId: 'c2', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'oops' } } }
      yield { type: 'tool_call_error', callId: 'c2', error: 'boom' }
      yield { type: 'done', tokens: { input: 1, output: 2 } }
    })

    await useChatStore.getState().sendMessage('s1', 'hello')
    const state = useChatStore.getState()

    expect(state.toolCallsBySession.s1).toEqual([
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
    expect(state.tokenUsage.s1).toEqual({ input: 1, output: 2 })
  })

  it('clears streaming tool calls when a new message starts', async () => {
    const { useChatStore } = await import('./index')
    useChatStore.setState({
      toolCallsBySession: {
        s1: [
          { callId: 'old', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'old' } },
        ],
      },
    })
    platformMock.chatStream.mockImplementation(emptyStream)

    const sendPromise = useChatStore.getState().sendMessage('s1', 'next')
    expect(useChatStore.getState().toolCallsBySession.s1).toEqual([])
    await sendPromise
  })
})
