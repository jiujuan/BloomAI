import { Agent } from '@mastra/core/agent'
import { createWebSearchAdapterTool } from '../agent/mastra/web-search-adapter.tool'
import { resolveMastraModel } from './model-resolver'

/**
 * Per-request values injected by server middleware (from headers/body) and read
 * by the agent's dynamic model/instructions. See docs/agent/002 §12.3.
 */
export type ChatRequestContext = {
  mode: 'chat' | 'plan' | 'deep'
  model: string
  sessionId: string
}

const BASE_INSTRUCTIONS = `
You are BloomAI, a helpful AI assistant.
Use ReAct-style reasoning internally: decide, act with tools when useful, observe results, then answer.
Use web_search when the user asks for current information, latest news, links, external facts, prices, or web research.
Do not call tools unnecessarily.
When search results are used, synthesize the answer clearly and mention useful source links when available.
`.trim()

const PLAN_INSTRUCTIONS = `
${BASE_INSTRUCTIONS}

PLAN MODE: Before doing the work, first lay out a short numbered plan of the steps you will take.
Then execute the plan, calling tools as needed, and finish with the result.
`.trim()

function instructionsFor(mode: ChatRequestContext['mode'] | undefined): string {
  return mode === 'plan' ? PLAN_INSTRUCTIONS : BASE_INSTRUCTIONS
}

export const chatAgent = new Agent({
  id: 'chat',
  name: 'BloomAI Chat',
  instructions: ({ requestContext }) =>
    instructionsFor(requestContext?.get('mode') as ChatRequestContext['mode'] | undefined),
  model: ({ requestContext }) =>
    resolveMastraModel(requestContext?.get('model') as string | undefined),
  tools: { web_search: createWebSearchAdapterTool() },
})
