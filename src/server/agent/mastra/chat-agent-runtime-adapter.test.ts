import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_MAX_STEPS } from './constants'
import { runChatAgentV1 } from './chat-agent-runtime-adapter'

const createChatAgentMock = vi.hoisted(() => vi.fn())

vi.mock('./chat-agent', () => ({
  createChatAgent: createChatAgentMock,
}))

describe('Mastra chat agent runtime adapter skeleton', () => {
  beforeEach(() => {
    createChatAgentMock.mockClear()
  })

  it('defines a max step default of 10', () => {
    expect(DEFAULT_AGENT_MAX_STEPS).toBe(10)
  })

  it('injects the session id when creating the Mastra chat agent', async () => {
    for await (const _event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      model: 'openai/gpt-4o',
    })) {
      // consume stream
    }

    expect(createChatAgentMock).toHaveBeenCalledWith('openai/gpt-4o', { sessionId: 'session-1' })
  })

  it('returns a testable async event stream with a done trace', async () => {
    const events = []
    for await (const event of runChatAgentV1({
      sessionId: 'session-1',
      content: 'hello',
      model: 'openai/gpt-4o',
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        type: 'done',
        trace: {
          runtime: 'mastra-chat-agent-v1',
          maxSteps: 10,
          toolCalls: [],
        },
      },
    ])
  })
})
