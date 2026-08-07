import type { z } from 'zod'
import type {
  criticalBlockedReportSchema,
  draftCandidateSchema,
  httpManualReviewReportSchema,
  migrationPreviewSchema,
  normalizedLegacySourceSchema,
  unsupportedReportSchema,
} from './migration.schemas'

export const MIGRATION_SKILL_TYPES = ['prompt-template', 'http-api', 'js-function'] as const
export const MIGRATION_DECISIONS = ['auto_convertible', 'manual_review', 'critical_blocked', 'unsupported'] as const
export const MIGRATION_LIFECYCLES = ['migration_previewed', 'manual_review_required', 'migration_blocked'] as const
export const MIGRATION_STATUSES = MIGRATION_LIFECYCLES
export type MigrationSkillType = (typeof MIGRATION_SKILL_TYPES)[number]
export type MigrationDecision = 'auto_convertible' | 'manual_review' | 'critical_blocked' | 'unsupported'
export type MigrationLifecycle = 'migration_previewed' | 'manual_review_required' | 'migration_blocked'
export type MigrationRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type LegacySkillSourceInput = {
  readonly legacySkillId?: unknown
  readonly id?: unknown
  readonly type?: unknown
  readonly kind?: unknown
  readonly name?: unknown
  readonly description?: unknown
  readonly version?: unknown
  readonly source?: unknown
  readonly paramsSchema?: unknown
  readonly params_schema?: unknown
  readonly inputSchema?: unknown
  readonly outputSchema?: unknown
  readonly metadata?: unknown
  readonly [key: string]: unknown
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type ClassifiedMigration = {
  readonly type: MigrationSkillType | 'unknown'
  readonly decision: MigrationDecision
  readonly riskLevel: MigrationRiskLevel
  readonly reasons: string[]
  readonly acceptedFields: string[]
}

export type NormalizedLegacySource = z.infer<typeof normalizedLegacySourceSchema>
export type DraftCandidate = z.infer<typeof draftCandidateSchema>
export type HttpManualReviewReport = z.infer<typeof httpManualReviewReportSchema>
export type CriticalBlockedReport = z.infer<typeof criticalBlockedReportSchema>
export type UnsupportedReport = z.infer<typeof unsupportedReportSchema>
export type MigrationPreview = z.infer<typeof migrationPreviewSchema>

export type MigrationPreviewStore = {
  get(key: string): MigrationPreview | undefined
  set(key: string, value: MigrationPreview): void
}

export type RedactionOptions = { readonly knownSecrets?: readonly string[] }
export type RedactionStats = { readonly redactedCount: number; readonly keyRedactions: number; readonly valueRedactions: number }
