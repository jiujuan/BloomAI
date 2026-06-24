import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_AGENT_V1_ID, CHAT_AGENT_V1_NAME } from './constants'

const agentConstructor = vi.hoisted(() =>
  vi.fn(function MockAgent(this: { config?: unknown }, config: unknown) {
    this.config = config
  }),
)

vi.mock('@mastra/core/agent', () => ({
  Agent: agentConstructor,
}))

import { CHAT_AGENT_V1_INSTRUCTIONS, createChatAgent } from './chat-agent'

describe('createChatAgent', () => {
  beforeEach(() => {
    agentConstructor.mockClear()
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

  it('mounts the web_search placeholder tool and documents when it should be used', () => {
    createChatAgent('settings-selected-model')

    const config = agentConstructor.mock.calls[0][0] as {
      instructions: string
      tools: Record<string, { id: string; description: string }>
    }

    expect(config.instructions).toContain('Use web_search when')
    expect(config.tools.web_search).toMatchObject({
      id: 'web_search',
      description: expect.stringContaining('Search the web'),
    })
  })
})
