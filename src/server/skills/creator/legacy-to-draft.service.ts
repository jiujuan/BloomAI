import { toLegacySkillReference } from '../../../shared/skill-references'
import type { LegacySkillAdapter, LegacySkillView } from '../application/legacy-skill.adapter'
import { legacySkillAdapter } from '../application/legacy-skill.adapter'
import { previewLegacyMigration } from '../migration/migration-preview.service'
import type { DraftCandidate, MigrationPreview, MigrationRiskLevel } from '../migration/migration.types'

export type LegacyMigrationPreview = {
  runtimeKind: 'legacy'
  legacySkillId: string
  legacyReference: string
  readOnly: true
  published: false
  riskLevel: MigrationRiskLevel
  blockers: string[]
  recommendation: string
  templateVariables: string[]
  draft: DraftCandidate['content'] & { manifest: DraftCandidate['manifest']; skillMd: string; source: 'legacy-prompt-template' } | null
  sourceSha256?: string
  decision?: 'auto_convertible' | 'manual_review' | 'critical_blocked' | 'unsupported'
  lifecycle?: 'migration_previewed' | 'manual_review_required' | 'migration_blocked'
}

type LegacyAdapterPort = Pick<LegacySkillAdapter, 'get'>

/**
 * Compatibility facade for the existing Creator path. It only returns a
 * migration candidate; it never calls the Package Creator publish methods.
 */
export function createLegacyToDraftService(overrides: { legacy?: LegacyAdapterPort } = {}) {
  const legacy = overrides.legacy ?? legacySkillAdapter

  return {
    preview(reference: string): LegacyMigrationPreview {
      const skill = legacy.get(reference)
      const migration = previewLegacyMigration(toMigrationInput(skill))
      const candidate = migration.result.kind === 'package-draft-candidate' && migration.result.decision === 'auto_convertible' ? migration.result : null
      const blockers = candidate ? candidate.warnings.map((warning) => warning.message) : reportBlockers(migration.result)
      const recommendation = candidate
        ? 'Review the deterministic Package draft candidate and requested model capability before any separate human-confirmed publish step.'
        : migration.result.kind === 'manual-review-report'
          ? 'Keep the Legacy Skill archived until endpoint, egress, authentication, timeout, and data handling policies are manually reviewed.'
          : 'Do not automatically import this Legacy Skill into the Package Runtime.'
      return {
        runtimeKind: 'legacy',
        legacySkillId: skill.id,
        legacyReference: toLegacySkillReference(skill.id),
        readOnly: true,
        published: false,
        riskLevel: migration.classification.riskLevel,
        blockers,
        recommendation,
        templateVariables: candidate?.templateVariables ?? [],
        draft: candidate ? { ...candidate.content, manifest: candidate.manifest, skillMd: candidate.content.skillMd, source: 'legacy-prompt-template' } : null,
        sourceSha256: migration.sourceSha256,
        decision: migration.classification.decision,
        lifecycle: migration.lifecycle,
      }
    },
  }
}

function toMigrationInput(skill: LegacySkillView) {
  return {
    legacySkillId: skill.id,
    type: skill.type,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    source: skill.source,
    params_schema: skill.params_schema,
  }
}

function reportBlockers(result: MigrationPreview['result']): string[] {
  if ('blockers' in result) return [...result.blockers]
  if (result.kind === 'manual-review-report') return [...result.manualActions]
  if (result.kind === 'package-draft-candidate') return result.warnings.map((warning) => warning.message)
  return []
}
