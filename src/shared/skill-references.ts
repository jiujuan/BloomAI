export const LEGACY_SKILL_REFERENCE_PREFIX = 'legacy:'
export const PACKAGE_SKILL_REFERENCE_PREFIX = 'package:'

function prefixedReference(prefix: string, id: string): string {
  if (!id || id.includes(':')) throw new Error('Skill reference ID is required and must not contain a namespace separator')
  return `${prefix}${id}`
}

function unwrapReference(reference: string, prefix: string): string | undefined {
  if (!reference.startsWith(prefix)) return undefined
  const id = reference.slice(prefix.length)
  return id && !id.includes(':') ? id : undefined
}

/** Stable public reference for a record stored in the historical `skills` table. */
export function toLegacySkillReference(id: string): string {
  return prefixedReference(LEGACY_SKILL_REFERENCE_PREFIX, id)
}

/** Stable public reference for a Package Runtime record. */
export function toPackageSkillReference(id: string): string {
  return prefixedReference(PACKAGE_SKILL_REFERENCE_PREFIX, id)
}

/** Returns true only for an explicitly namespaced Legacy reference. */
export function isLegacySkillReference(reference: string): boolean {
  return typeof reference === 'string' && reference.startsWith(LEGACY_SKILL_REFERENCE_PREFIX)
}

/** Returns true only for an explicitly namespaced Package reference. */
export function isPackageSkillReference(reference: string): boolean {
  return typeof reference === 'string' && reference.startsWith(PACKAGE_SKILL_REFERENCE_PREFIX)
}

/**
 * Resolves a Legacy reference while keeping historical unprefixed IDs readable.
 * A Package reference is deliberately never interpreted as a Legacy Skill ID.
 */
export function resolveLegacySkillId(reference: string): string | undefined {
  if (!reference) return undefined
  if (reference.startsWith(PACKAGE_SKILL_REFERENCE_PREFIX)) return undefined
  if (reference.startsWith(LEGACY_SKILL_REFERENCE_PREFIX)) return unwrapReference(reference, LEGACY_SKILL_REFERENCE_PREFIX)
  return reference
}

/**
 * Resolves only explicitly namespaced Package references. Unprefixed IDs are
 * reserved for historical Legacy reads and cannot enter the Package plane.
 */
export function resolvePackageSkillId(reference: string): string | undefined {
  if (!reference || reference.startsWith(LEGACY_SKILL_REFERENCE_PREFIX)) return undefined
  return unwrapReference(reference, PACKAGE_SKILL_REFERENCE_PREFIX)
}
