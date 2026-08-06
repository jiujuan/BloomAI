import { skillRepo } from '../db/repositories/skill.repo'
import { skillPackageRepo } from '../db/repositories/skill-package.repo'
import { resolveLegacySkillId } from '../../shared/skill-references'
import { createLegacySkillAdapter, type LegacySkillAdapter } from '../skills/application/legacy-skill.adapter'
import { createLegacyToDraftService, type LegacyMigrationPreview } from '../skills/creator/legacy-to-draft.service'
import { ServiceError } from './errors'

type SkillServiceDependencies = {
  skillRepo: typeof skillRepo
  skillPackageRepo: typeof skillPackageRepo
  resolveLegacySkillId: typeof resolveLegacySkillId
  runSkill?: (referenceId: string, input: object) => Promise<object> | object
  legacyAdapter?: LegacySkillAdapter
  legacyToDraft?: Pick<ReturnType<typeof createLegacyToDraftService>, 'preview'>
}

export function createSkillService(overrides: Partial<SkillServiceDependencies> = {}) {
  const dependencies = {
    skillRepo,
    skillPackageRepo,
    resolveLegacySkillId,
    ...overrides,
  }
  const legacyAdapter = dependencies.legacyAdapter ?? createLegacySkillAdapter({
    repo: dependencies.skillRepo,
    resolveLegacySkillId: dependencies.resolveLegacySkillId,
    runSkill: dependencies.runSkill ? (async (referenceId, input) => dependencies.runSkill!(referenceId, input)) : undefined,
  })
  const legacyToDraft = dependencies.legacyToDraft ?? createLegacyToDraftService({ legacy: legacyAdapter })

  return {
    listInstalled() {
      return legacyAdapter.listInstalled()
    },

    listMarket(input: { query?: string, limit?: number, offset?: number } = {}) {
      return legacyAdapter.listMarket(input)
    },

    install(id: unknown) {
      return legacyAdapter.install(String(id))
    },

    create(input: Record<string, unknown>) {
      const { name, description, type, source, params_schema } = input
      if (!name || !description || !type || !source) {
        throw new ServiceError('VALIDATION_ERROR', 'name, description, type, source required')
      }
      if (!['js-function', 'http-api', 'prompt-template'].includes(String(type))) {
        throw new ServiceError('VALIDATION_ERROR', 'invalid type')
      }
      return dependencies.skillRepo.create({
        name: String(name),
        description: String(description),
        type: type as 'js-function' | 'http-api' | 'prompt-template',
        source: String(source),
        params_schema: typeof params_schema === 'string' ? params_schema : undefined,
      })
    },

    get(id: string) {
      return legacyAdapter.get(id)
    },

    update(id: string, input: Record<string, unknown>) {
      return legacyAdapter.update(id, input)
    },

    remove(id: string): { kind: 'uninstalled' | 'deleted' } {
      return legacyAdapter.delete(id)
    },

    async run(referenceId: string, input: unknown) {
      const legacySkillId = dependencies.resolveLegacySkillId(referenceId)
      if (!legacySkillId || !dependencies.skillRepo.get(legacySkillId)) {
        if (dependencies.skillPackageRepo.isPackageReference(referenceId)) {
          throw new ServiceError('PACKAGE_SKILL_ASYNC_ONLY', 'Package Skills must be started through POST /skill-runs')
        }
      }
      return legacyAdapter.run(referenceId, input)
    },

    listRuns(referenceId: string, limit = 20) {
      const legacySkillId = dependencies.resolveLegacySkillId(referenceId)
      if (!legacySkillId) return []
      return legacyAdapter.listRuns(legacySkillId, limit)
    },

    migrationPreview(referenceId: string): LegacyMigrationPreview {
      return legacyToDraft.preview(referenceId)
    },
  }
}

export const skillService = createSkillService()
