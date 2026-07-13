import { describe, expect, it, vi } from 'vitest'

describe('skill package runtime feature flag', () => {
  it('is disabled by default', async () => {
    vi.resetModules()
    delete process.env.SKILL_PACKAGE_RUNTIME_ENABLED

    const { isSkillPackageRuntimeEnabled } = await import('./feature-flag')

    expect(isSkillPackageRuntimeEnabled()).toBe(false)
  })

  it('can be enabled explicitly', async () => {
    vi.resetModules()
    process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'

    const { isSkillPackageRuntimeEnabled } = await import('./feature-flag')

    expect(isSkillPackageRuntimeEnabled()).toBe(true)
  })
})
