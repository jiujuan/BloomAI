import { Agent } from '@mastra/core/agent'
import { resolveMastraModel } from '../model-resolver'

/**
 * Planner agent for the deep-research workflow: decomposes the user's question
 * into a few focused web-search sub-questions. No tools; model from RequestContext.
 */
export const researchPlannerAgent = new Agent({
  id: 'research-planner',
  name: 'BloomAI Research Planner',
  instructions: `
You break a research question into 2-3 focused, distinct web-search sub-questions that together cover the topic.
Respond with ONLY a JSON array of strings (e.g. ["...","...","..."]) and nothing else.
`.trim(),
  model: ({ requestContext }) => resolveMastraModel(requestContext?.get('model') as string | undefined),
})
