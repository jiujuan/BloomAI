import { describe, expect, it } from 'vitest'

describe('Legacy skill repository boundary', () => {
  it('exposes only the explicit archive repository and no deprecated default alias', async () => {
    const repositoryModule = await import('./skill.repo')
    expect(repositoryModule.legacySkillRepo.dataPlane).toBe('legacy')
    expect('skillRepo' in repositoryModule).toBe(false)
  })
})
