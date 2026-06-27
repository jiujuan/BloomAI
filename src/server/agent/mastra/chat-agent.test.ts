import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_AGENT_V1_ID, CHAT_AGENT_V1_NAME } from './constants'

const agentConstructor = vi.hoisted(() =>
  vi.fn(function MockAgent(this: { config?: unknown }, config: unknown) {
    this.config = config
  }),
)
const createWebSearchToolMock = vi.hoisted(() => vi.fn((options: { sessionId?: string }) => ({
  id: 'web_search',
  description: `Search the web for ${options.sessionId ?? 'unknown session'}`,
})))

vi.mock('@mastra/core/agent', () => ({
  Agent: agentConstructor,
}))

vi.mock('./web-search-adapter.tool', () => ({
  createWebSearchAdapterTool: createWebSearchToolMock,
}))

import { CHAT_AGENT_V1_INSTRUCTIONS, createChatAgent } from './chat-agent'

describe('createChatAgent', () => {
  beforeEach(() => {
    agentConstructor.mockClear()
    createWebSearchToolMock.mockClear()
  })

  it('creates a Mastra Agent with the runtime model argument', () => {
    createChatAgent('settings-selected-model')

    expect(agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CHAT_AGENT_V1_ID,
        name: CHAT_AGENT_V1_NAME,
        instructions: CHAT_AGENT_V1_INSTRUCTIONS,
        model: 'settings-selected-model',
      }),
    )
  })

  it('mounts the BloomAI web_search tool with the injected session id when selected', () => {
    createChatAgent('settings-selected-model', { sessionId: 'session-1', selectedTools: ['web_search'] })

    const config = agentConstructor.mock.calls[0][0] as {
      instructions: string
      tools: Record<string, { id: string; description: string }>
    }

    expect(createWebSearchToolMock).toHaveBeenCalledWith({ sessionId: 'session-1' })
    expect(config.instructions).toContain('Use web_search when')
    expect(config.tools.web_search).toMatchObject({
      id: 'web_search',
      description: expect.stringContaining('Search the web'),
    })
  })

  it('does not mount tools for answer-only intent', () => {
    createChatAgent('settings-selected-model', { sessionId: 'session-1', selectedTools: [] })

    const config = agentConstructor.mock.calls[0][0] as { tools: Record<string, unknown> }
    expect(createWebSearchToolMock).not.toHaveBeenCalled()
    expect(config.tools).toEqual({})
  })

  it('accepts organized prompt metadata in creation options without changing default instructions', () => {
    const prompt = {
      system: 'Persona prompt',
      messages: [{ role: 'user' as const, content: 'Hello' }],
      maxTokens: 4096,
    }

    createChatAgent('settings-selected-model', { sessionId: 'session-1', prompt })

    const config = agentConstructor.mock.calls[0][0] as { instructions: string }
    expect(config.instructions).toBe(CHAT_AGENT_V1_INSTRUCTIONS)
  })
})
