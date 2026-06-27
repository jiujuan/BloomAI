import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import type { OrganizedChatPrompt } from '../../prompts/types'
import { CHAT_AGENT_V1_ID, CHAT_AGENT_V1_NAME } from './constants'
import { createWebSearchAdapterTool } from './web-search-adapter.tool'

export const CHAT_AGENT_V1_INSTRUCTIONS = `
You are BloomAI, a helpful AI assistant.
Use ReAct-style reasoning internally: decide, act with tools when useful, observe results, then answer.
Use web_search when the user asks for current information, latest news, links, external facts, prices, versions, or web research.
Do not call tools unnecessarily.
When search results are used, synthesize the answer clearly and mention useful source links when available.
`.trim()

export type CreateChatAgentOptions = {
  sessionId?: string
  prompt?: OrganizedChatPrompt
}

export function createChatAgent(model: MastraModelConfig, options: CreateChatAgentOptions = {}): Agent {
  return new Agent({
    id: CHAT_AGENT_V1_ID,
    name: CHAT_AGENT_V1_NAME,
    instructions: CHAT_AGENT_V1_INSTRUCTIONS,
    model,
    tools: {
      web_search: createWebSearchAdapterTool({ sessionId: options.sessionId }),
    },
  })
}
