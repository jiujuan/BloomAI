import { skillRepo } from '../db/repositories/skill.repo'
import { skillPackageRepo } from '../db/repositories/skill-package.repo'
import { resolveLegacySkillId, PACKAGE_SKILL_REFERENCE_PREFIX } from '../../shared/skill-references'
import { createLegacySkillAdapter, type LegacySkillAdapter } from '../skills/application/legacy-skill.adapter'
import { createLegacyToDraftService, type LegacyMigrationPreview } from '../skills/creator/legacy-to-draft.service'
import { assertLegacyReadOnly, assertLegacyRunDisabled } from '../skills/legacy/registry'
import { ServiceError } from './errors'
import { recordMigrationMetric } from '../skills/observability/skill-runtime.metrics'

type SkillServiceDependencies = {
  skillRepo: typeof skillRepo
  skillPackageRepo: typeof skillPackageRepo
  resolveLegacySkillId: typeof resolveLegacySkillId
  /** @deprecated Legacy execution is no longer called by this service. */
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

    create(_input: Record<string, unknown>) {
      assertLegacyReadOnly()
      throw new ServiceError('LEGACY_SKILL_FROZEN', 'Legacy Skills are frozen and read-only')
    },

    get(id: string) {
      return legacyAdapter.get(id)
    },

    update(id: string, input: Record<string, unknown>) {
      return legacyAdapter.update(id, input)
    },

    remove(id: string): never {
      return legacyAdapter.delete(id)
    },

    async run(referenceId: string, _input: unknown): Promise<never> {
      if (referenceId.startsWith(PACKAGE_SKILL_REFERENCE_PREFIX) || dependencies.skillPackageRepo.isPackageReference(referenceId)) {
        throw new ServiceError('PACKAGE_SKILL_ASYNC_ONLY', 'Package Skills must be started through POST /skill-runs')
      }
      const legacySkillId = dependencies.resolveLegacySkillId(referenceId)
      if (!legacySkillId || !dependencies.skillRepo.get(legacySkillId)) {
        throw new ServiceError('NOT_FOUND', 'Skill not found')
      }
      recordMigrationMetric('legacy_run_blocked')
      assertLegacyRunDisabled()
      throw new ServiceError('LEGACY_SKILL_RUN_DISABLED', 'Legacy Skill execution is disabled')
    },

    listRuns(referenceId: string, limit = 20) {
      if (referenceId.startsWith(PACKAGE_SKILL_REFERENCE_PREFIX)) {
        throw new ServiceError('NOT_FOUND', 'Skill not found')
      }
      const legacySkillId = dependencies.resolveLegacySkillId(referenceId)
      if (!legacySkillId) throw new ServiceError('NOT_FOUND', 'Skill not found')
      return legacyAdapter.listRuns(legacySkillId, limit)
    },

    migrationPreview(referenceId: string): LegacyMigrationPreview {
      return legacyToDraft.preview(referenceId)
    },
  }
}

export const skillService = createSkillService()
