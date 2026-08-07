import { createTool } from '@mastra/core/tools'
import { toolRepo } from '../db/repositories/tool.repo'
import { executeLegacyToolCapability, needsInteractiveApprovalForTool } from '../skills/policy/capability-broker'
import { jsonSchemaToZodObject, parseParamsSchema } from './json-schema'
import { isToolAvailable } from '../tools/availability'
import { getToolContract } from '../tools/contracts'

type MastraTool = ReturnType<typeof createTool>

// Tool permission levels (tools.requires_permission) that must be explicitly granted
// before the autonomous agent may run them. network/fs (read) run freely; write/shell/
// sandbox (mutating or code-exec) require a granted tool_permissions row.
const GATED_PERMISSION_LEVELS = new Set(['write', 'shell', 'sandbox'])

export type LegacySkillMigrationHint = {
  runtimeKind: 'legacy'
  readOnly: true
  migrationAction: 'preview'
  reference: string
  message: string
}

/** Structured response for a model that asks to use a Legacy reference. */
export function getLegacySkillMigrationHint(reference: string): LegacySkillMigrationHint {
  return {
    runtimeKind: 'legacy',
    readOnly: true,
    migrationAction: 'preview',
    reference,
    message: 'Legacy Skills are read-only. Inspect the migration preview or historical runs instead of executing the Legacy Skill.',
  }
}

/**
 * Builds the Mastra tool surface for the chat agent from BloomAI's own registries �?
 * every enabled built-in tool plus every installed skill. The LLM decides which to
 * call (ReAct loop); there is no separate intent-routing layer. Tools are rebuilt per
 * request so enabling a tool / installing a skill takes effect on the next turn.
 *
 * Tools are offered only when enabled; CapabilityBroker re-checks enablement,
 * authorization, approval and timeout policy at call time.
 */
export function buildAgentTools(sessionId?: string): Record<string, MastraTool> {
  return buildBuiltinTools(sessionId)
}

// Curated built-in tool sets per specialist agent (P6d). `null` = all enabled tools.
export const ROLE_TOOL_IDS: Record<string, string[] | null> = {
  writing: [],
  coding: ['fs_read', 'fs_stat', 'workspace_search', 'fs_grep', 'fs_glob', 'fs_write', 'fs_edit', 'fs_apply_patch', 'bash', 'shell', 'node_runner', 'python_runner', 'doc_markdown', 'doc_pdf', 'doc_txt', 'doc_csv', 'doc_docx'],
}

export type BuildToolsOptions = {
  filter?: (toolId: string) => boolean
  // Tool permission levels that should require interactive approval (P6d-2) instead of
  // the soft permission gate. When a tool's level is here, requireApproval is set and the
  // soft gate is skipped.
  approvalLevels?: Set<string>
}

/**
 * Builds the tool surface for a specialist agent role. `chat` gets every enabled tool
 * plus skills; writing/coding get a curated allowlist (writing gets none).
 */
export function buildToolsForRole(role: string, sessionId?: string): Record<string, MastraTool> {
  const allow = ROLE_TOOL_IDS[role]
  if (allow === undefined || allow === null) return buildAgentTools(sessionId)
  if (allow.length === 0) return {}
  const allowSet = new Set(allow)
  const options: BuildToolsOptions = { filter: (id) => allowSet.has(id) }
  // Coding agent: mutating/code-exec tools require interactive user approval (P6d-2).
  if (role === 'coding') options.approvalLevels = GATED_PERMISSION_LEVELS
  return buildBuiltinTools(sessionId, options)
}

export function buildBuiltinTools(sessionId?: string, options: BuildToolsOptions = {}): Record<string, MastraTool> {
  const tools: Record<string, MastraTool> = {}
  for (const tool of toolRepo.list()) {
    if (tool.is_enabled !== 1) continue
    if (!isToolAvailable(tool.id)) continue
    if (options.filter && !options.filter(tool.id)) continue
    const contract = getToolContract(tool.id)
    const needsApproval = needsInteractiveApprovalForTool(tool) && !!options.approvalLevels?.has(tool.requires_permission!)
    tools[tool.id] = createTool({
      id: tool.id,
      description: contract?.description || tool.description || `Run BloomAI tool ${tool.name}`,
      inputSchema: contract?.inputSchema ?? jsonSchemaToZodObject(parseParamsSchema(tool.params_schema)),
      ...(contract ? { outputSchema: contract.outputSchema } : {}),
      ...(needsApproval ? { requireApproval: true } : {}),
      execute: async (input) => {
        const result = await executeLegacyToolCapability({
          caller: 'chat',
          toolId: tool.id,
          input: (input ?? {}) as Record<string, unknown>,
          sessionId,
        })
        return result.output
      },
    })
  }
  return tools
}

/**
 * Legacy Skills intentionally expose no synchronous Mastra tools. Keep this
 * compatibility function as an empty surface for callers that have not yet
 * removed the old optional hook; callers should use getLegacySkillMigrationHint.
 */
export function buildLegacySkillTools(_sessionId?: string): Record<string, MastraTool> {
  return {}
}

/** Backward-compatible empty alias; no Legacy Skill tools are registered. */
export const buildSkillTools = buildLegacySkillTools
