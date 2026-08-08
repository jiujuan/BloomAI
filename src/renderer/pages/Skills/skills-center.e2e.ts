import { describe, expect, it } from 'vitest'
import { decodeSkillsCenterState, encodeSkillsCenterState } from './SkillsCenterWorkbench'

describe('Skills Center browser route contract', () => {
  it('restores Package Runtime view and selected IDs without putting credentials in the hash', () => {
    const hash = encodeSkillsCenterState({ tab: 'import', selectedPackageId: 'pkg-42' })
    expect(decodeSkillsCenterState(hash)).toEqual({ tab: 'import', selectedPackageId: 'pkg-42' })
    expect(hash).not.toMatch(/authorization|cookie|password|secret|token/i)
  })
})
