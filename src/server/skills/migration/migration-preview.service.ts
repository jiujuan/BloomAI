import { createHash } from 'node:crypto'
import { classifyLegacySkill } from './migration-classifier'
import { createHttpApiManualReviewReport, createJsFunctionCriticalBlockedReport } from './manual-review-report'
import { migratePromptTemplateToDraftCandidate } from './prompt-template-migrator'
import { canonicalJsonString, normalizeLegacySource, sha256 } from './source-normalizer'
import { migrationPreviewSchema } from './migration.schemas'
import { MIGRATION_ERROR_CODES, MigrationError } from './migration-errors'
import type { LegacySkillSourceInput, MigrationPreview, MigrationPreviewStore, UnsupportedReport } from './migration.types'

export type MigrationPreviewService = ReturnType<typeof createMigrationPreviewService>

export function createMigrationPreviewService(options: { store?: MigrationPreviewStore } = {}) {
  const store = options.store ?? createMemoryStore()

  function inspect(input: unknown): MigrationPreview {
    return buildPreview(input, store, false)
  }

  function preview(input: unknown): MigrationPreview {
    return buildPreview(input, store, true)
  }

  return { inspect, preview }
}

export function createMemoryMigrationPreviewStore(): MigrationPreviewStore {
  return createMemoryStore()
}

export const migrationPreviewService = createMigrationPreviewService()
export const inspectLegacyMigration = (input: unknown) => migrationPreviewService.inspect(input)
export const previewLegacyMigration = (input: unknown) => migrationPreviewService.preview(input)

function buildPreview(input: unknown, store: MigrationPreviewStore, cacheResult: boolean): MigrationPreview {
  const classification = classifyLegacySkill(input)
  let source
  try {
    source = normalizeLegacySource(input)
  } catch (error) {
    const code = error instanceof MigrationError ? error.code : MIGRATION_ERROR_CODES.DAMAGED_SCHEMA
    const legacySkillId = readLegacyId(input)
    const sourceSha256 = safeFailureHash(input, code)
    const result: UnsupportedReport = {
      kind: 'unsupported-report',
      sourceType: 'unknown',
      legacySkillId,
      sourceSha256,
      lifecycle: 'migration_blocked',
      decision: 'unsupported',
      riskLevel: 'critical',
      blockers: ['Legacy source schema is damaged or outside the safe migration boundary', 'No Package draft or executable interpretation was produced'],
      sideEffects: { network: false, database: false, queue: false, runner: false, publish: false },
    }
    const failedPreview = { legacySkillId, sourceSha256, classification: { type: 'unknown' as const, decision: 'unsupported' as const, riskLevel: 'critical' as const, reasons: [...classification.reasons, 'damaged schema is fail-closed'], acceptedFields: [] }, lifecycle: 'migration_blocked' as const, result, readOnly: true as const, idempotencyKey: `${legacySkillId}:${sourceSha256}` }
    return cacheAndValidate(failedPreview, store, cacheResult)
  }

  const idempotencyKey = `${source.legacySkillId}:${source.sourceSha256}`
  if (cacheResult) {
    const cached = store.get(idempotencyKey)
    if (cached) return cached
  }

  let result: MigrationPreview['result']
  let lifecycle: MigrationPreview['lifecycle']
  if (source.type === 'prompt-template') {
    result = migratePromptTemplateToDraftCandidate(source)
    lifecycle = result.decision === 'critical_blocked' ? 'migration_blocked' : 'migration_previewed'
  } else if (source.type === 'http-api') {
    result = createHttpApiManualReviewReport(source)
    lifecycle = 'manual_review_required'
  } else if (source.type === 'js-function') {
    result = createJsFunctionCriticalBlockedReport(source)
    lifecycle = 'migration_blocked'
  } else {
    result = buildUnsupportedReport(source.legacySkillId, source.sourceSha256, 'unsupported or missing migration type')
    lifecycle = 'migration_blocked'
  }

  const value = cacheAndValidate({ legacySkillId: source.legacySkillId, sourceSha256: source.sourceSha256, classification, lifecycle, result, readOnly: true, idempotencyKey }, store, cacheResult)
  return value
}

function cacheAndValidate(value: MigrationPreview, store: MigrationPreviewStore, cacheResult: boolean): MigrationPreview {
  const checked = migrationPreviewSchema.parse(value)
  if (cacheResult) store.set(checked.idempotencyKey, checked)
  return checked
}

function buildUnsupportedReport(legacySkillId: string, sourceSha256: string, reason: string): UnsupportedReport {
  return { kind: 'unsupported-report', sourceType: 'unknown', legacySkillId, sourceSha256, lifecycle: 'migration_blocked', decision: 'unsupported', riskLevel: 'critical', blockers: [reason], sideEffects: { network: false, database: false, queue: false, runner: false, publish: false } }
}

function createMemoryStore(): MigrationPreviewStore {
  const cache = new Map<string, MigrationPreview>()
  return { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
}

function readLegacyId(input: unknown): string {
  if (isRecord(input) && typeof input.legacySkillId === 'string' && input.legacySkillId.trim()) return input.legacySkillId.trim()
  if (isRecord(input) && typeof input.id === 'string' && input.id.trim()) return input.id.trim()
  return 'unknown-legacy-skill'
}

function safeFailureHash(input: unknown, code: string): string {
  try { return sha256(canonicalJsonString({ input, code })) } catch { return createHash('sha256').update(`${readLegacyId(input)}:${code}`, 'utf8').digest('hex') }
}
function isRecord(value: unknown): value is LegacySkillSourceInput { return !!value && typeof value === 'object' && !Array.isArray(value) }
