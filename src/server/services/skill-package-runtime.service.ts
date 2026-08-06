import {
  createSqliteArtifactRepository,
  createSqliteEventRepository,
  createSqliteGrantRepository,
  createSqlitePackageRepository,
  createSqliteQueueRepository,
  createSqliteRunRepository,
} from '../db/repositories/skill-package.repo'
import { ArtifactStore, ArtifactStoreError } from '../skills/artifacts'
import { PackageInstallError, PackageInstaller, type PackageInstallSource } from '../skills/packages/package-installer'
import { SkillRuntimeFeatureDisabledError } from '../skills/config/skill-runtime.config'
import { SkillRunCoordinator } from '../skills/runtime'
import { CapabilityGrantService, CapabilityGrantServiceError } from '../skills/application/capability-grant.service'
import {
  SkillRunConflictError,
  SkillRunNotFoundError,
  SkillRunTransitionError,
  SkillRunWaitingActionExpiredError,
} from '../skills/runtime/skill-run-coordinator'
import type { ArtifactRepository, CapabilityGrantRepository, PackageSkillRepository, SkillRunQueueRepository, SkillRunRepository } from '../skills/application/ports'
import { ServiceError } from './errors'

export type SkillPackageRuntimeDependencies = {
  packageRepository: PackageSkillRepository
  runRepository: SkillRunRepository
  grantRepository: CapabilityGrantRepository
  artifactRepository: ArtifactRepository
  queueRepository: SkillRunQueueRepository
  createInstaller: () => PackageInstaller
  coordinator: SkillRunCoordinator
  artifactStore: ArtifactStore
  capabilityGrantService: CapabilityGrantService
  /** @deprecated Compatibility seam for callers still assembling the old adapter. */
  repo?: Record<string, any>
}

type RuntimeServiceOverrides = Partial<SkillPackageRuntimeDependencies> & {
  /** @deprecated Use packageRepository/runRepository/grantRepository/artifactRepository. */
  repo?: Record<string, any>
}

export type StartSkillRunInput = {
  skillId?: string
  skillVersionId?: string
  input: Record<string, unknown>
  context?: Record<string, unknown>
  surface?: 'skills' | 'chat' | 'image'
  sessionId?: string
  imageSessionId?: string
  target?: { kind: 'chat' | 'image_session' | 'artifact_only', id?: string }
}

