import { skillRepo } from '../../db/repositories/skill.repo'
import type { Skill } from '../../db/repositories/skill.repo'
import type { JsonObject, SkillCapability, ToolCapability } from './intent/types'

export type ChatCapabilities = {
  tools: ToolCapability[]
  skills: SkillCapability[]
}

const WEB_SEARCH_PARAMS_SCHEMA: JsonObject = {
  type: 'object',
  properties: {
    query: { type: 'string' },
  },
  required: ['query'],
}

export function listChatToolCapabilities(): ToolCapability[] {
  return [
    {
      kind: 'tool',
      id: 'web_search',
      name: 'Web search',
      description: 'Search the web for current information, links, external facts, prices, versions, or web research.',
      enabled: true,
      paramsSchema: WEB_SEARCH_PARAMS_SCHEMA,
    },
  ]
}

export function listChatSkillCapabilities(): SkillCapability[] {
  return skillRepo.listInstalled().map(skillToCapability)
}

export function resolveChatCapabilities(): ChatCapabilities {
  return {
    tools: listChatToolCapabilities(),
    skills: listChatSkillCapabilities(),
  }
}

function skillToCapability(skill: Skill): SkillCapability {
  const parsed = parseParamsSchema(skill.params_schema)
  return {
    kind: 'skill',
    id: skill.id,
    name: skill.name,
    description: skill.description,
    type: skill.type,
    enabled: parsed.ok,
    paramsSchema: parsed.ok ? parsed.schema : {},
    disabledReason: parsed.ok ? undefined : parsed.error,
  }
}

function parseParamsSchema(raw: string): { ok: true; schema: JsonObject } | { ok: false; error: string } {
  try {
    const value = JSON.parse(raw || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Invalid params_schema: expected JSON object' }
    }
    return { ok: true, schema: value as JsonObject }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse error'
    return { ok: false, error: `Invalid params_schema: ${message}` }
  }
}
