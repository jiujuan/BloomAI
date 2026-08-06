import { describe, expect, it } from 'vitest'

describe('Legacy skill repository boundary', () => {
  it('exposes an explicit legacy data-plane adapter', async () => {
    const { legacySkillRepo, skillRepo } = await import('./skill.repo')
    expect(legacySkillRepo.dataPlane).toBe('legacy')
    expect(skillRepo).toBe(legacySkillRepo)
    expect('createRun' in legacySkillRepo).toBe(false)
  })
})
