import type { OrganizedChatPrompt } from '../../prompts/types'
import type { LlmMessage } from '../../llm/types'
import { runChatAgentV1 } from '../mastra/chat-agent-runtime-adapter'
import type { ChatAgentRuntimeEvent } from '../mastra/types'

export type ChatAgentRouteEvent = ChatAgentRuntimeEvent

export const DEFAULT_CHAT_AGENT_ID = 'chat'

export type ChatAgentRoute = {
  id: typeof DEFAULT_CHAT_AGENT_ID
  runtime: 'mastra-chat-agent-v1'
}

export type ChatAgentPromptMessage = Omit<LlmMessage, 'role'> & { role: 'user' | 'assistant' }

export type OrganizedAgentPrompt = Omit<OrganizedChatPrompt, 'messages'> & {
  messages: ChatAgentPromptMessage[]
}

export type ChatAgentRouteInput = {
  sessionId: string
  agentId?: string
  content: string
  model: string
  maxSteps?: number
  prompt: OrganizedAgentPrompt
}

export function resolveChatAgentRoute(agentId: string = DEFAULT_CHAT_AGENT_ID): ChatAgentRoute | null {
  if (agentId === DEFAULT_CHAT_AGENT_ID) {
    return {
      id: DEFAULT_CHAT_AGENT_ID,
      runtime: 'mastra-chat-agent-v1',
    }
  }

  return null
}

export async function* streamChatAgentRoute(input: ChatAgentRouteInput): AsyncGenerator<ChatAgentRouteEvent> {
  const route = resolveChatAgentRoute(input.agentId)
  if (!route) {
    yield { type: 'error', error: `Chat agent "${input.agentId}" is not configured` }
    return
  }

  yield* runChatAgentV1({
    ...input,
    agentId: route.id,
  })
}
