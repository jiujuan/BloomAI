import { createHash } from 'node:crypto'
import { parseSecretReference } from './secret-resolver'
import { analyzeMcpSchema } from './schema-support'
import { isJsonSafeValue, normalizeMcpResult } from './result-normalizer'
import type { JsonSafeObject, JsonSafeValue, McpTransportKind } from './types'

export const MCP_CATALOG_DESCRIPTION_MAX_LENGTH = 4_096
export const MCP_CATALOG_NAME_MAX_LENGTH = 256
export const MCP_CATALOG_VALUE_MAX_BYTES = 64 * 1024

export type McpConfigHashInput = {
  serverId: string
  name: string
  transportKind: McpTransportKind
  config: JsonSafeValue
  secretRefs?: readonly string[]
}

export type NormalizedCatalogSchema = {
  schema: JsonSafeValue | undefined
  supported: boolean
  errorCode?: 'MCP_SCHEMA_UNSUPPORTED'
}

export type McpCatalogToolHashInput = {
  remoteName: string
  name: string
  description: string
  inputSchema: unknown
  outputSchema?: unknown
  schemaSupported?: boolean
  schemaErrorCode?: 'MCP_SCHEMA_UNSUPPORTED'
}

export type McpCatalogHashInput = {
  serverId: string
  configHash: string
  catalogVersion: string
  tools: readonly McpCatalogToolHashInput[]
}

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|apikey|credential|privatekey)/i

/**
 * Produces a deterministic JSON representation for JSON-safe values. Object
 * keys are sorted while array order remains significant. Undefined and
 * unsupported runtime values are rejected instead of silently entering a hash.
 */
export function canonicalizeJson(value: JsonSafeValue): string {
  return canonicalize(value, new WeakSet<object>())
}

export function normalizeCatalogDescription(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MCP_CATALOG_DESCRIPTION_MAX_LENGTH)
}

export function normalizeCatalogToolName(value: unknown, fallback = 'MCP Tool'): string {
  const normalized = normalizeCatalogDescription(value)
  return (normalized || fallback).slice(0, MCP_CATALOG_NAME_MAX_LENGTH)
}

export function normalizeCatalogSchema(value: unknown): NormalizedCatalogSchema {
  if (value === undefined) return { schema: undefined, supported: true }

  const analysis = analyzeMcpSchema(value)
  if (analysis.supported) {
    return {
      schema: analysis.normalizedSchema as JsonSafeValue,
      supported: true,
    }
  }

  return {
    schema: sanitizeCatalogValue(value),
    supported: false,
    errorCode: 'MCP_SCHEMA_UNSUPPORTED',
  }
}

export function hashMcpConfig(input: McpConfigHashInput): string {
  const safeConfig = sanitizeConfigForHash(input.config)
  const canonical = canonicalizeJson({
    serverId: input.serverId,
    name: input.name,
    transportKind: input.transportKind,
    config: safeConfig,
    secretRefs: [...new Set(input.secretRefs ?? [])].sort(),
  })
  return sha256(canonical)
}

export function hashMcpToolSchema(inputSchema: unknown, outputSchema?: unknown): string {
  const input = normalizeCatalogSchema(inputSchema)
  const output = normalizeCatalogSchema(outputSchema)
  return sha256(canonicalizeJson({
    input: input.schema ?? null,
    output: output.schema ?? null,
    inputSupported: input.supported,
    outputSupported: output.supported,
    inputErrorCode: input.errorCode ?? null,
    outputErrorCode: output.errorCode ?? null,
  }))
}

export function fingerprintMcpCatalogTool(input: McpCatalogToolHashInput): string {
  const inputSchema = normalizeCatalogSchema(input.inputSchema)
  const outputSchema = normalizeCatalogSchema(input.outputSchema)
  const schemaSupported = input.schemaSupported === false
    ? false
    : inputSchema.supported && outputSchema.supported
  const schemaErrorCode = schemaSupported ? null : 'MCP_SCHEMA_UNSUPPORTED'
  return sha256(canonicalizeJson({
    remoteName: input.remoteName,
    name: normalizeCatalogToolName(input.name, input.remoteName),
    description: normalizeCatalogDescription(input.description),
    inputSchema: inputSchema.schema ?? null,
    outputSchema: outputSchema.schema ?? null,
    schemaHash: hashMcpToolSchema(inputSchema.schema, outputSchema.schema),
    schemaSupported,
    schemaErrorCode,
  }))
}

export function hashMcpCatalog(input: McpCatalogHashInput): string {
  const tools = [...input.tools]
    .sort((left, right) => left.remoteName.localeCompare(right.remoteName))
    .map((tool) => ({
      remoteName: tool.remoteName,
      fingerprint: fingerprintMcpCatalogTool(tool),
    }))
  return sha256(canonicalizeJson({
    serverId: input.serverId,
    configHash: input.configHash,
    catalogVersion: input.catalogVersion,
    tools,
  }))
}

/** Safely copies remote metadata and redacts sensitive object keys. */
export function sanitizeCatalogValue(value: unknown): JsonSafeValue | undefined {
  if (value === undefined) return undefined
  try {
    const normalized = normalizeMcpResult({ content: [value] }, { maxBytes: MCP_CATALOG_VALUE_MAX_BYTES }).content[0]
    return normalized === undefined ? undefined : normalized
  } catch {
    return undefined
  }
}

function sanitizeConfigForHash(value: JsonSafeValue, key?: string): JsonSafeValue {
  if (key !== undefined && SENSITIVE_KEY_PATTERN.test(key)) {
    if (typeof value === 'string' && parseSecretReference(value)) return value
    return '[REDACTED]'
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeConfigForHash(entry))
  if (value !== null && typeof value === 'object') {
    const output: Record<string, JsonSafeValue> = {}
    for (const [childKey, child] of Object.entries(value)) {
      output[childKey] = sanitizeConfigForHash(child, childKey)
    }
    return output
  }
  return value
}

function canonicalize(value: JsonSafeValue, active: WeakSet<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON cannot contain non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (active.has(value)) throw new TypeError('canonical JSON cannot contain cycles')
    active.add(value)
    try {
      return `[${value.map((entry) => canonicalize(entry, active)).join(',')}]`
    } finally {
      active.delete(value)
    }
  }
  if (active.has(value)) throw new TypeError('canonical JSON cannot contain cycles')
  active.add(value)
  try {
    const object = value as JsonSafeObject
    return `{${Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalize(object[key], active)}`
    )).join(',')}}`
  } finally {
    active.delete(value)
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
