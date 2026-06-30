import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { toolRepo } from '../db/repositories/tool.repo'
import { skillRepo } from '../db/repositories/skill.repo'
import { executeTool } from '../tools/execute-tool'
import { runSkill } from '../skills/run-skill'
import { jsonSchemaToZodObject, parseParamsSchema } from './json-schema'

type MastraTool = ReturnType<typeof createTool>

// Tool permission levels (tools.requires_permission) that must be explicitly granted
// before the autonomous agent may run them. network/fs (read) run freely; write/shell/
// sandbox (mutating or code-exec) require a granted tool_permissions row.
const GATED_PERMISSION_LEVELS = new Set(['write', 'shell', 'sandbox'])

// Skill-backed tools live in a distinct namespace so they never collide with built-in tool ids.
export function toSkillToolId(skillId: string): string {
  return `skill_${skillId}`
}

/**
 * Builds the Mastra tool surface for the chat agent from BloomAI's own registries —
 * every enabled built-in tool plus every installed skill. The LLM decides which to
 * call (ReAct loop); there is no separate intent-routing layer. Tools are rebuilt per
 * request so enabling a tool / installing a skill takes effect on the next turn.
 *
 * Enablement is the gate: disabled tools are not offered, and executeTool re-checks
 * `is_enabled` at call time.
 */
export function buildAgentTools(sessionId?: string): Record<string, MastraTool> {
  return { ...buildBuiltinTools(sessionId), ...buildSkillTools(sessionId) }
}

// Curated built-in tool sets per specialist agent (P6d). `null` = all enabled tools.
export const ROLE_TOOL_IDS: Record<string, string[] | null> = {
  research: ['web_search', 'web_fetch', 'web_extract', 'web_screenshot'],
  writing: [],
  coding: ['fs_read', 'fs_grep', 'fs_glob', 'fs_write', 'fs_edit', 'bash', 'shell', 'node_runner', 'python_runner', 'doc_markdown', 'doc_pdf', 'doc_txt', 'doc_csv', 'doc_docx'],
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
 * plus skills; research/writing/coding get a curated allowlist (writing gets none).
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
    if (options.filter && !options.filter(tool.id)) continue
    const needsApproval = !!(tool.requires_permission && options.approvalLevels?.has(tool.requires_permission))
    tools[tool.id] = createTool({
      id: tool.id,
      description: tool.description || `Run BloomAI tool ${tool.name}`,
      inputSchema: jsonSchemaToZodObject(parseParamsSchema(tool.params_schema)),
      ...(needsApproval ? { requireApproval: true } : {}),
      execute: async (input) => {
        // Approval-gated tools rely on interactive approval; others use the soft permission gate.
        if (!needsApproval) {
          const denial = checkToolPermission(tool.id, tool.requires_permission)
          if (denial) return denial
        }
        return executeTool(tool.id, (input ?? {}) as object, sessionId)
      },
    })
  }
  return tools
}

// Gate mutating / code-exec tools behind the existing tool_permissions grant. Returns a
// soft-error result (not a throw) when denied so the agent relays it to the user instead
// of silently running, or hard-failing the turn.
function checkToolPermission(toolId: string, level: string | null): { error: string; permissionRequired: true; level: string } | null {
  if (!level || !GATED_PERMISSION_LEVELS.has(level)) return null
  if (toolRepo.getPermission(toolId)?.granted === 1) return null
  return {
    error: `Permission required: "${toolId}" needs "${level}" access, which the user has not granted. Ask the user to grant it in Tools settings before retrying — do not assume it succeeded.`,
    permissionRequired: true,
    level,
  }
}

export function buildSkillTools(sessionId?: string): Record<string, MastraTool> {
  const tools: Record<string, MastraTool> = {}
  for (const skill of skillRepo.listInstalled()) {
    const inputSchema = jsonSchemaToZodObject(parseParamsSchema(skill.params_schema))
    tools[toSkillToolId(skill.id)] = createTool({
      id: toSkillToolId(skill.id),
      description: skill.description || `Run BloomAI skill ${skill.name}`,
      inputSchema,
      outputSchema: z.record(z.unknown()),
      execute: async (input) => {
        // Re-check install state at call time: installed skills can change between turns.
        const installed = skillRepo.get(skill.id)
        if (!installed || installed.is_installed !== 1) throw new Error(`Skill is not installed: ${skill.id}`)
        return z.record(z.unknown()).parse(await runSkill(skill.id, inputSchema.parse(input ?? {})))
      },
    })
  }
  return tools
}