export function createSkillPackageRuntimeService(overrides: RuntimeServiceOverrides = {}) {
  const packageRepository = overrides.packageRepository ?? (overrides.repo as PackageSkillRepository | undefined) ?? createSqlitePackageRepository()
  const runRepository = overrides.runRepository ?? createSqliteRunRepository()
  const grantRepository = overrides.grantRepository ?? createSqliteGrantRepository()
  const artifactRepository = overrides.artifactRepository ?? createSqliteArtifactRepository()
  const queueRepository = overrides.queueRepository ?? createSqliteQueueRepository()
  const eventRepository = createSqliteEventRepository()
  const clock = { now: () => Date.now() }
  const capabilityGrantService = overrides.capabilityGrantService ?? new CapabilityGrantService({
    packages: packageRepository,
    runs: runRepository,
    grants: grantRepository,
    clock,
    events: eventRepository,
  })
  const dependencies: SkillPackageRuntimeDependencies = {
    ...overrides,
    packageRepository,
    runRepository,
    grantRepository,
    artifactRepository,
    queueRepository,
    capabilityGrantService,
    createInstaller: overrides.createInstaller ?? (() => new PackageInstaller()),
    coordinator: overrides.coordinator ?? new SkillRunCoordinator({
      runs: runRepository,
      events: eventRepository,
      clock,
      queue: queueRepository,
    }),
    artifactStore: overrides.artifactStore ?? new ArtifactStore(),
  }

  return {
    async inspectPackage(source: PackageInstallSource) {
      return mapRuntimeError(() => dependencies.createInstaller().inspect(source))
    },

    async installPackage(source: PackageInstallSource) {
      return mapRuntimeError(() => dependencies.createInstaller().install(source))
    },

    listPackages(page: { limit: number, offset: number }) {
      return mapRuntimeError(() => dependencies.packageRepository.listPackages(page))
    },

    getPackageDetail(id: string) {
      return mapRuntimeError(() => {
        if (dependencies.repo?.getPackage) {
          const packageRecord = dependencies.repo.getPackage(id)
          if (!packageRecord) throw new ServiceError('NOT_FOUND', 'Skill package not found')
          const versions = dependencies.repo!.listVersions(id)
          return {
            package: packageRecord,
            versions,
            installations: dependencies.repo!.listInstallations(id),
            capabilityGrants: versions.flatMap((version: any) => dependencies.repo!.listCapabilityGrants(version.id).map((grant: any) => ({
              ...grant,
              skill_version_id: version.id,
            }))),
          }
        }
        const packageRecord = dependencies.packageRepository.getPackage(id)
        if (!packageRecord) throw new ServiceError('NOT_FOUND', 'Skill package not found')
        const versions = dependencies.packageRepository.listVersions(id)
        return {
          package: packageRecord,
          versions,
          installations: dependencies.packageRepository.listInstallations(id),
          capabilityGrants: versions.flatMap((version) => dependencies.grantRepository.listCapabilityGrants(version.id).map((grant) => ({
            ...grant,
            skill_version_id: grant.skillVersionId,
          }))),
        }
      })
    },

    setInstallationEnabled(id: string, enabled: boolean) {
      return mapRuntimeError(() => {
        const installation = dependencies.packageRepository.setInstallationEnabled(id, enabled)
        if (!installation) throw new ServiceError('NOT_FOUND', 'Skill installation not found')
        return installation
      })
    },

    revokeCapabilityGrant(id: string) {
      return mapRuntimeError(() => {
        if (!dependencies.grantRepository.revokeCapabilityGrant(id)) throw new ServiceError('NOT_FOUND', 'Active capability grant not found')
        return { revoked: true }
      })
    },

    approveCapabilityGrant(id: string, input: { actor: string; scope?: unknown; expiresAt?: number | null }) {
      return mapRuntimeError(() => dependencies.capabilityGrantService.approveGrant(id, input))
    },

    rejectCapabilityGrant(id: string, input: { actor: string; reason?: string }) {
      return mapRuntimeError(() => dependencies.capabilityGrantService.rejectGrant(id, input))
    },

    revokeCapabilityGrantByActor(id: string, input: { actor: string; reason?: string }) {
      return mapRuntimeError(() => dependencies.capabilityGrantService.revokeGrant(id, input))
    },

    getRunCapabilities(runId: string) {
      return mapRuntimeError(() => dependencies.capabilityGrantService.getRunCapabilities(runId))
    },

    removeInstallation(id: string) {
      return mapRuntimeError(() => {
        const removed = dependencies.repo?.deleteInstallation ? dependencies.repo.deleteInstallation(id) : dependencies.packageRepository.deleteInstallation(id)
        if (!removed) throw new ServiceError('NOT_FOUND', 'Skill installation not found')
        return { uninstalled: true }
      })
    },

    startRun(input: StartSkillRunInput) {
      return mapRuntimeError(() => {
        const version: any = dependencies.packageRepository.resolveRunnableVersion(input.skillVersionId ?? input.skillId!)
        if (!version) throw new ServiceError('NOT_FOUND', 'Installed and enabled Package Skill was not found')
        const compatible = version.isCompatible === undefined ? version.is_compatible === 1 : version.isCompatible
        if (!compatible) throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', 'Skill version is incompatible with the Package Runtime')
        const context = { ...(input.context ?? {}), ...(input.target ? { target: input.target } : {}) }
        const started = dependencies.coordinator.startRun({
          skillVersionId: version.id,
          input: input.input,
          context,
          surface: input.surface,
          sessionId: input.sessionId,
          imageSessionId: input.imageSessionId,
        })
        const run = dependencies.coordinator.getRun(started.runId)
        dependencies.capabilityGrantService.requestCapabilities(run.id)
        return { runId: run.id, status: run.status, revision: run.revision }
      })
    },

    listRuns(page: { limit: number, offset: number, status?: string, skillVersionId?: string }) {
      return mapRuntimeError(() => {
        const result = dependencies.runRepository.listRuns(page)
        return { data: result.data.map((run) => dependencies.coordinator.getRun(run.id)), total: result.total }
      })
    },

    getRun(id: string) {
      return mapRuntimeError(() => dependencies.coordinator.getRun(id))
    },

    getRunNextAction(id: string) {
      return mapRuntimeError(() => dependencies.coordinator.getNextAction(id))
    },

    listRunEvents(id: string, afterSeq: number) {
      return mapRuntimeError(() => {
        dependencies.coordinator.getRun(id)
        return dependencies.coordinator.subscribeEvents(id, afterSeq)
      })
    },

    executeRunCommand(id: string, command: any) {
      return mapRuntimeError(() => dependencies.coordinator.dispatchCommand(id, command))
    },

    cancelRun(id: string, command: { idempotencyKey: string, expectedRevision: number, reason?: string }) {
      return mapRuntimeError(() => {
        if (typeof (dependencies.coordinator as any).requestCancel === 'function') return (dependencies.coordinator as any).requestCancel(id, command)
        return dependencies.coordinator.dispatchCommand(id, { type: 'cancel', ...command })
      })
    },

    listRunArtifacts(runId: string) {
      return mapRuntimeError(() => {
        dependencies.coordinator.getRun(runId)
        return dependencies.repo?.listArtifacts ? dependencies.repo.listArtifacts(runId) : dependencies.artifactRepository.listArtifacts(runId)
      })
    },

    readArtifactContent(artifactId: string, runId: string) {
      return mapRuntimeError(() => {
        dependencies.coordinator.getRun(runId)
        return dependencies.artifactStore.readContent({ artifactId, runId })
      })
    },

    exportArtifact(artifactId: string, runId: string, destinationDir: string) {
      return mapRuntimeError(() => {
        dependencies.coordinator.getRun(runId)
        return dependencies.artifactStore.exportArtifact({ artifactId, runId, destinationDir })
      })
    },
  }
}

