import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizedChatPrompt } from '../../prompts/types'

const runChatAgentV1Mock = vi.hoisted(() => vi.fn())

vi.mock('../mastra/chat-agent-runtime-adapter', () => ({
  runChatAgentV1: runChatAgentV1Mock,
}))

async function collect<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = []
  for await (const event of source) events.push(event)
  return events
}

async function* events(items: any[]): AsyncGenerator<any> {
  for (const item of items) yield item
}

function createPrompt(): OrganizedChatPrompt {
  return {
    system: 'You are BloomAI.\n\n---\nActive app: Editor\nClipboard:\nimportant snippet',
    messages: [
      { role: 'user', content: 'What did I ask earlier?' },
      { role: 'assistant', content: 'You asked about agents.' },
      { role: 'user', content: 'Summarize it again.' },
    ],
    maxTokens: 4096,
  }
}

describe('chat agent runtime router', () => {
  beforeEach(() => {
    runChatAgentV1Mock.mockReset()
  })

  it('routes the default chat request to the Mastra chat agent and preserves prompt context', async () => {
    const prompt = createPrompt()
    runChatAgentV1Mock.mockReturnValue(events([{ type: 'delta', text: 'Hello' }]))
    const { DEFAULT_CHAT_AGENT_ID, resolveChatAgentRoute, streamChatAgentRoute } = await import('./chat-agent-router')

    expect(DEFAULT_CHAT_AGENT_ID).toBe('chat')
    expect(resolveChatAgentRoute()).toEqual({
      id: 'chat',
      runtime: 'mastra-chat-agent-v1',
    })

    const output = await collect(streamChatAgentRoute({
      sessionId: 'session-1',
      content: 'Summarize it again.',
      model: 'gpt-4o',
      maxSteps: 7,
      prompt,
    }))

    expect(output).toEqual([{ type: 'delta', text: 'Hello' }])
    expect(runChatAgentV1Mock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      content: 'Summarize it again.',
      model: 'gpt-4o',
      maxSteps: 7,
      prompt,
      agentId: 'chat',
    })
  })

  it('routes an explicit chat agent id to the current Mastra chat agent', async () => {
    runChatAgentV1Mock.mockReturnValue(events([{ type: 'done', trace: { runtime: 'mastra-chat-agent-v1', maxSteps: 10, toolCalls: [] } }]))
    const { resolveChatAgentRoute, streamChatAgentRoute } = await import('./chat-agent-router')

    expect(resolveChatAgentRoute('chat')).toEqual({
      id: 'chat',
      runtime: 'mastra-chat-agent-v1',
    })

    const output = await collect(streamChatAgentRoute({
      agentId: 'chat',
      sessionId: 'session-1',
      content: 'hello',
      model: 'gpt-4o',
      prompt: createPrompt(),
    }))

    expect(output).toEqual([{ type: 'done', trace: { runtime: 'mastra-chat-agent-v1', maxSteps: 10, toolCalls: [] } }])
    expect(runChatAgentV1Mock).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'chat' }))
  })

  it('returns an agent runtime error event for unsupported agent ids', async () => {
    const { resolveChatAgentRoute, streamChatAgentRoute } = await import('./chat-agent-router')

    expect(resolveChatAgentRoute('research')).toBeNull()

    const output = await collect(streamChatAgentRoute({
      agentId: 'research',
      sessionId: 'session-1',
      content: 'hello',
      model: 'gpt-4o',
      prompt: createPrompt(),
    }))

    expect(output).toEqual([{ type: 'error', error: 'Chat agent "research" is not configured' }])
    expect(runChatAgentV1Mock).not.toHaveBeenCalled()
  })
})
