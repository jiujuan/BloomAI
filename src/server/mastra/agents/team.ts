import { Agent } from '@mastra/core/agent'
import { resolveMastraModel } from '../model-resolver'
import { buildMcpToolSurface, type McpAgentToolSurfaceDependencies } from '../../mcp/agent-tool-surface'
import { buildToolsForRole } from '../tools'
import { buildWriterInstructions } from './writer-prompt'
import type { WritingConfig } from '@shared/writing'

/**
 * Specialist chat agent team (P6d). Writing and coding tabs route a message to these
 * agents by id; the Research tab uses the durable Deep Research workbench. Writing has no
 * built-in tools; coding receives curated file and shell tools whose mutating capabilities
 * require approval (see tools.ts). MCP tools are added from the confirmed local Catalog and
 * always use the fixed server-side role for the specialist being constructed.
 * Model resolves from RequestContext, same as the general chat agent.
 */

export type SpecialistAgentDependencies = {
  readonly mcpToolSurface?: McpAgentToolSurfaceDependencies
}

function dynamicModel({ requestContext }: any) {
  return resolveMastraModel(requestContext?.get('model') as string | undefined)
}

function mergeMcpTools(
  sessionId: string | undefined,
  role: 'writing' | 'coding',
  builtinTools: Record<string, any>,
  dependencies: SpecialistAgentDependencies,
): Record<string, any> {
  if (!dependencies.mcpToolSurface) return builtinTools
  const mcpTools = buildMcpToolSurface(sessionId ?? '', role, {
    ...dependencies.mcpToolSurface,
    builtinToolIds: new Set(Object.keys(builtinTools)),
  })
  return { ...builtinTools, ...mcpTools }
}

export function createWriterAgent(dependencies: SpecialistAgentDependencies = {}) {
  return new Agent({
    id: 'writer',
    name: 'BloomAI Writer',
    // Instructions are built from the UI's typed writing parameters (type/platform/style/words)
    // carried on the RequestContext. Falls back to a generic writer prompt when none are supplied.
    instructions: ({ requestContext }) =>
      buildWriterInstructions(requestContext?.get('writing') as WritingConfig | undefined),
    model: dynamicModel,
    // Writing has no BloomAI built-in tools, but its MCP surface is still fixed to `writing`.
    tools: ({ requestContext }) => mergeMcpTools(
      requestContext?.get('sessionId') as string | undefined,
      'writing',
      {},
      dependencies,
    ),
  })
}

export function createCoderAgent(dependencies: SpecialistAgentDependencies = {}) {
  return new Agent({
    id: 'coder',
    name: 'BloomAI Coder',
    instructions: `
You are a coding specialist. You can read, search, and edit files and run commands to help with
software tasks. Read before you edit. Destructive or code-executing actions (writing/editing files,
running shell or code) require the user's approval before they run — explain what you intend to do.
If the user declines an action, do not attempt it again or work around it; stop and report.
`.trim(),
    model: dynamicModel,
    tools: ({ requestContext }) => {
      const sessionId = requestContext?.get('sessionId') as string | undefined
      const builtinTools = buildToolsForRole('coding', sessionId)
      return mergeMcpTools(sessionId, 'coding', builtinTools, dependencies)
    },
  })
}

export const writerAgent = createWriterAgent()
export const coderAgent = createCoderAgent()

// Maps the x-bloom-agent header value (UI tab) to a registered agent id.
export const TEAM_AGENT_BY_TAB: Record<string, string> = {
  writing: 'writer',
  coding: 'coder',
}