function mapRuntimeError<T>(operation: () => T): T {
  try {
    const result = operation()
    if (isPromiseLike(result)) return result.catch(rethrowMappedRuntimeError) as T
    return result
  } catch (error) {
    return rethrowMappedRuntimeError(error)
  }
}

function normalizeServiceErrorDetails(details: Record<string, unknown> | undefined) {
  if (!details) return undefined
  const normalized: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(details)) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') normalized[key] = value
  }
  return normalized
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as Promise<unknown>).then === 'function'
}

function rethrowMappedRuntimeError(error: unknown): never {
  if (error instanceof ServiceError) throw error
  if (error instanceof SkillRunNotFoundError) throw new ServiceError('NOT_FOUND', error.message)
  if (error instanceof SkillRunConflictError) throw new ServiceError('REVISION_CONFLICT', error.message)
  if (error instanceof SkillRunTransitionError) throw new ServiceError('INVALID_RUN_TRANSITION', error.message)
  if (error instanceof SkillRunWaitingActionExpiredError) throw new ServiceError('WAITING_ACTION_EXPIRED', error.message)
  if (error instanceof SkillRuntimeFeatureDisabledError) throw new ServiceError('FEATURE_DISABLED', error.message, { feature: error.message.split(': ').at(-1) ?? 'unknown' })
  if (error instanceof CapabilityGrantServiceError) {
    const code = error.code === 'NOT_FOUND' ? 'NOT_FOUND'
      : error.code === 'VALIDATION_ERROR' ? 'VALIDATION_ERROR'
        : error.code === 'INVALID_GRANT_STATE' ? 'CONFLICT'
          : error.code === 'APPROVAL_REQUIRED' ? 'CAPABILITY_APPROVAL_REQUIRED'
            : error.code === 'FORBIDDEN_CAPABILITY' ? 'CAPABILITY_NOT_SUPPORTED'
              : error.code === 'OWNERSHIP_VIOLATION' ? 'FORBIDDEN'
                : error.code === 'SCOPE_EXCEEDED' ? 'FORBIDDEN'
                  : 'CAPABILITY_GRANT_ERROR'
    throw new ServiceError(code, error.message, normalizeServiceErrorDetails(error.details))
  }
  if (error instanceof PackageInstallError) {
    if (error.code === 'FEATURE_DISABLED') throw new ServiceError('FEATURE_DISABLED', error.message, { feature: error.message.split(': ').at(-1) ?? 'unknown' })
    throw new ServiceError('PACKAGE_INSTALL_ERROR', error.message)
  }
  if (error instanceof ArtifactStoreError) {
    const code = error.message.startsWith('Artifact not found') ? 'NOT_FOUND' : 'ARTIFACT_ERROR'
    throw new ServiceError(code, error.message)
  }
  throw new ServiceError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Internal server error')
}

export const skillPackageRuntimeService = createSkillPackageRuntimeService()
