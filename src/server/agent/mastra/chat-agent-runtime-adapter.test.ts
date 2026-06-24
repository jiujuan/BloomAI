import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_MAX_STEPS } from './constants'
import { createChatAgent } from './chat-agent'
import { runChatAgentV1 } from './chat-agent-runtime-adapter'

describe('Mastra chat agent runtime adapter skeleton', () => {
  it('defines a max step default of 10', () => {
    expect(DEFAULT_AGENT_MAX_STEPS).toBe(10)
  })

  it('creates a chat agent descriptor with the provided model', () => {
    expect(createChatAgent('openai/gpt-4o')).toMatchObject({
      id: 'bloomai-chat-agent-v1',
      name: 'BloomAI Chat Agent v1',
      model: 'openai/gpt-4o',
      tools: { web_search: { id: 'web_search' } },
    })
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

