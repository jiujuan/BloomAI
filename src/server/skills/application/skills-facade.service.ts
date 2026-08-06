import { skillRepo } from '../../db/repositories/skill.repo'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { resolveLegacySkillId, resolvePackageSkillId, toLegacySkillReference, toPackageSkillReference } from '../../../shared/skill-references'
import { createSkillService } from '../../services/skill.service'
import { ServiceError } from '../../services/errors'
import { getLegacyCapabilityProfile, type LegacyCapabilityProfile } from './legacy-skill.adapter'

export type SkillsFacadeRuntimeKind = 'legacy' | 'package'

export type SkillOverviewCard = {
  reference: string
  id: string
  name: string
  description: string
  sourceType: string
  version: string | null
  capabilities: string[]
  status: string
  supportedActions: string[]
  runtimeKind: SkillsFacadeRuntimeKind
  enabled: boolean
  packageId?: string
  installationId?: string
  currentVersionId?: string
  capabilityProfile?: LegacyCapabilityProfile
}

type LegacyRepository = Pick<typeof skillRepo, 'listInstalled' | 'get' | 'listRuns'>
type PackageRepository = Pick<typeof skillPackageRepo, 'listPackages' | 'getPackage' | 'listVersions' | 'listInstallations' | 'getVersion' | 'setInstallationEnabled' | 'deleteInstallation' | 'isPackageReference'>
type PackageRunStarter = (input: { skillVersionId: string; input: Record<string, unknown>; context?: Record<string, unknown>; surface?: 'skills' | 'chat' | 'image'; sessionId?: string }) => unknown

function readField<T>(value: unknown, ...keys: string[]): T | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (key in record && record[key] !== undefined) return record[key] as T
  }
  return undefined
}

function parseManifest(version: unknown): Record<string, unknown> {
  const raw = readField<unknown>(version, 'manifest', 'manifest_json')
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return {}
}

type SkillsFacadeDependencies = {
  legacy: LegacyRepository
  packages: PackageRepository
  legacyService: ReturnType<typeof createSkillService>
  startPackageRun: PackageRunStarter
}

