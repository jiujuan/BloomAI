import { CHAT_AGENT_V1_ID, CHAT_AGENT_V1_NAME } from './constants'
import type { ChatAgentDescriptor } from './types'

export const CHAT_AGENT_V1_INSTRUCTIONS = `
You are BloomAI, a helpful AI assistant.
Use ReAct-style reasoning internally: decide, act with tools when useful, observe results, then answer.
Use web_search when the user asks for current information, latest news, links, external facts, prices, versions, or web research.
Do not call tools unnecessarily.
When search results are used, synthesize the answer clearly and mention useful source links when available.
`.trim()

export function createChatAgent(model: string): ChatAgentDescriptor {
  return {
    id: CHAT_AGENT_V1_ID,
    name: CHAT_AGENT_V1_NAME,
    instructions: CHAT_AGENT_V1_INSTRUCTIONS,
    model,
    tools: {
      web_search: {
        id: 'web_search',
        description: 'Search the web and return relevant results with titles, URLs, and snippets.',
      },
    },
  }
}
