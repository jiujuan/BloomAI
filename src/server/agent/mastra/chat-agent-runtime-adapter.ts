import { DEFAULT_AGENT_MAX_STEPS, MASTRA_CHAT_AGENT_V1_RUNTIME } from './constants'
import { createChatAgent } from './chat-agent'
import type { ChatAgentRunInput, ChatAgentRuntimeEvent } from './types'

export async function* runChatAgentV1(input: ChatAgentRunInput): AsyncGenerator<ChatAgentRuntimeEvent> {
  createChatAgent(input.model)
  const maxSteps = Math.min(input.maxSteps ?? DEFAULT_AGENT_MAX_STEPS, DEFAULT_AGENT_MAX_STEPS)

  yield {
    type: 'done',
    trace: {
      runtime: MASTRA_CHAT_AGENT_V1_RUNTIME,
      maxSteps,
      toolCalls: [],
    },
  }
}
