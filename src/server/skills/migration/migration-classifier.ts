import { MIGRATION_SKILL_TYPES } from './migration.types'
import type { ClassifiedMigration, LegacySkillSourceInput, MigrationSkillType } from './migration.types'

const ACCEPTED_FIELDS = ['legacySkillId', 'id', 'type', 'kind', 'name', 'description', 'version', 'source', 'paramsSchema', 'params_schema', 'inputSchema', 'outputSchema', 'metadata'] as const
const OWN = Object.prototype.hasOwnProperty

/**
 * Classifies only the explicit top-level type/kind field. It never executes,
 * parses, or trusts a string/object that merely resembles a supported type.
 */
export function classifyLegacySkill(input: unknown): ClassifiedMigration {
  if (!isRecord(input)) return unsupported('Legacy source must be an object')

  const hasType = OWN.call(input, 'type')
  const hasKind = OWN.call(input, 'kind')
  const type = hasType ? input.type : undefined
  const kind = hasKind ? input.kind : undefined

  if (hasType && typeof type !== 'string' || hasKind && typeof kind !== 'string') {
    return unsupported('type and kind must be exact strings')
  }
  if (!hasType && !hasKind) return unsupported('missing explicit type/kind')
  if (hasType && hasKind && type !== kind) return unsupported('type and kind disagree')

  const value = (hasType ? type : kind) as string
  if (!MIGRATION_SKILL_TYPES.includes(value as MigrationSkillType)) {
    return unsupported(`unsupported type: ${value}`)
  }

  const acceptedFields = ACCEPTED_FIELDS.filter((field) => OWN.call(input, field))
  if (value === 'prompt-template') {
    return { type: value as MigrationSkillType, decision: 'auto_convertible', riskLevel: 'medium', reasons: ['deterministic draft conversion is permitted; publication remains a separate human-confirmed step'], acceptedFields }
  }
  if (value === 'http-api') {
    return { type: value as MigrationSkillType, decision: 'manual_review', riskLevel: 'high', reasons: ['outbound network capability and endpoint policy require manual review'], acceptedFields }
  }
  return { type: value as MigrationSkillType, decision: 'critical_blocked', riskLevel: 'critical', reasons: ['arbitrary JavaScript cannot be imported or executed automatically'], acceptedFields }
}

export const classifyMigrationSource = classifyLegacySkill

function unsupported(reason: string): ClassifiedMigration {
  return { type: 'unknown', decision: 'unsupported', riskLevel: 'critical', reasons: [reason], acceptedFields: [] }
}

function isRecord(value: unknown): value is LegacySkillSourceInput {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
