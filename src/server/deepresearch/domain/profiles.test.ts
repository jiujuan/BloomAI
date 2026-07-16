import { describe, expect, it } from 'vitest'
import { getResearchProfilePolicy } from './profiles'

describe('deep research profiles', () => {
  it('defines distinct market and academic requirements', () => {
    expect(getResearchProfilePolicy('market').requiredSections).toContain('market-sizing')
    expect(getResearchProfilePolicy('academic').requiredSections).toContain('methodology-review')
  })

  it('returns deeply immutable profile policies', () => {
    const policy = getResearchProfilePolicy('competitor')

    expect(() => Object.assign(policy, { profile: 'market' })).toThrow()
    expect(() => (policy.requiredSections as unknown as string[]).push('new-section')).toThrow()
  })
})
