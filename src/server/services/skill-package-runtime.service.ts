import { skillPackageRepo } from '../db/repositories/skill-package.repo'
import { ArtifactStore, ArtifactStoreError } from '../skills/artifacts'
import { PackageInstallError, PackageInstaller, type PackageInstallSource } from '../skills/packages/package-installer'
import { SkillRunCoordinator } from '../skills/runtime'
import {
  SkillRunConflictError,
  SkillRunNotFoundError,
  SkillRunTransitionError,
} from '../skills/runtime/skill-run-coordinator'
import { ServiceError } from './errors'

type SkillPackageRuntimeDependencies = {
  repo: typeof skillPackageRepo
  createInstaller: () => PackageInstaller
  coordinator: SkillRunCoordinator
  artifactStore: ArtifactStore
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

export function createSkillPackageRuntimeService(overrides: Partial<SkillPackageRuntimeDependencies> = {}) {
  const dependencies: SkillPackageRuntimeDependencies = {
    repo: skillPackageRepo,
    createInstaller: () => new PackageInstaller(),
    coordinator: new SkillRunCoordinator(),
    artifactStore: new ArtifactStore(),
    ...overrides,
  }

  return {
    async inspectPackage(source: PackageInstallSource) {
      return mapRuntimeError(() => dependencies.createInstaller().inspect(source))
    },

    async installPackage(source: PackageInstallSource) {
      return mapRuntimeError(() => dependencies.createInstaller().install(source))
    },

    listPackages(page: { limit: number, offset: number }) {
      return mapRuntimeError(() => dependencies.repo.listPackages(page))
    },

    getPackageDetail(id: string) {
      return mapRuntimeError(() => {
        const packageRecord = dependencies.repo.getPackage(id)
        if (!packageRecord) throw new ServiceError('NOT_FOUND', 'Skill package not found')
        const versions = dependencies.repo.listVersions(id)
        return {
          package: packageRecord,
          versions,
          installations: dependencies.repo.listInstallations(id),
          capabilityGrants: versions.flatMap((version) => dependencies.repo.listCapabilityGrants(version.id).map((grant) => ({
            ...grant,
            skill_version_id: version.id,
          }))),
        }
      })
    },

    setInstallationEnabled(id: string, enabled: boolean) {
      return mapRuntimeError(() => {
        const installation = dependencies.repo.setInstallationEnabled(id, enabled)
        if (!installation) throw new ServiceError('NOT_FOUND', 'Skill installation not found')
        return installation
      })
    },

    revokeCapabilityGrant(id: string) {
      return mapRuntimeError(() => {
        if (!dependencies.repo.revokeCapabilityGrant(id)) throw new ServiceError('NOT_FOUND', 'Active capability grant not found')
        return { revoked: true }
      })
    },

    removeInstallation(id: string) {
      return mapRuntimeError(() => {
        if (!dependencies.repo.deleteInstallation(id)) throw new ServiceError('NOT_FOUND', 'Skill installation not found')
        return { uninstalled: true }
      })
    },

    startRun(input: StartSkillRunInput) {
      return mapRuntimeError(() => {
        const version = dependencies.repo.resolveRunnableVersion(input.skillVersionId ?? input.skillId!)
        if (!version) throw new ServiceError('NOT_FOUND', 'Installed and enabled Package Skill was not found')
        if (version.is_compatible !== 1) throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', 'Skill version is incompatible with the Package Runtime')
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
        return { runId: run.id, status: run.status, revision: run.revision }
      })
    },

    listRuns(page: { limit: number, offset: number, status?: string, skillVersionId?: string }) {
      return mapRuntimeError(() => {
        const result = dependencies.repo.listRuns(page)
        return { data: result.data.map((run) => dependencies.coordinator.getRun(run.id)), total: result.total }
      })
    },

    getRun(id: string) {
      return mapRuntimeError(() => dependencies.coordinator.getRun(id))
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

    cancelRun(id: string, command: { idempotencyKey: string, expectedRevision: number }) {
      return mapRuntimeError(() => dependencies.coordinator.dispatchCommand(id, { type: 'cancel', ...command }))
    },

    listRunArtifacts(runId: string) {
      return mapRuntimeError(() => {
        dependencies.coordinator.getRun(runId)
        return dependencies.repo.listArtifacts(runId)
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

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as Promise<unknown>).then === 'function'
}

function rethrowMappedRuntimeError(error: unknown): never {
  if (error instanceof ServiceError) throw error
  if (error instanceof SkillRunNotFoundError) throw new ServiceError('NOT_FOUND', error.message)
  if (error instanceof SkillRunConflictError) throw new ServiceError('REVISION_CONFLICT', error.message)
  if (error instanceof SkillRunTransitionError) throw new ServiceError('INVALID_RUN_TRANSITION', error.message)
  if (error instanceof PackageInstallError) throw new ServiceError('PACKAGE_INSTALL_ERROR', error.message)
  if (error instanceof ArtifactStoreError) {
    const code = error.message.startsWith('Artifact not found') ? 'NOT_FOUND' : 'ARTIFACT_ERROR'
    throw new ServiceError(code, error.message)
  }
  throw new ServiceError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Internal server error')
}

export const skillPackageRuntimeService = createSkillPackageRuntimeService()