export function createSkillsFacade(overrides: Partial<SkillsFacadeDependencies> = {}) {
  const dependencies: SkillsFacadeDependencies = {
    legacy: skillRepo,
    packages: skillPackageRepo,
    legacyService: createSkillService(),
    startPackageRun: () => { throw new ServiceError('PACKAGE_SKILL_ASYNC_ONLY', 'Package Skills require the Package Runtime queue') },
    ...overrides,
  }

  function legacyCard(skill: any): SkillOverviewCard {
    return {
      reference: toLegacySkillReference(skill.id),
      id: skill.id,
      name: skill.name,
      description: skill.description ?? '',
      sourceType: skill.type ?? 'legacy',
      version: skill.version ?? null,
      capabilities: skill.type ? [skill.type] : [],
      status: skill.is_installed === 1 ? 'installed' : 'available',
      supportedActions: skill.is_installed === 1 ? ['run', 'uninstall', 'delete'] : ['install'],
      runtimeKind: 'legacy',
      enabled: skill.is_installed === 1,
      capabilityProfile: getLegacyCapabilityProfile(skill.type),
    }
  }

  function packageCard(pkg: any): SkillOverviewCard {
    const installations = dependencies.packages.listInstallations(pkg.id)
    const installation = installations.find((item: any) => readField<string>(item, 'status') === 'installed') ?? installations[0]
    const currentVersionId = readField<string>(installation, 'currentVersionId', 'current_version_id')
    const version = currentVersionId ? dependencies.packages.getVersion(currentVersionId) : undefined
    const manifest = parseManifest(version)
    const requested = Array.isArray(manifest.requestedCapabilities) ? manifest.requestedCapabilities : []
    const enabledValue = readField<boolean | number>(installation, 'enabled')
    const sourceType = readField<string>(pkg, 'sourceType', 'source_type') ?? 'package'
    const status = readField<string>(installation, 'status') ?? 'available'
    return {
      reference: toPackageSkillReference(pkg.id),
      id: pkg.id,
      name: pkg.name,
      description: pkg.description ?? '',
      sourceType,
      version: readField<string>(version, 'version') ?? null,
      capabilities: requested.map((item: any) => typeof item === 'string' ? item : item?.capability).filter(Boolean),
      status,
      supportedActions: installation ? ['run', 'enable', 'disable', 'uninstall', 'versions'] : ['install', 'versions'],
      runtimeKind: 'package',
      enabled: enabledValue === 1 || enabledValue === true,
      packageId: pkg.id,
      installationId: installation?.id,
      currentVersionId,
    }
  }

  function findPackage(reference: string) {
    const id = resolvePackageSkillId(reference)
    return id ? dependencies.packages.getPackage(id) : undefined
  }

  return {
    list(query: { limit?: number; offset?: number; runtimeKind?: SkillsFacadeRuntimeKind; search?: string } = {}) {
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 100)
      const offset = Math.max(query.offset ?? 0, 0)
      const search = query.search?.trim().toLowerCase()
      const cards: SkillOverviewCard[] = []
      if (query.runtimeKind !== 'package') {
        for (const skill of dependencies.legacy.listInstalled()) cards.push(legacyCard(skill))
      }
      if (query.runtimeKind !== 'legacy') {
        for (const pkg of dependencies.packages.listPackages({ limit: 100, offset: 0 }).data) cards.push(packageCard(pkg))
      }
      const filtered = search ? cards.filter((card) => `${card.id} ${card.reference} ${card.name} ${card.description}`.toLowerCase().includes(search)) : cards
      return { data: filtered.slice(offset, offset + limit), total: filtered.length }
    },

    get(reference: string) {
      const pkg = findPackage(reference)
      if (pkg) return packageCard(pkg)
      const legacyId = resolveLegacySkillId(reference)
      const skill = legacyId ? dependencies.legacy.get(legacyId) : undefined
      if (skill) return legacyCard(skill)
      throw new ServiceError('NOT_FOUND', 'Skill reference not found')
    },

    enable(reference: string) {
      const pkg = findPackage(reference)
      if (pkg) {
        const installation = dependencies.packages.listInstallations(pkg.id)[0]
        if (!installation) throw new ServiceError('NOT_FOUND', 'Package installation not found')
        const updated = dependencies.packages.setInstallationEnabled(installation.id, true)
        if (!updated) throw new ServiceError('NOT_FOUND', 'Package installation not found')
        return packageCard(pkg)
      }
      throw new ServiceError('VALIDATION_ERROR', 'Legacy Skills use install/uninstall semantics')
    },

    disable(reference: string) {
      const pkg = findPackage(reference)
      if (pkg) {
        const installation = dependencies.packages.listInstallations(pkg.id)[0]
        if (!installation) throw new ServiceError('NOT_FOUND', 'Package installation not found')
        const updated = dependencies.packages.setInstallationEnabled(installation.id, false)
        if (!updated) throw new ServiceError('NOT_FOUND', 'Package installation not found')
        return packageCard(pkg)
      }
      throw new ServiceError('VALIDATION_ERROR', 'Legacy Skills cannot be disabled without uninstalling')
    },

    uninstall(reference: string) {
      const pkg = findPackage(reference)
      if (pkg) {
        const installation = dependencies.packages.listInstallations(pkg.id)[0]
        if (!installation || !dependencies.packages.deleteInstallation(installation.id)) throw new ServiceError('NOT_FOUND', 'Package installation not found')
        return { kind: 'uninstalled' as const, reference: toPackageSkillReference(pkg.id) }
      }
      const legacyId = resolveLegacySkillId(reference)
      if (!legacyId || !dependencies.legacy.get(legacyId)) throw new ServiceError('NOT_FOUND', 'Skill reference not found')
      const result = dependencies.legacyService.remove(legacyId)
      return { ...result, reference: toLegacySkillReference(legacyId) }
    },

    async startRun(reference: string, input: Record<string, unknown>, options: { context?: Record<string, unknown>; surface?: 'skills' | 'chat' | 'image'; sessionId?: string } = {}) {
      const pkg = findPackage(reference)
      if (pkg) {
        const installation = dependencies.packages.listInstallations(pkg.id).find((item: any) => item.enabled)
        if (!installation) throw new ServiceError('FEATURE_DISABLED', 'Package Skill installation is disabled')
        const currentVersionId = readField<string>(installation, 'currentVersionId', 'current_version_id')
        if (!currentVersionId) throw new ServiceError('SKILL_ERROR', 'Package Skill installation has no current version')
        return dependencies.startPackageRun({ skillVersionId: currentVersionId, input, ...options })
      }
      const legacyId = resolveLegacySkillId(reference)
      if (!legacyId || !dependencies.legacy.get(legacyId)) throw new ServiceError('NOT_FOUND', 'Skill reference not found')
      return dependencies.legacyService.run(legacyId, input)
    },

    listRuns(reference: string, limit = 20) {
      const pkg = findPackage(reference)
      if (pkg) return { runtimeKind: 'package' as const, data: [] }
      const legacyId = resolveLegacySkillId(reference)
      if (!legacyId) throw new ServiceError('NOT_FOUND', 'Skill reference not found')
      return { runtimeKind: 'legacy' as const, data: dependencies.legacy.listRuns(legacyId, Math.min(Math.max(limit, 1), 100)) }
    },
  }
}

export const skillsFacade = createSkillsFacade({
  startPackageRun: (input) => {
    // Lazy import keeps the Legacy adapter independent from the Package Runtime service.
    const { skillPackageRuntimeService } = require('../../services/skill-package-runtime.service') as typeof import('../../services/skill-package-runtime.service')
    return skillPackageRuntimeService.startRun(input)
  },
})
