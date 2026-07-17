import { Agent } from '@mastra/core/agent'
import { resolveMastraModel } from '../model-resolver'
import { buildToolsForRole } from '../tools'
import { buildWriterInstructions } from './writer-prompt'
import type { WritingConfig } from '@shared/writing'

/**
 * Specialist chat agent team (P6d). Writing and coding tabs route a message to these
 * agents by id; the Research tab uses the durable Deep Research workbench. Writing has no
 * tools; coding receives curated file and shell tools
 * whose mutating capabilities require approval (see tools.ts).
 * Model resolves from RequestContext, same as the general chat agent.
 */

function dynamicModel({ requestContext }: any) {
  return resolveMastraModel(requestContext?.get('model') as string | undefined)
}

export const writerAgent = new Agent({
  id: 'writer',
  name: 'BloomAI Writer',
  // Instructions are built from the UI's typed writing parameters (type/platform/style/words)
  // carried on the RequestContext. Falls back to a generic writer prompt when none are supplied.
  instructions: ({ requestContext }) =>
    buildWriterInstructions(requestContext?.get('writing') as WritingConfig | undefined),
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
  writing: 'writer',
  coding: 'coder',
}
