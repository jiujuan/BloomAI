import { Agent } from '@mastra/core/agent'
import { resolveMastraModel } from './model-resolver'
import { buildAgentTools } from './tools'

/**
 * Per-request values injected by server middleware (from headers/body) and read
 * by the agent's dynamic model/instructions. See docs/agent/002 §12.3.
 */
export type ChatRequestContext = {
  mode: 'chat' | 'plan' | 'deep'
  model: string
  sessionId: string
  /** Confirmed plan tasks (chat "plan" mode, after the user clicks 是). When present,
   *  the agent executes these numbered tasks instead of proposing a plan. */
  planTasks?: string[]
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

const DEEP_INSTRUCTIONS = `
${BASE_INSTRUCTIONS}

DEEP THINKING MODE: Reason carefully and thoroughly before answering.
Work through the problem step by step, consider edge cases and alternatives, verify your logic,
and gather evidence with tools when it strengthens the answer. Prefer correctness and depth over speed.
`.trim()

function instructionsFor(mode: ChatRequestContext['mode'] | undefined): string {
  if (mode === 'plan') return PLAN_INSTRUCTIONS
  if (mode === 'deep') return DEEP_INSTRUCTIONS
  return BASE_INSTRUCTIONS
}

// Plan EXECUTION mode: the user already reviewed and confirmed a task list in the UI,
// so skip proposing and just carry it out, organizing the answer by task number.
function planExecuteInstructions(tasks: string[]): string {
  const list = tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `
${BASE_INSTRUCTIONS}

PLAN EXECUTION MODE: The user has reviewed and confirmed the following numbered task plan.
Your entire response MUST carry out this exact plan for the user's original request — do not
drift to a different topic, do not re-propose or re-plan, and do not skip tasks.
Work through the tasks in order (calling tools such as web_search when a task needs external
info), then produce ONE cohesive answer with a section per task, each headed by its number.

Confirmed tasks:
${list}
`.trim()
}

/** Instructions from the request context: confirmed plan tasks win over mode. */
function resolveInstructions(requestContext: any): string {
  const tasks = requestContext?.get('planTasks') as string[] | undefined
  if (Array.isArray(tasks) && tasks.length) return planExecuteInstructions(tasks)
  return instructionsFor(requestContext?.get('mode') as ChatRequestContext['mode'] | undefined)
}

export const chatAgent = new Agent({
  id: 'chat',
  name: 'BloomAI Chat',
  instructions: ({ requestContext }) => resolveInstructions(requestContext),
  model: ({ requestContext }) =>
    resolveMastraModel(requestContext?.get('model') as string | undefined),
  // Every enabled tool + installed skill is mounted; the LLM chooses what to call.
  // Rebuilt per request so newly enabled tools / installed skills appear next turn.
  tools: ({ requestContext }) =>
    buildAgentTools(requestContext?.get('sessionId') as string | undefined),
})
