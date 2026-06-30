import { Agent } from '@mastra/core/agent'
import { resolveMastraModel } from '../model-resolver'
import { buildToolsForRole } from '../tools'

/**
 * Specialist agent team (P6d). The chat UI tabs (研究/写作/编码) route a message to one
 * of these by id. Each gets a curated tool set: research = web tools, writing = none,
 * coding = file/shell/exec tools (dangerous ones require approval, see tools.ts).
 * Model resolves from RequestContext, same as the general chat agent.
 */

function dynamicModel({ requestContext }: any) {
  return resolveMastraModel(requestContext?.get('model') as string | undefined)
}

export const researchAgent = new Agent({
  id: 'research',
  name: 'BloomAI Research',
  instructions: `
You are a research specialist. Use the web tools (search/fetch/extract) to gather current,
factual information, then answer in clear paragraphs with inline source links. Prefer primary
sources. If you cannot verify something, say so.
`.trim(),
  model: dynamicModel,
  tools: ({ requestContext }) => buildToolsForRole('research', requestContext?.get('sessionId') as string | undefined),
})

export const writerAgent = new Agent({
  id: 'writer',
  name: 'BloomAI Writer',
  instructions: `
You are a writing specialist. Produce polished, well-structured prose tailored to the user's
intent (tone, length, audience). You have no tools — work from the conversation and the user's
material. Ask a brief clarifying question only when the request is ambiguous.
`.trim(),
  model: dynamicModel,
  tools: () => ({}),
})

export const coderAgent = new Agent({
  id: 'coder',
  name: 'BloomAI Coder',
  instructions: `
You are a coding specialist. You can read, search, and edit files and run commands to help with
software tasks. Read before you edit. Destructive or code-executing actions (writing/editing files,
running shell or code) require the user's approval before they run — explain what you intend to do.
If the user declines an action, do not attempt it again or work around it; stop and report.
`.trim(),
  model: dynamicModel,
  tools: ({ requestContext }) => buildToolsForRole('coding', requestContext?.get('sessionId') as string | undefined),
})

// Maps the x-bloom-agent header value (UI tab) to a registered agent id.
export const TEAM_AGENT_BY_TAB: Record<string, string> = {
  research: 'research',
  writing: 'writer',
  coding: 'coder',
}
