import { describe, expect, it, vi } from 'vitest'
import { createSkillService } from './skill.service'

describe('skillService', () => {
  it('preserves the package skill reference guard for the synchronous legacy endpoint', async () => {
    const service = createSkillService({
      skillRepo: { get: vi.fn(() => undefined) } as any,
      skillPackageRepo: { isPackageReference: vi.fn(() => true) } as any,
      resolveLegacySkillId: vi.fn(() => undefined),
      runSkill: vi.fn(),
    })

    await expect(service.run('package:pkg_1', {})).rejects.toMatchObject({ code: 'PACKAGE_SKILL_ASYNC_ONLY' })
  })

  it('prefers an existing legacy skill when an old raw ID collides with a package record', async () => {
    const runSkill = vi.fn(async () => ({ ok: true }))
    const service = createSkillService({
      skillRepo: { get: vi.fn(() => ({ id: 'same-id' })) } as any,
      skillPackageRepo: { isPackageReference: vi.fn(() => true) } as any,
      resolveLegacySkillId: vi.fn(() => 'same-id'),
      runSkill,
    })

    await expect(service.run('same-id', { value: 1 })).resolves.toEqual({ ok: true })
    expect(runSkill).toHaveBeenCalledWith('same-id', { value: 1 })
  })

  it('uses NOT_FOUND when installing a missing legacy skill', () => {
    const service = createSkillService({ skillRepo: { get: vi.fn(() => undefined) } as any })
    expect(() => service.install('missing')).toThrowError('Skill not found')
  })

  it('validates custom skill creation and preserves legacy params schema strings', () => {
    const skillRepo = { create: vi.fn((input) => input) } as any
    const service = createSkillService({ skillRepo })

    expect(() => service.create({ name: 'n' })).toThrowError('name, description, type, source required')
    expect(service.create({ name: 'n', description: 'd', type: 'js-function', source: 'return {}', params_schema: '{"x":true}' })).toMatchObject({ params_schema: '{"x":true}' })
    expect(() => service.create({ name: 'n', description: 'd', type: 'unknown', source: 'return {}' })).toThrowError('invalid type')
  })

  it('uninstalls official skills but deletes custom skills', () => {
    const skillRepo = {
      get: vi.fn((id: string) => id === 'official' ? { id, author: 'official' } : { id, author: 'me' }),
      uninstall: vi.fn(),
      delete: vi.fn(),
    } as any
    const service = createSkillService({ skillRepo })

    expect(service.remove('official')).toEqual({ kind: 'uninstalled' })
    expect(service.remove('custom')).toEqual({ kind: 'deleted' })
    expect(skillRepo.uninstall).toHaveBeenCalledWith('official')
    expect(skillRepo.delete).toHaveBeenCalledWith('custom')
  })

  it('maps unexpected legacy runtime errors and forwards installed/market/run queries', async () => {
    const skillRepo = {
      listInstalled: vi.fn(() => [{ id: 'installed' }]),
      listMarket: vi.fn(() => [{ id: 'market' }]),
      listRuns: vi.fn(() => [{ id: 'run' }]),
      get: vi.fn(() => ({ id: 'legacy-id' })),
    } as any
    const service = createSkillService({
      skillRepo,
      resolveLegacySkillId: vi.fn(() => 'legacy-id'),
      runSkill: vi.fn(async () => { throw new Error('legacy failed') }),
    })

    expect(service.listInstalled()).toEqual([{ id: 'installed' }])
    expect(service.listMarket({ query: 'q', limit: 3, offset: 4 })).toEqual([{ id: 'market' }])
    expect(service.listRuns('legacy:legacy-id', 5)).toEqual([{ id: 'run' }])
    await expect(service.run('legacy:legacy-id', {})).rejects.toMatchObject({ code: 'SKILL_ERROR', message: 'legacy failed' })
    expect(skillRepo.listMarket).toHaveBeenCalledWith('q', 3, 4)
    expect(skillRepo.listRuns).toHaveBeenCalledWith('legacy-id', 5)
  })
})
