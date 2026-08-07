import { describe, expect, it, vi } from 'vitest'
import { createSkillService } from './skill.service'

describe('skillService', () => {
  it('preserves the package skill reference guard for the synchronous legacy endpoint', async () => {
    const service = createSkillService({
      skillRepo: { get: vi.fn(() => undefined) } as any,
      skillPackageRepo: { isPackageReference: vi.fn(() => true) } as any,
      resolveLegacySkillId: vi.fn(() => undefined),
    })

    await expect(service.run('package:pkg_1', {})).rejects.toMatchObject({ code: 'PACKAGE_SKILL_ASYNC_ONLY' })
  })

  it('blocks an existing Legacy skill without invoking a runner or writing run history', async () => {
    const runSkill = vi.fn(async () => ({ ok: true }))
    const skillRepo = { get: vi.fn(() => ({ id: 'same-id' })) } as any
    const service = createSkillService({
      skillRepo,
      skillPackageRepo: { isPackageReference: vi.fn(() => false) } as any,
      resolveLegacySkillId: vi.fn(() => 'same-id'),
      runSkill,
    })

    await expect(service.run('same-id', { value: 1 })).rejects.toMatchObject({ code: 'LEGACY_SKILL_RUN_DISABLED' })
    expect(runSkill).not.toHaveBeenCalled()
  })

  it('freezes Legacy install, create, update and remove operations before repository access', () => {
    const skillRepo = {
      get: vi.fn(() => ({ id: 'legacy-1', author: 'custom' })),
      create: vi.fn(),
      update: vi.fn(),
      install: vi.fn(),
      delete: vi.fn(),
    } as any
    const service = createSkillService({ skillRepo })

    expect(() => service.install('legacy-1')).toThrowError(expect.objectContaining({ code: 'LEGACY_SKILL_FROZEN' }))
    expect(() => service.create({ name: 'n', description: 'd', type: 'js-function', source: 'return {}' })).toThrowError(expect.objectContaining({ code: 'LEGACY_SKILL_FROZEN' }))
    expect(() => service.update('legacy-1', { description: 'updated' })).toThrowError(expect.objectContaining({ code: 'LEGACY_SKILL_FROZEN' }))
    expect(() => service.remove('legacy-1')).toThrowError(expect.objectContaining({ code: 'LEGACY_SKILL_FROZEN' }))
    expect(skillRepo.create).not.toHaveBeenCalled()
    expect(skillRepo.update).not.toHaveBeenCalled()
    expect(skillRepo.install).not.toHaveBeenCalled()
    expect(skillRepo.delete).not.toHaveBeenCalled()
  })

  it('keeps historical installed, market and run queries read-only', () => {
    const skillRepo = {
      listInstalled: vi.fn(() => [{ id: 'installed' }]),
      listMarket: vi.fn(() => [{ id: 'market' }]),
      listRuns: vi.fn(() => [{ id: 'run' }]),
      get: vi.fn(() => ({ id: 'legacy-id' })),
    } as any
    const service = createSkillService({ skillRepo })

    expect(service.listInstalled()).toEqual([{ id: 'installed' }])
    expect(service.listMarket({ query: 'q', limit: 3, offset: 4 })).toEqual([{ id: 'market' }])
    expect(service.listRuns('legacy:legacy-id', 5)).toEqual([{ id: 'run' }])
    expect(skillRepo.listMarket).toHaveBeenCalledWith('q', 3, 4)
    expect(skillRepo.listRuns).toHaveBeenCalledWith('legacy-id', 5)
  })
})
