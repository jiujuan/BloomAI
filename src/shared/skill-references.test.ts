import { describe, expect, it } from 'vitest'
import {
  resolveLegacySkillId,
  resolvePackageSkillId,
  toLegacySkillReference,
  toPackageSkillReference,
} from './skill-references'

describe('skill reference boundaries', () => {
  it('keeps Legacy and Package references in separate planes', () => {
    expect(toLegacySkillReference('legacy-1')).toBe('legacy:legacy-1')
    expect(toPackageSkillReference('package-1')).toBe('package:package-1')
    expect(resolveLegacySkillId('legacy:legacy-1')).toBe('legacy-1')
    expect(resolvePackageSkillId('package:package-1')).toBe('package-1')
    expect(resolveLegacySkillId('package:package-1')).toBeUndefined()
    expect(resolvePackageSkillId('legacy:legacy-1')).toBeUndefined()
  })

  it('allows unprefixed Legacy history reads but never treats them as Package references', () => {
    expect(resolveLegacySkillId('historical-id')).toBe('historical-id')
    expect(resolvePackageSkillId('historical-id')).toBeUndefined()
  })

  it('rejects empty, nested, and cross-plane IDs', () => {
    expect(() => toLegacySkillReference('')).toThrow()
    expect(() => toPackageSkillReference('nested:id')).toThrow()
    expect(resolveLegacySkillId('legacy:package:id')).toBeUndefined()
    expect(resolvePackageSkillId('package:legacy:id')).toBeUndefined()
    expect(resolveLegacySkillId('legacy:')).toBeUndefined()
    expect(resolvePackageSkillId('package:')).toBeUndefined()
  })
})
