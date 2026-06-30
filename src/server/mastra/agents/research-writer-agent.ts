import { Agent } from '@mastra/core/agent'
import { resolveMastraModel } from '../model-resolver'

/**
 * Writer agent used as the final step of the deep-research workflow. No tools —
 * sources are already gathered by an earlier step; this agent only synthesizes.
 * Model resolves from the workflow's RequestContext (same x-bloom-model as chat).
 */
export const researchWriterAgent = new Agent({
  id: 'research-writer',
  name: 'BloomAI Research Writer',
  instructions: `
You are a research writer. You are given a question and a set of web search results.
Write a thorough, well-structured answer in full paragraphs (not bullet points).
Cite sources inline as markdown links using the provided URLs.
Do not invent facts beyond the sources; if the sources are insufficient, say so explicitly.
`.trim(),
  model: ({ requestContext }) => resolveMastraModel(requestContext?.get('model') as string | undefined),
})
