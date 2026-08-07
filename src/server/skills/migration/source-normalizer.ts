import { createHash } from 'node:crypto'
import { legacySkillSourceInputSchema } from './migration.schemas'
import { classifyLegacySkill } from './migration-classifier'
import { MIGRATION_ERROR_CODES, MigrationError } from './migration-errors'
import type { JsonValue, LegacySkillSourceInput, NormalizedLegacySource } from './migration.types'

const MAX_CANONICAL_BYTES = 512 * 1024
const MAX_DEPTH = 24
const MAX_ARRAY_ITEMS = 2_000
const MAX_OBJECT_KEYS = 2_000

export function normalizeLegacySource(input: unknown): NormalizedLegacySource {
  const parsed = legacySkillSourceInputSchema.safeParse(input)
  if (!parsed.success) throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'Legacy source envelope is invalid')
  const value = parsed.data as LegacySkillSourceInput
  const legacySkillId = stringField(value.legacySkillId) ?? stringField(value.id)
  if (!legacySkillId) throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'legacySkillId is required')

  const classification = classifyLegacySkill(value)
  const source = normalizeSourceValue(value.source ?? '')
  const inputSchema = normalizeSchemaField(value.paramsSchema ?? value.params_schema ?? value.inputSchema ?? {})
  const outputSchema = normalizeSchemaField(value.outputSchema ?? {})
  const metadata = normalizeObject(value.metadata ?? {})
  const normalized = {
    legacySkillId,
    type: classification.type,
    name: normalizeText(stringField(value.name) ?? `Legacy Skill ${legacySkillId}`) || `Legacy Skill ${legacySkillId}`,
    description: normalizeText(stringField(value.description) ?? ''),
    version: normalizeText(stringField(value.version) ?? '0.1.0') || '0.1.0',
    source,
    inputSchema,
    outputSchema,
    metadata,
  }
  const canonicalJson = canonicalJsonString(normalized)
  const bytes = Buffer.byteLength(canonicalJson, 'utf8')
  if (bytes > MAX_CANONICAL_BYTES) throw new MigrationError(MIGRATION_ERROR_CODES.SOURCE_TOO_LARGE, 'Legacy source exceeds migration size limit', { bytes, limit: MAX_CANONICAL_BYTES })
  return { ...normalized, canonicalJson, sourceSha256: sha256(canonicalJson) } as NormalizedLegacySource
}

export const normalizeAndHashLegacySource = normalizeLegacySource

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function canonicalizeJson(value: unknown, depth = 0, seen = new WeakSet<object>()): JsonValue {
  if (depth > MAX_DEPTH) throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'Legacy source nesting is too deep')
  if (value === null) return null
  if (typeof value === 'string') return normalizeText(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'Non-finite numbers are not valid JSON')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'Legacy source array is too large')
    if (seen.has(value)) throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'Cyclic legacy source is not valid JSON')
    seen.add(value)
    const result = value.map((entry) => canonicalizeJson(entry, depth + 1, seen))
    seen.delete(value)
    return result
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'Cyclic legacy source is not valid JSON')
    seen.add(value)
    const keys = Object.keys(value)
    if (keys.length > MAX_OBJECT_KEYS) throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'Legacy source object has too many keys')
    const result: Record<string, JsonValue> = {}
    for (const key of keys.sort()) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry === undefined) continue
      result[normalizeText(key)] = canonicalizeJson(entry, depth + 1, seen)
    }
    seen.delete(value)
    return result
  }
  throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, `Unsupported value in legacy source: ${typeof value}`)
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function normalizeSourceValue(value: unknown): JsonValue {
  if (typeof value === 'string') return normalizeText(value)
  return canonicalizeJson(value ?? '')
}

function normalizeSchemaField(value: unknown): JsonValue {
  if (typeof value === 'string') {
    const text = normalizeText(value)
    if (!text) return {}
    try { return canonicalizeJson(JSON.parse(text)) } catch { throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'Schema field must contain valid JSON') }
  }
  return canonicalizeJson(value ?? {})
}

function normalizeObject(value: unknown): Record<string, JsonValue> {
  const normalized = canonicalizeJson(value)
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') throw new MigrationError(MIGRATION_ERROR_CODES.DAMAGED_SCHEMA, 'metadata must be a JSON object')
  return normalized as Record<string, JsonValue>
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '').trim()
}
