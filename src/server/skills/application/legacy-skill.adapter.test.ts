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
      listRuns: vi.fn(() => [{ id: 'legacy-run' }]),
    },
  }
}

describe('LegacySkillAdapter', () => {
  it('adds explicit archive metadata without changing the legacy data plane', () => {
    const adapter = createLegacySkillAdapter(dependencies())
    const result = adapter.list()

    expect(result[0]).toMatchObject({
      id: promptSkill.id,
      runtimeKind: 'legacy',
      lifecycle: 'read-only',
      readOnly: true,
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

  it.each(['install', 'update', 'delete'] as const)('blocks Legacy %s without touching the repository', (operation) => {
    const deps = dependencies()
    const adapter = createLegacySkillAdapter(deps)
    const invoke = operation === 'install'
      ? () => adapter.install(promptSkill.id)
      : operation === 'update'
        ? () => adapter.update(promptSkill.id, { description: 'updated' })
        : () => adapter.delete(promptSkill.id)
    expect(invoke).toThrowError(expect.objectContaining({ code: 'LEGACY_SKILL_FROZEN' }))
    expect(deps.repo.get).not.toHaveBeenCalled()
    expect(deps.repo.listRuns).not.toHaveBeenCalled()
  })

  it('blocks Legacy run before any runner or run-history side effect', async () => {
    const deps = dependencies()
    const adapter = createLegacySkillAdapter(deps)

    await expect(adapter.run('legacy:legacy-prompt', { title: 'x' })).rejects.toMatchObject({ code: 'LEGACY_SKILL_RUN_DISABLED' })
    expect(deps.repo.listRuns).not.toHaveBeenCalled()
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
    expect(preview.blockers).toContain('arbitrary JavaScript source is not automatically translated')
  })
})
