import { createHash } from 'node:crypto'
import { McpError } from './errors'
import type { JsonSafeValue } from './types'

export const MCP_SCHEMA_MAX_DEPTH = 32

export const MCP_SCHEMA_SUPPORTED_KEYWORDS = Object.freeze([
  'type',
  'enum',
  'required',
  'properties',
  'items',
] as const)

export const MCP_SCHEMA_SUPPORTED_TYPES = Object.freeze([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
] as const)

export type McpJsonSchemaType = (typeof MCP_SCHEMA_SUPPORTED_TYPES)[number]

export type McpJsonSchema = {
  type?: McpJsonSchemaType
  enum?: readonly JsonSafeValue[]
  required?: readonly string[]
  properties?: Readonly<Record<string, McpJsonSchema>>
  items?: McpJsonSchema
}

export type McpSchemaAnalysis =
  | {
      supported: true
      normalizedSchema: McpJsonSchema
      schemaHash: string
      errorCode?: undefined
      error?: undefined
    }
  | {
      supported: false
      normalizedSchema?: undefined
      schemaHash?: undefined
      errorCode: 'MCP_SCHEMA_UNSUPPORTED'
      error: McpError
    }

export function normalizeMcpSchema(input: unknown): McpJsonSchema {
  try {
    return normalizeSchemaNode(input, 0, new WeakSet<object>())
  } catch (error) {
    if (error instanceof McpError) throw error
    throw new McpError('MCP_SCHEMA_UNSUPPORTED', { cause: error })
  }
}

export function analyzeMcpSchema(input: unknown): McpSchemaAnalysis {
  try {
    const normalizedSchema = normalizeMcpSchema(input)
    return {
      supported: true,
      normalizedSchema,
      schemaHash: hashNormalizedSchema(normalizedSchema),
    }
  } catch (error) {
    const normalizedError = error instanceof McpError
      ? error
      : new McpError('MCP_SCHEMA_UNSUPPORTED', { cause: error })
    return {
      supported: false,
      errorCode: 'MCP_SCHEMA_UNSUPPORTED',
      error: normalizedError,
    }
  }
}

export function isMcpSchemaSupported(input: unknown): boolean {
  return analyzeMcpSchema(input).supported
}

export function hashMcpSchema(input: unknown): string {
  return hashNormalizedSchema(normalizeMcpSchema(input))
}

function normalizeSchemaNode(
  input: unknown,
  depth: number,
  active: WeakSet<object>,
): McpJsonSchema {
  if (depth > MCP_SCHEMA_MAX_DEPTH || !isPlainObject(input)) {
    throw new McpError('MCP_SCHEMA_UNSUPPORTED')
  }
  if (active.has(input)) throw new McpError('MCP_SCHEMA_UNSUPPORTED')
  active.add(input)

  try {
    if (Object.getOwnPropertySymbols(input).length > 0) {
      throw new McpError('MCP_SCHEMA_UNSUPPORTED')
    }
    for (const key of Object.keys(input)) {
      if (!(MCP_SCHEMA_SUPPORTED_KEYWORDS as readonly string[]).includes(key)) {
        throw new McpError('MCP_SCHEMA_UNSUPPORTED')
      }
    }

    const inputType = input.type
    let type: McpJsonSchemaType | undefined
    if (inputType !== undefined) {
      if (!isMcpJsonSchemaType(inputType)) throw new McpError('MCP_SCHEMA_UNSUPPORTED')
      type = inputType
    }

    const enumValues = input.enum === undefined
      ? undefined
      : normalizeEnum(input.enum)

    const properties = input.properties === undefined
      ? undefined
      : normalizeProperties(input.properties, depth, active)
    const required = input.required === undefined
      ? undefined
      : normalizeRequired(input.required, properties)
    const items = input.items === undefined
      ? undefined
      : normalizeSchemaNode(input.items, depth + 1, active)

    if (properties !== undefined || required !== undefined) {
      if (type !== undefined && type !== 'object') throw new McpError('MCP_SCHEMA_UNSUPPORTED')
      type = 'object'
    }
    if (items !== undefined) {
      if (type !== undefined && type !== 'array') throw new McpError('MCP_SCHEMA_UNSUPPORTED')
      type = 'array'
    }

    const normalized: McpJsonSchema = {}
    if (type !== undefined) normalized.type = type
    if (enumValues !== undefined) normalized.enum = enumValues
    if (properties !== undefined) normalized.properties = properties
    if (required !== undefined) normalized.required = required
    if (items !== undefined) normalized.items = items
    return normalized
  } finally {
    active.delete(input)
  }
}

function normalizeProperties(
  input: unknown,
  depth: number,
  active: WeakSet<object>,
): Readonly<Record<string, McpJsonSchema>> {
  if (!isPlainObject(input)) throw new McpError('MCP_SCHEMA_UNSUPPORTED')
  const properties: Record<string, McpJsonSchema> = {}
  for (const key of Object.keys(input).sort()) {
    properties[key] = normalizeSchemaNode(input[key], depth + 1, active)
  }
  return properties
}

function normalizeRequired(
  input: unknown,
  properties: Readonly<Record<string, McpJsonSchema>> | undefined,
): readonly string[] {
  if (!Array.isArray(input) || input.some((entry) => typeof entry !== 'string')) {
    throw new McpError('MCP_SCHEMA_UNSUPPORTED')
  }
  const required = [...input] as string[]
  if (new Set(required).size !== required.length) {
    throw new McpError('MCP_SCHEMA_UNSUPPORTED')
  }
  if (properties !== undefined && required.some((key) => !(key in properties))) {
    throw new McpError('MCP_SCHEMA_UNSUPPORTED')
  }
  return required.sort()
}

function normalizeEnum(input: unknown): readonly JsonSafeValue[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new McpError('MCP_SCHEMA_UNSUPPORTED')
  }
  const values = input.map((value) => normalizeSchemaJsonValue(value, new WeakSet<object>()))
  return values.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
}

function normalizeSchemaJsonValue(value: unknown, active: WeakSet<object>): JsonSafeValue {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new McpError('MCP_SCHEMA_UNSUPPORTED')
    return value
  }
  if (typeof value !== 'object' || active.has(value)) {
    throw new McpError('MCP_SCHEMA_UNSUPPORTED')
  }
  active.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeSchemaJsonValue(entry, active))
    }
    if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
      throw new McpError('MCP_SCHEMA_UNSUPPORTED')
    }
    const result: Record<string, JsonSafeValue> = {}
    for (const key of Object.keys(value).sort()) {
      result[key] = normalizeSchemaJsonValue(value[key], active)
    }
    return result
  } finally {
    active.delete(value)
  }
}

function hashNormalizedSchema(schema: McpJsonSchema): string {
  return createHash('sha256').update(canonicalJson(schema), 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
  )).join(',')}}`
}

function isMcpJsonSchemaType(value: unknown): value is McpJsonSchemaType {
  return typeof value === 'string'
    && (MCP_SCHEMA_SUPPORTED_TYPES as readonly string[]).includes(value)
}

function isPlainObject(value: unknown): value is Record<string, any> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
