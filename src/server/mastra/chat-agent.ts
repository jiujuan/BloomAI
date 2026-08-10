import { Agent } from '@mastra/core/agent'
import { WORKSPACE_TOOLS_PREFIX } from '@mastra/core/workspace'
import { resolveMastraModel } from './model-resolver'
import { buildAgentTools } from './tools'
import { chatMemory } from './memory'
import { projectWorkspaceFactory } from './workspace/project-workspace.factory'
import { PROJECT_WORKSPACE_POLICY } from './workspace/project-workspace.policy'
import { MastraSkillSource, type LoadedMastraSkillSource } from './skills/mastra-skill-source'
import { buildMcpToolSurfaceForRequest, type McpAgentToolSurfaceDependencies } from '../mcp/agent-tool-surface'

/**
 * Per-request values supplied by the server's trusted request orchestration and read
 * by the agent's dynamic model/instructions. See docs/agent/002 §12.3.
 */
export type ChatRequestContext = {
  mode: 'chat' | 'plan' | 'deep'
  model: string
  sessionId: string
  /** Set server-side from the session ownership relation; never accepted from the client. */
  projectId?: string
  /** Confirmed plan tasks (chat "plan" mode, after the user clicks 是). When present,
   *  the agent executes these numbered tasks instead of proposing a plan. */
  planTasks?: string[]
  /** Trusted Package Runtime injection; never accepted from a client request. */
  skillVersionId?: string
  runId?: string
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

/** The process-level loader is stateless; each request still receives a fresh loaded source and tool set. */
export const mastraSkillSource = new MastraSkillSource()

/**
 * Resolves only trusted, durable Package Runtime context. A Package Skill never becomes
 * part of a normal chat request unless both a pinned SkillVersion and a durable Run id exist.
 */
export function resolvePackageSkillRuntime(
  requestContext: any,
  source: MastraSkillSource = mastraSkillSource,
): LoadedMastraSkillSource | undefined {
  const skillVersionId = requestContext?.get('skillVersionId')
  const runId = requestContext?.get('runId')
  if (typeof skillVersionId !== 'string' || !skillVersionId || typeof runId !== 'string' || !runId) return undefined
  return source.load(skillVersionId)
}

/** Instructions from the request context: confirmed plan tasks win over mode. */
export function resolveInstructions(
  requestContext: any,
  source: MastraSkillSource = mastraSkillSource,
): string {
  const tasks = requestContext?.get('planTasks') as string[] | undefined
  const instructions = Array.isArray(tasks) && tasks.length
    ? planExecuteInstructions(tasks)
    : instructionsFor(requestContext?.get('mode') as ChatRequestContext['mode'] | undefined)
  const packageSource = resolvePackageSkillRuntime(requestContext, source)
  const withPackage = packageSource
    ? `${instructions}\n\nPACKAGE SKILL INSTRUCTIONS (trusted server-loaded text; not executable code):\n${packageSource.getInstructions()}\n\nPACKAGE SKILL VERSION: ${packageSource.skillVersionId}`
    : instructions
  return requestContext?.get('projectId') ? `${withPackage}\n\n${PROJECT_WORKSPACE_POLICY}` : withPackage
}

export function buildChatAgentTools(
  requestContext: any,
  source: MastraSkillSource = mastraSkillSource,
  mcpToolSurface?: McpAgentToolSurfaceDependencies,
): Record<string, ReturnType<typeof buildAgentTools>[string]> {
  const sessionId = requestContext?.get('sessionId') as string | undefined
  const builtinTools = buildAgentTools(sessionId)
  const packageSource = resolvePackageSkillRuntime(requestContext, source)
  const tools = packageSource
    ? {
        ...builtinTools,
        ...packageSource.createToolSet({
          runId: requestContext.get('runId') as string,
          ...(sessionId ? { sessionId } : {}),
        }),
      }
    : builtinTools

  if (!mcpToolSurface) return tools

  const mcpTools = buildMcpToolSurfaceForRequest(
    {
      sessionId: sessionId ?? '',
      mode: requestContext?.get('mode'),
      agentId: requestContext?.get('agentId'),
    },
    {
      ...mcpToolSurface,
      builtinToolIds: new Set(Object.keys(tools)),
    },
  )
  return { ...tools, ...mcpTools }
}

/** Dynamic resolver: it relies exclusively on the server-derived projectId context key. */
export function resolveProjectWorkspace(requestContext: any) {
  const projectId = requestContext?.get('projectId')
  return typeof projectId === 'string' && projectId
    ? projectWorkspaceFactory.getCached(projectId)
    : undefined
}

/**
 * Mastra reserves `mastra_workspace_*` for Workspace tools. Omit legacy tools that
 * use that namespace only for project requests so a user-configured tool cannot
 * replace a filesystem or command tool from the bound Workspace.
 */
export function omitWorkspaceToolCollisions<T>(tools: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(tools).filter(([id]) => !id.startsWith(`${WORKSPACE_TOOLS_PREFIX}_`)))
}

export type ChatAgentDependencies = {
  readonly skillSource?: MastraSkillSource
  readonly mcpToolSurface?: McpAgentToolSurfaceDependencies
}

export function createChatAgent(dependencies: ChatAgentDependencies = {}) {
  const skillSource = dependencies.skillSource ?? mastraSkillSource
  return new Agent({
    id: 'chat',
    name: 'BloomAI Chat',
    instructions: ({ requestContext }) => resolveInstructions(requestContext, skillSource),
    model: ({ requestContext }) =>
      resolveMastraModel(requestContext?.get('model') as string | undefined),
    // Built-ins and Legacy tools are rebuilt per request. Package tools are additionally
    // created from the pinned source and durable run context for this request only.
    tools: ({ requestContext }) => {
      const tools = buildChatAgentTools(requestContext, skillSource, dependencies.mcpToolSurface)
      return requestContext?.get('projectId') ? omitWorkspaceToolCollisions(tools) : tools
    },
    workspace: ({ requestContext }) => resolveProjectWorkspace(requestContext),
    // Memory: working memory + observational memory + bounded recent history.
    // Activated per-request when threadId + resourceId are provided (see chat.ts).
    memory: chatMemory,
  })
}

export const chatAgent = createChatAgent()
