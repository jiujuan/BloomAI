import { describe, expect, it } from 'vitest'
import { decodeSkillsCenterState, encodeSkillsCenterState } from './SkillsCenterWorkbench'

describe('Skills Center browser route contract', () => {
  it('restores Package Runtime view and selected IDs without putting credentials in the hash', () => {
    const hash = encodeSkillsCenterState({ tab: 'import', selectedPackageId: 'pkg-42' })
    expect(decodeSkillsCenterState(hash)).toEqual({ tab: 'import', selectedPackageId: 'pkg-42' })
    expect(hash).not.toMatch(/authorization|cookie|password|secret|token/i)
  })

  it('handles legacy permissions hash by opening Skill Detail', () => {
    const decoded = decodeSkillsCenterState('#skills/tab=permissions&package=pkg-1')

    expect(decoded).toMatchObject({
      tab: 'detail',
      selectedPackageId: 'pkg-1',
    })
    expect(encodeSkillsCenterState(decoded)).toBe('#skills/tab=detail&package=pkg-1')
    expect(encodeSkillsCenterState(decoded)).not.toContain('tab=permissions')
  })
})
