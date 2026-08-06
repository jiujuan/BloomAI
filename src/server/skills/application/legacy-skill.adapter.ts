import { resolveLegacySkillId } from '../../../shared/skill-references'
import type { LegacySkillRepository, Skill } from '../../db/repositories/skill.repo'
import { skillRepo } from '../../db/repositories/skill.repo'
import { ServiceError } from '../../services/errors'
import { runSkill } from '../legacy'

export type LegacyRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type LegacyCapabilityProfile = {
  runtimeKind: 'legacy'
  capabilities: string[]
  riskLevel: LegacyRiskLevel
  canConvertToPackage: boolean
  blockers: string[]
  recommendation: string
}

export type LegacySkillView = Skill & {
  runtimeKind: 'legacy'
  capabilityProfile: LegacyCapabilityProfile
}

type LegacySkillRepositoryPort = Pick<LegacySkillRepository, 'dataPlane' | 'listInstalled' | 'listMarket' | 'get' | 'create' | 'update' | 'install' | 'uninstall' | 'delete' | 'listRuns'>
type LegacySkillAdapterDependencies = {
  repo: LegacySkillRepositoryPort
  resolveLegacySkillId: typeof resolveLegacySkillId
  runSkill: typeof runSkill
}

const LEGACY_PROFILE_BY_TYPE: Record<string, LegacyCapabilityProfile> = {
  'prompt-template': {
    runtimeKind: 'legacy',
    capabilities: ['legacy.prompt-template', 'llm.generate'],
    riskLevel: 'medium',
    canConvertToPackage: true,
    blockers: [],
    recommendation: 'Create a draft SKILL.md and review requested model capabilities before publishing.',
  },
  'http-api': {
    runtimeKind: 'legacy',
    capabilities: ['legacy.http-api', 'network.outbound'],
    riskLevel: 'high',
    canConvertToPackage: false,
    blockers: ['outbound endpoint and request policy require manual capability review'],
    recommendation: 'Keep the Legacy Skill until its endpoint, data handling, and network scope are reviewed.',
  },
  'js-function': {
    runtimeKind: 'legacy',
    capabilities: ['legacy.js-function', 'legacy.arbitrary-js'],
    riskLevel: 'critical',
    canConvertToPackage: false,
    blockers: ['arbitrary JavaScript requires manual capability review'],
    recommendation: 'Do not automatically import arbitrary JavaScript into the Package Runtime.',
  },
}

const DEFAULT_PROFILE: LegacyCapabilityProfile = {
  runtimeKind: 'legacy',
  capabilities: ['legacy.unknown'],
  riskLevel: 'high',
  canConvertToPackage: false,
  blockers: ['unknown Legacy Skill type requires manual review'],
  recommendation: 'Keep the Legacy Skill isolated until its capability contract is documented.',
}

export function getLegacyCapabilityProfile(type: string): LegacyCapabilityProfile {
  const profile = LEGACY_PROFILE_BY_TYPE[type] ?? DEFAULT_PROFILE
  return {
    ...profile,
    capabilities: [...profile.capabilities],
    blockers: [...profile.blockers],
  }
}

function requireLegacySkill(repo: LegacySkillRepositoryPort, resolveId: typeof resolveLegacySkillId, reference: string): { id: string; skill: Skill } {
  const id = resolveId(reference)
  const skill = id ? repo.get(id) : undefined
  if (!id || !skill) throw new ServiceError('NOT_FOUND', 'Skill not found')
  return { id, skill }
}

export function createLegacySkillAdapter(overrides: Partial<LegacySkillAdapterDependencies> = {}) {
  const dependencies: LegacySkillAdapterDependencies = {
    repo: skillRepo,
    resolveLegacySkillId,
    ...overrides,
    runSkill: overrides.runSkill ?? runSkill,
  }

  const view = (skill: Skill): LegacySkillView => ({
    ...skill,
    runtimeKind: 'legacy',
    capabilityProfile: getLegacyCapabilityProfile(skill.type),
  })

  return {
    listInstalled(): Skill[] {
      return dependencies.repo.listInstalled()
    },

    list(): LegacySkillView[] {
      return dependencies.repo.listInstalled().map(view)
    },

    listMarket(input: { query?: string; limit?: number; offset?: number } = {}): Skill[] {
      return dependencies.repo.listMarket(input.query, input.limit ?? 20, input.offset ?? 0)
    },

    getRaw(reference: string): Skill {
      return requireLegacySkill(dependencies.repo, dependencies.resolveLegacySkillId, reference).skill
    },

    get(reference: string): LegacySkillView {
      return view(this.getRaw(reference))
    },

    install(reference: string): LegacySkillView {
      const { id } = requireLegacySkill(dependencies.repo, dependencies.resolveLegacySkillId, reference)
      dependencies.repo.install(id)
      return view(dependencies.repo.get(id)!)
    },

    update(reference: string, input: Partial<Skill>): LegacySkillView {
      const { id } = requireLegacySkill(dependencies.repo, dependencies.resolveLegacySkillId, reference)
      const updated = dependencies.repo.update(id, input)
      if (!updated) throw new ServiceError('NOT_FOUND', 'Skill not found')
      return view(updated)
    },

    delete(reference: string): { kind: 'uninstalled' | 'deleted' } {
      const { id, skill } = requireLegacySkill(dependencies.repo, dependencies.resolveLegacySkillId, reference)
      if (skill.author === 'official') {
        dependencies.repo.uninstall(id)
        return { kind: 'uninstalled' }
      }
      dependencies.repo.delete(id)
      return { kind: 'deleted' }
    },

    async run(reference: string, input: unknown): Promise<unknown> {
      const { id } = requireLegacySkill(dependencies.repo, dependencies.resolveLegacySkillId, reference)
      try {
        return await dependencies.runSkill(id, isRecord(input) ? input : {})
      } catch (error) {
        if (error instanceof ServiceError) throw error
        throw new ServiceError('SKILL_ERROR', messageOf(error, 'Skill execution failed'))
      }
    },

    listRuns(reference: string, limit = 20): any[] {
      const { id } = requireLegacySkill(dependencies.repo, dependencies.resolveLegacySkillId, reference)
      return dependencies.repo.listRuns(id, limit)
    },

    profile(reference: string): LegacyCapabilityProfile {
      return this.get(reference).capabilityProfile
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}


export type LegacySkillAdapter = ReturnType<typeof createLegacySkillAdapter>

export const legacySkillAdapter = createLegacySkillAdapter()
