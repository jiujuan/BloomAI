import { skillRepo } from '../db/repositories/skill.repo'
import { skillPackageRepo } from '../db/repositories/skill-package.repo'
import { resolveLegacySkillId } from '../../shared/skill-references'
import { runSkill } from '../skills/legacy'
import { ServiceError } from './errors'

type SkillServiceDependencies = {
  skillRepo: typeof skillRepo
  skillPackageRepo: typeof skillPackageRepo
  resolveLegacySkillId: typeof resolveLegacySkillId
  runSkill: typeof runSkill
}

export function createSkillService(overrides: Partial<SkillServiceDependencies> = {}) {
  const dependencies: SkillServiceDependencies = {
    skillRepo,
    skillPackageRepo,
    resolveLegacySkillId,
    runSkill,
    ...overrides,
  }

  return {
    listInstalled() {
      return dependencies.skillRepo.listInstalled()
    },

    listMarket(input: { query?: string, limit?: number, offset?: number } = {}) {
      return dependencies.skillRepo.listMarket(input.query || undefined, input.limit ?? 20, input.offset ?? 0)
    },

    install(id: unknown) {
      if (!dependencies.skillRepo.get(id as string)) throw new ServiceError('NOT_FOUND', 'Skill not found')
      dependencies.skillRepo.install(id as string)
      return dependencies.skillRepo.get(id as string)
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
      const skill = dependencies.skillRepo.get(id)
      if (!skill) throw new ServiceError('NOT_FOUND', 'Skill not found')
      return skill
    },

    update(id: string, input: Record<string, unknown>) {
      const skill = dependencies.skillRepo.update(id, input)
      if (!skill) throw new ServiceError('NOT_FOUND', 'Skill not found')
      return skill
    },

    remove(id: string): { kind: 'uninstalled' | 'deleted' } {
      const skill = dependencies.skillRepo.get(id)
      if (!skill) throw new ServiceError('NOT_FOUND', 'Skill not found')
      if (skill.author === 'official') {
        dependencies.skillRepo.uninstall(id)
        return { kind: 'uninstalled' }
      }
      dependencies.skillRepo.delete(id)
      return { kind: 'deleted' }
    },

    async run(referenceId: string, input: unknown) {
      try {
        const legacySkillId = dependencies.resolveLegacySkillId(referenceId)
        if (!legacySkillId || !dependencies.skillRepo.get(legacySkillId)) {
          if (dependencies.skillPackageRepo.isPackageReference(referenceId)) {
            throw new ServiceError('PACKAGE_SKILL_ASYNC_ONLY', 'Package Skills must be started through POST /skill-runs')
          }
        }
        return await dependencies.runSkill(referenceId, isRecord(input) ? input : {})
      } catch (error) {
        if (error instanceof ServiceError) throw error
        throw new ServiceError('SKILL_ERROR', messageOf(error, 'Skill execution failed'))
      }
    },

    listRuns(referenceId: string, limit = 20) {
      const legacySkillId = dependencies.resolveLegacySkillId(referenceId)
      if (!legacySkillId) return []
      return dependencies.skillRepo.listRuns(legacySkillId, limit)
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export const skillService = createSkillService()