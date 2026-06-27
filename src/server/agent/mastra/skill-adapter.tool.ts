import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { skillRepo } from '../../db/repositories/skill.repo'
import { runSkill } from '../../skills/run-skill'
import type { JsonObject, SkillCapability } from '../runtime/intent/types'

// Keep skill-backed Mastra tools in a distinct namespace so they do not collide with built-in tools.
export function toSkillToolId(skillId: string): `skill:${string}` {
  return `skill:${skillId}`
}

export function fromSkillToolId(toolId: string): string | null {
  return toolId.startsWith('skill:') ? toolId.slice('skill:'.length) : null
}

export function createSkillInputSchema(skill: SkillCapability): z.ZodObject<Record<string, z.ZodTypeAny>> {
  return jsonSchemaToZodObject(skill.paramsSchema)
}

export function createSkillAdapterTool(skill: SkillCapability) {
  const inputSchema = createSkillInputSchema(skill)
  return createTool({
    id: toSkillToolId(skill.id),
    description: skill.description || `Run BloomAI skill ${skill.name}`,
    inputSchema,
    outputSchema: z.record(z.unknown()),
    execute: async (input) => {
      // Re-check capability and repository state at execution time because installed skills can change after intent routing.
      if (!skill.enabled) throw new Error(`Skill capability is disabled: ${skill.id}`)
      const parsed = inputSchema.parse(input)
      const installedSkill = skillRepo.get(skill.id)
      if (!installedSkill || installedSkill.is_installed !== 1) {
        throw new Error(`Skill is not installed: ${skill.id}`)
      }
      // Preserve object output so runtime traces and timeline summaries can inspect structured skill results.
      return z.record(z.unknown()).parse(await runSkill(skill.id, parsed))
    },
  })
}

export function createSkillAdapterTools(skills: SkillCapability[]): Record<string, ReturnType<typeof createSkillAdapterTool>> {
  const tools: Record<string, ReturnType<typeof createSkillAdapterTool>> = {}
  for (const skill of skills) {
    if (!skill.enabled) continue
    tools[toSkillToolId(skill.id)] = createSkillAdapterTool(skill)
  }
  return tools
}

function jsonSchemaToZodObject(schema: JsonObject): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (schema.type !== 'object' || !isRecord(schema.properties)) return z.object({})

  // Skills expose lightweight JSON Schemas; convert the supported subset into the Mastra tool input contract.
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [])
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    const fieldSchema = jsonSchemaToZodType(isRecord(propertySchema) ? propertySchema : {})
    shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional()
  }
  return z.object(shape)
}

function jsonSchemaToZodType(schema: Record<string, unknown>): z.ZodTypeAny {
  if (Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === 'string') && schema.enum.length > 0) {
    return z.enum(schema.enum as [string, ...string[]])
  }

  switch (schema.type) {
    case 'string':
      return z.string()
    case 'number':
    case 'integer':
      return schema.type === 'integer' ? z.number().int() : z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(jsonSchemaToZodType(isRecord(schema.items) ? schema.items : {}))
    case 'object':
      return jsonSchemaToZodObject(schema)
    default:
      return z.unknown()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}