import { describe, expect, it } from 'vitest'

describe('Legacy skill repository boundary', () => {
  it('exposes a frozen compatibility wrapper instead of an assignable alias', async () => {
    const { legacySkillRepo, skillRepo } = await import('./skill.repo')
    expect(legacySkillRepo.dataPlane).toBe('legacy')
    expect(skillRepo).not.toBe(legacySkillRepo)
    expect(Object.isFrozen(skillRepo)).toBe(true)
    expect(skillRepo.dataPlane).toBe('legacy')
    expect('createRun' in legacySkillRepo).toBe(false)
  })
})
