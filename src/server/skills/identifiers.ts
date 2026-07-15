export const LEGACY_SKILL_REFERENCE_PREFIX = 'legacy:'
export const PACKAGE_SKILL_REFERENCE_PREFIX = 'package:'

function prefixedReference(prefix: string, id: string): string {
  if (!id) throw new Error('Skill reference ID is required')
  return `${prefix}${id}`
}

function unwrapReference(reference: string, prefix: string): string | undefined {
  if (!reference.startsWith(prefix)) return undefined
  const id = reference.slice(prefix.length)
  return id || undefined
}

/** Stable public reference for a record stored in the historical `skills` table. */
export function toLegacySkillReference(id: string): string {
  return prefixedReference(LEGACY_SKILL_REFERENCE_PREFIX, id)
}

/** Stable public reference for a Package Runtime record. */
export function toPackageSkillReference(id: string): string {
  return prefixedReference(PACKAGE_SKILL_REFERENCE_PREFIX, id)
}

/**
 * Resolves a Legacy reference while keeping historical unprefixed IDs readable.
 * A Package reference is deliberately never interpreted as a Legacy Skill ID.
 */
export function resolveLegacySkillId(reference: string): string | undefined {
  if (reference.startsWith(PACKAGE_SKILL_REFERENCE_PREFIX)) return undefined
  if (reference.startsWith(LEGACY_SKILL_REFERENCE_PREFIX)) return unwrapReference(reference, LEGACY_SKILL_REFERENCE_PREFIX)
  return reference
}

/**
 * Resolves a Package reference while keeping previously issued unprefixed IDs readable.
 * A Legacy reference is deliberately never interpreted as a Package Skill ID.
 */
export function resolvePackageSkillId(reference: string): string | undefined {
  if (reference.startsWith(LEGACY_SKILL_REFERENCE_PREFIX)) return undefined
  if (reference.startsWith(PACKAGE_SKILL_REFERENCE_PREFIX)) return unwrapReference(reference, PACKAGE_SKILL_REFERENCE_PREFIX)
  return reference
}
