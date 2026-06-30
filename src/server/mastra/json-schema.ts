import { z } from 'zod'

type JsonObject = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Converts a BloomAI params schema into a Mastra tool input schema (zod).
 *
 * Two shapes are accepted:
 *  - Wrapped JSON Schema:  { type: 'object', properties: {...}, required: [...] }  (skills)
 *  - Flat properties map:  { query: { type: 'string' }, limit: { type:'number', default:8 } }  (built-in tools)
 *
 * For the flat map a field is treated as required when it has no `default`.
 * `.passthrough()` keeps any extra model-supplied keys so partial schemas never
 * strip real arguments (the original bug: an unrecognized shape stripped `query`).
 */
export function jsonSchemaToZodObject(schema: JsonObject): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (schema.type === 'object' && isRecord(schema.properties)) {
    return propertiesToZod(schema.properties, toRequiredSet(schema.required))
  }
  if (looksLikeFlatPropertiesMap(schema)) {
    // Flat maps carry no "required" info, so every field is optional (+ passthrough).
    // Executors throw a clear error for any argument they actually need.
    return propertiesToZod(schema, new Set())
  }
  return z.object({}).passthrough()
}

function propertiesToZod(
  properties: Record<string, unknown>,
  required: Set<string>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propertySchema] of Object.entries(properties)) {
    const fieldSchema = jsonSchemaToZodType(isRecord(propertySchema) ? propertySchema : {})
    shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional()
  }
  return z.object(shape).passthrough()
}

function looksLikeFlatPropertiesMap(schema: JsonObject): boolean {
  const values = Object.values(schema)
  return values.length > 0 && values.every((value) => isRecord(value) && typeof (value as JsonObject).type === 'string')
}

function toRequiredSet(required: unknown): Set<string> {
  return new Set(Array.isArray(required) ? required.filter((item): item is string => typeof item === 'string') : [])
}

function jsonSchemaToZodType(schema: Record<string, unknown>): z.ZodTypeAny {
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((item) => typeof item === 'string')) {
    return z.enum(schema.enum as [string, ...string[]])
  }

  switch (schema.type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'integer':
      return z.number().int()
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

export function parseParamsSchema(raw: string): JsonObject {
  try {
    const value = JSON.parse(raw || '{}')
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}
