import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { CHAT_AGENT_V1_ID, CHAT_AGENT_V1_NAME } from './constants'

export const CHAT_AGENT_V1_INSTRUCTIONS = `
You are BloomAI, a helpful AI assistant.
Use ReAct-style reasoning internally: decide, act with tools when useful, observe results, then answer.
Use web_search when the user asks for current information, latest news, links, external facts, prices, versions, or web research.
Do not call tools unnecessarily.
When search results are used, synthesize the answer clearly and mention useful source links when available.
`.trim()

export const webSearchPlaceholderTool = createTool({
  id: 'web_search',
  description: 'Search the web and return relevant results with titles, URLs, and snippets.',
  execute: async () => {
    throw new Error('web_search Mastra tool is not wired yet; Task 3 will connect BloomAI executeTool.')
  },
})

export function createChatAgent(model: string): Agent {
  return new Agent({
    id: CHAT_AGENT_V1_ID,
    name: CHAT_AGENT_V1_NAME,
    instructions: CHAT_AGENT_V1_INSTRUCTIONS,
    model,
    tools: {
      web_search: webSearchPlaceholderTool,
    },
  })
}
