import { describe, expect, it, vi } from 'vitest'
import { createLegacySkillAdapter, getLegacyCapabilityProfile } from './legacy-skill.adapter'
import { createLegacyToDraftService } from '../creator/legacy-to-draft.service'

const promptSkill = {
  id: 'legacy-prompt',
  name: 'Prompt helper',
  description: 'Turns a title into a summary',
  type: 'prompt-template',
  source: 'Summarize {{title}} in one sentence.',
  params_schema: '{"title":{"type":"string"}}',
  author: 'custom',
  version: '1.0.0',
  is_public: 0,
  is_installed: 1,
  install_count: 0,
  created_at: 1,
}

function dependencies() {
  return {
    repo: {
      dataPlane: 'legacy' as const,
      listInstalled: vi.fn(() => [promptSkill]),
      listMarket: vi.fn(() => [promptSkill]),
      get: vi.fn((id: string) => id === promptSkill.id ? promptSkill : undefined),
      create: vi.fn(() => promptSkill),
      update: vi.fn(() => promptSkill),
      install: vi.fn(),
      uninstall: vi.fn(),
      delete: vi.fn(),
      listRuns: vi.fn(() => [{ id: 'legacy-run' }]),
    },
    resolveLegacySkillId: (reference: string) => reference.startsWith('legacy:') ? reference.slice(7) : reference,
    runSkill: vi.fn(async () => ({ output: 'ok' })),
  }
}

describe('LegacySkillAdapter', () => {
  it('adds an explicit capability profile without changing the legacy data plane', () => {
    const adapter = createLegacySkillAdapter(dependencies())
    const result = adapter.list()

    expect(result[0]).toMatchObject({
      id: promptSkill.id,
      runtimeKind: 'legacy',
      capabilityProfile: {
        capabilities: ['legacy.prompt-template', 'llm.generate'],
        riskLevel: 'medium',
        canConvertToPackage: true,
      },
    })
    expect(dependencies().repo.dataPlane).toBe('legacy')
  })

  it('keeps arbitrary JavaScript out of automatic Package conversion', () => {
    const profile = getLegacyCapabilityProfile('js-function')
    expect(profile.riskLevel).toBe('critical')
    expect(profile.canConvertToPackage).toBe(false)
    expect(profile.blockers).toContain('arbitrary JavaScript requires manual capability review')
  })

  it('maps legacy CRUD and run operations while preserving old run behavior', async () => {
    const deps = dependencies()
    const adapter = createLegacySkillAdapter(deps)

    expect(adapter.get('legacy:legacy-prompt')).toMatchObject({ id: promptSkill.id, runtimeKind: 'legacy' })
    expect(adapter.install(promptSkill.id)).toMatchObject({ id: promptSkill.id })
    expect(adapter.update(promptSkill.id, { description: 'updated' })).toMatchObject({ id: promptSkill.id })
    expect(adapter.delete(promptSkill.id)).toEqual({ kind: 'deleted' })
    await expect(adapter.run('legacy:legacy-prompt', { title: 'x' })).resolves.toEqual({ output: 'ok' })
    expect(deps.runSkill).toHaveBeenCalledWith(promptSkill.id, { title: 'x' })
  })
})

describe('legacy-to-draft service', () => {
  it('returns a read-only prompt-template draft preview and never writes the legacy repo', () => {
    const deps = dependencies()
    const adapter = createLegacySkillAdapter(deps)
    const service = createLegacyToDraftService({ legacy: adapter })

    const preview = service.preview('legacy:legacy-prompt')
    expect(preview).toMatchObject({
      readOnly: true,
      published: false,
      runtimeKind: 'legacy',
      legacySkillId: promptSkill.id,
      draft: { manifest: { runtime: 'instruction-agent', entryPath: 'SKILL.md' } },
    })
    expect(preview.draft!.skillMd).toContain('Summarize {{title}}')
    expect(preview.templateVariables).toEqual(['title'])
    expect(deps.repo.create).not.toHaveBeenCalled()
    expect(deps.repo.update).not.toHaveBeenCalled()
    expect(deps.repo.install).not.toHaveBeenCalled()
  })

  it('returns a blocked preview for js-function instead of manufacturing a package draft', () => {
    const skill = { ...promptSkill, id: 'legacy-js', type: 'js-function', source: 'function run() { return { ok: true } }' }
    const deps = dependencies()
    deps.repo.listInstalled.mockReturnValue([skill])
    deps.repo.get.mockImplementation((id: string) => id === skill.id ? skill : undefined)
    const service = createLegacyToDraftService({ legacy: createLegacySkillAdapter(deps) })

    const preview = service.preview(skill.id)
    expect(preview.readOnly).toBe(true)
    expect(preview.draft).toBeNull()
    expect(preview.blockers).toContain('arbitrary JavaScript requires manual capability review')
  })
})
