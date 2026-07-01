import { Agent } from '@mastra/core/agent'
import { resolveMastraModel } from './model-resolver'

/**
 * Planner agent for chat "plan" mode: turns the user's request into a short list
 * of concrete, actionable tasks the assistant will execute after the user confirms.
 * No tools; model from RequestContext (matches chat). Responds with ONLY a JSON
 * array of strings so the caller can parse it deterministically.
 */
export const planAgent = new Agent({
  id: 'plan-planner',
  name: 'BloomAI Plan Planner',
  instructions: `
You break a user's request into 3-5 concrete, actionable, non-overlapping tasks (at most 10) that together fully address it.
Each task is a short imperative phrase in the same language as the request (Chinese if the request is Chinese).
Order the tasks so they can be executed in sequence.
Respond with ONLY a JSON array of strings (e.g. ["...","...","..."]) and nothing else — no prose, no numbering, no code fences.
`.trim(),
  model: ({ requestContext }) => resolveMastraModel(requestContext?.get('model') as string | undefined),
})
