import {
  createSqliteArtifactRepository,
  createSqliteEventRepository,
  createSqliteGrantRepository,
  createSqlitePackageRepository,
  createSqliteQueueRepository,
  createSqliteRunRepository,
  createSqliteAuditRepository,
} from '../db/repositories/skill-package.repo'
import { ArtifactStore, ArtifactStoreError, type ArtifactListOptions } from '../skills/artifacts'
import { PackageInstallError, PackageInstaller, type PackageInstallOptions, type PackageInstallSource } from '../skills/packages/package-installer'
import { PackageInstallReviewError, packageInstallReviewService } from '../skills/packages/package-install-review.service'
import { SkillRuntimeFeatureDisabledError } from '../skills/config/skill-runtime.config'
import { SkillRunCoordinator } from '../skills/runtime'
import { CapabilityGrantService, CapabilityGrantServiceError } from '../skills/application/capability-grant.service'
import { createSkillVersionService, type SkillVersionCandidate } from '../skills/application/skill-version.service'
import { createSkillLifecycleService } from '../skills/application/skill-lifecycle.service'
import {
  SkillRunConflictError,
  SkillRunNotFoundError,
  SkillRunTransitionError,
  SkillRunWaitingActionExpiredError,
} from '../skills/runtime/skill-run-coordinator'
import type { ArtifactRepository, AuditRepository, CapabilityGrantRepository, PackageSkillRepository, SkillRunQueueRepository, SkillRunRepository } from '../skills/application/ports'
import { ServiceError } from './errors'
import { isLegacySkillReference } from '../../shared/skill-references'
import { SkillRuntimeMetrics, recordMigrationMetric } from '../skills/observability/skill-runtime.metrics'
import { getSkillCorrelation } from '../skills/observability/skill-runtime.logger'

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
  metrics: SkillRuntimeMetrics
  audit?: AuditRepository
  /** @deprecated Compatibility seam for callers still assembling the old adapter. */
  repo?: Record<string, any>
}

type RuntimeServiceOverrides = Partial<SkillPackageRuntimeDependencies> & {
  /** @deprecated Use packageRepository/runRepository/grantRepository/artifactRepository. */
  repo?: Record<string, any>
}

type SkillAuditContext = { actor?: string | null; requestId?: string }

export type StartSkillRunInput = {
  skillId?: string
  skillVersionId?: string
  input: Record<string, unknown>
  context?: Record<string, unknown>
  surface?: 'skills' | 'chat' | 'image'
  sessionId?: string
  imageSessionId?: string
  target?: { kind: 'chat' | 'image_session' | 'artifact_only', id?: string }
  actor?: string | null
  requestId?: string
}

export function createSkillPackageRuntimeService(overrides: RuntimeServiceOverrides = {}) {
  const packageRepository = overrides.packageRepository ?? (overrides.repo as PackageSkillRepository | undefined) ?? createSqlitePackageRepository()
  const runRepository = overrides.runRepository ?? createSqliteRunRepository()
  const grantRepository = overrides.grantRepository ?? createSqliteGrantRepository()
  const artifactRepository = overrides.artifactRepository ?? createSqliteArtifactRepository()
  const queueRepository = overrides.queueRepository ?? createSqliteQueueRepository()
  const metrics = overrides.metrics ?? SkillRuntimeMetrics.global()
  const eventRepository = createSqliteEventRepository()
  const auditRepository = overrides.audit ?? createSqliteAuditRepository()
  const clock = { now: () => Date.now() }
  const capabilityGrantService = overrides.capabilityGrantService ?? new CapabilityGrantService({
    packages: packageRepository,
    runs: runRepository,
    grants: grantRepository,
    clock,
    events: eventRepository,
    audit: auditRepository,
  })
  const skillLifecycleService = createSkillLifecycleService({
    packages: packageRepository,
    runs: runRepository,
    audit: auditRepository,
    clock,
    capabilityGrantService,
  })
  const skillVersionService = createSkillVersionService({
    packages: packageRepository,
    runs: { listRuns: (options) => runRepository.listRuns(options) },
    grants: { listCapabilityGrants: (skillVersionId, options) => grantRepository.listCapabilityGrants(skillVersionId, options as any) },
    capabilityGrantService,
  })

  const dependencies: SkillPackageRuntimeDependencies = {
    ...overrides,
    packageRepository,
    runRepository,
    grantRepository,
    artifactRepository,
    queueRepository,
    capabilityGrantService,
    metrics,
    createInstaller: overrides.createInstaller ?? (() => new PackageInstaller()),
    coordinator: overrides.coordinator ?? new SkillRunCoordinator({
      runs: runRepository,
      events: eventRepository,
      clock,
      queue: queueRepository,
    }),
    artifactStore: overrides.artifactStore ?? new ArtifactStore(),
  }

  const mapRuntime = <T>(operation: () => T, operationName = 'unknown'): T => mapRuntimeError(operation, operationName, dependencies.metrics)

  const appendAudit = (
    action: string,
    resourceType: string,
    resourceId: string | null | undefined,
    context: SkillAuditContext | undefined,
    payload: Record<string, unknown> = {},
    sourceFingerprint?: string | null,
  ) => {
    auditRepository.append({
      actor: context?.actor ?? null,
      action,
      resourceType,
      resourceId: resourceId ?? null,
      securityDecision: 'allowed',
      policyVersion: 'skills-admin-v1.2',
      sourceFingerprint: sourceFingerprint ?? null,
      payload: { ...payload, ...(context?.requestId ? { requestId: context.requestId } : {}) },
    })
  }

  return {
    async inspectPackage(source: PackageInstallSource, context?: SkillAuditContext) {
      const result = await mapRuntime(() => dependencies.createInstaller().inspect(source), 'inspect')
      appendAudit('skill.package.inspect', 'skill_import_review', result.reviewId, context, {
        packageCount: result.packages.length,
        sourceType: result.packages[0]?.sourceType ?? source.kind,
      }, result.sourceFingerprint)
      return result
    },

    async installPackage(source: PackageInstallSource, options: PackageInstallOptions, context?: SkillAuditContext) {
      let reviewWasInstalled = false
      try { reviewWasInstalled = packageInstallReviewService.get(options.reviewId).status === 'installed' } catch { /* installer maps the authoritative review error */ }
      const result = await mapRuntime(() => dependencies.createInstaller().install(source, options), 'install')
      if (!reviewWasInstalled) {
        for (const installed of result.packages) {
          appendAudit('skill.package.imported', 'skill_package', installed.packageId, context, {
            reviewId: options.reviewId,
            versionId: installed.versionId,
            installationId: installed.installationId,
            status: result.status,
          }, options.sourceFingerprint)
        }
      }
      return result
    },

    getImportReview(id: string) {
      return mapRuntime(() => packageInstallReviewService.get(id), 'inspect')
    },

    approveImportReview(id: string, reviewer: string, context?: SkillAuditContext) {
      const result = recordApprovalMetricSafely('approve', dependencies.metrics, () => mapRuntime(() => packageInstallReviewService.approve(id, reviewer), 'approve'))
      appendAudit('skill.import.review.approved', 'skill_import_review', id, context, { reviewer })
      return result
    },

    rejectImportReview(id: string, reviewer: string, reason?: string, context?: SkillAuditContext) {
      const result = recordApprovalMetricSafely('reject', dependencies.metrics, () => mapRuntime(() => packageInstallReviewService.reject(id, reviewer, reason), 'reject'))
      appendAudit('skill.import.review.rejected', 'skill_import_review', id, context, { reviewer, reason: reason ?? null })
      return result
    },

    listPackages(page: { limit: number, offset: number; includeArchived?: boolean; search?: string; sourceType?: string; sort?: 'updatedAt' | 'createdAt' | 'name' | 'sourceType'; direction?: 'asc' | 'desc' }) {
      return mapRuntime(() => dependencies.packageRepository.listPackages(page))
    },

    listInstallations(page: { limit: number; offset: number }) {
      return mapRuntime(() => {
        if (!dependencies.packageRepository.listAllInstallations) return { data: [], total: 0 }
        return dependencies.packageRepository.listAllInstallations(page)
      })
    },

    listVersions(packageId: string) {
      return mapRuntime(() => skillVersionService.listVersions(packageId))
    },

    getVersion(versionId: string) {
      return mapRuntime(() => skillVersionService.getVersion(versionId))
    },

    diffVersions(fromVersionId: string, toVersionId: string) {
      return mapRuntime(() => skillVersionService.diffVersions(fromVersionId, toVersionId))
    },

    previewVersionUpdate(packageId: string, candidate: SkillVersionCandidate) {
      return mapRuntime(() => skillVersionService.previewUpdate(packageId, candidate))
    },

    async updatePackageVersion(packageId: string, candidate: SkillVersionCandidate, context?: SkillAuditContext) {
      const result = await mapRuntime(() => skillVersionService.updatePackage(packageId, candidate))
      if (!result.duplicate) {
        appendAudit('skill.package.version.created', 'skill_version', result.version.id, context, {
          packageId,
          version: result.version.version,
          currentVersionId: result.currentVersionId,
        })
      }
      return result
    },

    switchCurrentVersion(installationId: string, versionId: string, options: { expectedRevision: number; idempotencyKey: string; actor?: string; requestId?: string }) {
      const duplicate = dependencies.packageRepository.getInstallationCommandResult?.(installationId, options.idempotencyKey)
      const result = mapRuntime(() => skillVersionService.switchCurrent(installationId, versionId, options))
      if (!duplicate) {
        appendAudit('skill.installation.version_switched', 'skill_installation', installationId, options, {
          expectedRevision: options.expectedRevision,
          newRevision: result.revision ?? options.expectedRevision,
          currentVersionId: result.currentVersionId,
          previousVersionId: result.previousVersionId ?? null,
        })
      }
      return result
    },

    getPackageDetail(id: string) {
      return mapRuntime(() => {
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
      return mapRuntime(() => {
        const installation = dependencies.packageRepository.setInstallationEnabled(id, enabled)
        if (!installation) throw new ServiceError('NOT_FOUND', 'Skill installation not found')
        return installation
      })
    },

    setInstallationEnabledWithRevision(id: string, enabled: boolean, options: { expectedRevision: number; idempotencyKey: string; actor?: string; requestId?: string }) {
      return mapRuntime(() => enabled
        ? skillLifecycleService.enableInstallation(id, options)
        : skillLifecycleService.disableInstallation(id, options))
    },

    uninstallInstallation(id: string, options: { expectedRevision: number; idempotencyKey: string; actor?: string; requestId?: string }) {
      return mapRuntime(() => skillLifecycleService.uninstallInstallation(id, options))
    },

    rollbackInstallation(id: string, input: { versionId?: string; expectedRevision: number; idempotencyKey: string; reason: string; actor?: string; requestId?: string }) {
      return mapRuntime(() => skillLifecycleService.rollbackInstallation(id, input))
    },

    deletePackage(id: string, input: { confirm: boolean; idempotencyKey: string; reason: string; actor?: string; requestId?: string }) {
      return mapRuntime(() => skillLifecycleService.requestDeletePackage(id, input))
    },

    revokeCapabilityGrant(id: string, input: { actor: string; reason?: string; requestId?: string }) {
      return mapRuntime(() => dependencies.capabilityGrantService.revokeGrant(id, input), 'capability')
    },

    approveCapabilityGrant(id: string, input: { actor: string; scope?: unknown; expiresAt?: number | null; reason?: string; requestId?: string }) {
      return mapRuntime(() => dependencies.capabilityGrantService.approveGrant(id, input), 'capability')
    },

    rejectCapabilityGrant(id: string, input: { actor: string; reason?: string; requestId?: string }) {
      return mapRuntime(() => dependencies.capabilityGrantService.rejectGrant(id, input), 'capability')
    },

    revokeCapabilityGrantByActor(id: string, input: { actor: string; reason?: string; requestId?: string }) {
      return mapRuntime(() => dependencies.capabilityGrantService.revokeGrant(id, input), 'capability')
    },

    getRunCapabilities(runId: string) {
      return mapRuntime(() => dependencies.capabilityGrantService.getRunCapabilities(runId), 'capability')
    },

    removeInstallation(id: string) {
      return mapRuntime(() => {
        const removed = dependencies.repo?.deleteInstallation ? dependencies.repo.deleteInstallation(id) : dependencies.packageRepository.deleteInstallation(id)
        if (!removed) throw new ServiceError('NOT_FOUND', 'Skill installation not found')
        return { uninstalled: true }
      })
    },

    startRun(input: StartSkillRunInput) {
      return mapRuntime(() => {
        const reference = input.skillVersionId ?? input.skillId
        if (reference && isLegacySkillReference(reference)) {
          recordMigrationMetric('legacy_run_blocked')
          throw new ServiceError('LEGACY_SKILL_RUN_DISABLED', 'Legacy Skill execution is disabled; migrate it to a Package Skill before running', {
            legacyReference: reference,
            migrationAction: 'preview-legacy-skill-migration',
          })
        }
        const version: any = dependencies.packageRepository.resolveRunnableVersion(reference!)
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
        recordMigrationMetric('package_run_started')
        const run = dependencies.coordinator.getRun(started.runId)
        dependencies.capabilityGrantService.requestCapabilities(run.id)
        appendAudit('skill.run.created', 'skill_run', run.id, input, {
          skillVersionId: run.skillVersionId,
          surface: run.surface,
          trigger: input.target?.kind ?? input.surface ?? 'skills',
        })
        return { runId: run.id, status: run.status, revision: run.revision }
      })
    },

    listRuns(page: { limit: number, offset: number, status?: string, skillVersionId?: string }) {
      return mapRuntime(() => {
        const result = dependencies.runRepository.listRuns(page)
        return { data: result.data.map((run) => dependencies.coordinator.getRun(run.id)), total: result.total }
      })
    },

    getRun(id: string) {
      return mapRuntime(() => dependencies.coordinator.getRun(id))
    },

    findChatRunByIdempotency(sessionId: string, idempotencyKey: string) {
      return mapRuntime(() => dependencies.runRepository.findChatRunByIdempotency?.(sessionId, idempotencyKey))
    },

    getRunNextAction(id: string) {
      return mapRuntime(() => dependencies.coordinator.getNextAction(id))
    },

    listRunEvents(id: string, afterSeq: number) {
      return mapRuntime(() => {
        dependencies.coordinator.getRun(id)
        return dependencies.coordinator.subscribeEvents(id, afterSeq).sort((left, right) => left.seq - right.seq)
      })
    },

    executeRunCommand(id: string, command: any, context?: SkillAuditContext) {
      const idempotencyKey = typeof command?.idempotencyKey === 'string' ? command.idempotencyKey : undefined
      const duplicate = idempotencyKey ? dependencies.runRepository.getCommandResult(id, idempotencyKey) : undefined
      const result = mapRuntime(() => dependencies.coordinator.dispatchCommand(id, command), 'run')
      if (!duplicate) {
        appendAudit('skill.run.command', 'skill_run', id, context, {
          type: command?.type ?? null,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        })
      }
      return result
    },

    cancelRun(id: string, command: { idempotencyKey: string, expectedRevision: number, reason?: string }, context?: SkillAuditContext) {
      const duplicate = dependencies.runRepository.getCommandResult(id, command.idempotencyKey)
      const result = mapRuntime(() => {
        if (typeof (dependencies.coordinator as any).requestCancel === 'function') return (dependencies.coordinator as any).requestCancel(id, command)
        return dependencies.coordinator.dispatchCommand(id, { type: 'cancel', ...command })
      }, 'run')
      if (!duplicate) {
        appendAudit('skill.run.cancel_requested', 'skill_run', id, context, {
          reason: command.reason ?? null,
          idempotencyKey: command.idempotencyKey,
        })
      }
      return result
    },

    listRunArtifacts(runId: string, options?: ArtifactListOptions) {
      return mapRuntime(() => {
        dependencies.coordinator.getRun(runId)
        if (options) return dependencies.artifactStore.listArtifacts({ runId, ...options })
        return dependencies.repo?.listArtifacts ? dependencies.repo.listArtifacts(runId) : dependencies.artifactRepository.listArtifacts(runId)
      })
    },

    readArtifactContent(artifactId: string, runId: string) {
      return mapRuntime(() => {
        dependencies.coordinator.getRun(runId)
        return dependencies.artifactStore.readContent({ artifactId, runId })
      }, 'artifact')
    },

    exportArtifact(artifactId: string, runId: string, destinationDir: string, options: { confirmed: true; actor?: string; auditReason: string; requestId?: string }) {
      return mapRuntime(() => {
        dependencies.coordinator.getRun(runId)
        return dependencies.artifactStore.exportArtifact({ artifactId, runId, destinationDir, confirmed: options.confirmed, actor: options.actor, auditReason: options.auditReason, requestId: options.requestId })
      }, 'artifact')
    },
  }
}

function mapRuntimeError<T>(operation: () => T, operationName = 'unknown', metrics = SkillRuntimeMetrics.global()): T {
  const mapAndRecord = (error: unknown): never => {
    const mapped = mapRuntimeErrorValue(error)
    try {
      metrics.recordError({ code: mapped.code, operation: operationName, correlation: getSkillCorrelation() })
    } catch {
      // Observability must never change the mapped runtime error.
    }
    throw mapped
  }

  try {
    const result = operation()
    if (isPromiseLike(result)) return result.catch(mapAndRecord) as T
    return result
  } catch (error) {
    return mapAndRecord(error)
  }
}

function recordApprovalMetricSafely<T>(action: 'approve' | 'reject', metrics: SkillRuntimeMetrics, operation: () => T): T {
  const startedAt = Date.now()
  const record = (outcome: 'success' | 'error') => {
    try {
      metrics.recordApproval({
        action,
        outcome,
        durationMs: Math.max(0, Date.now() - startedAt),
        correlation: getSkillCorrelation(),
      })
    } catch {
      // Approval business results must not depend on observability.
    }
  }

  try {
    const result = operation()
    if (isPromiseLike(result)) {
      return result.then((value) => {
        record('success')
        return value
      }, (error) => {
        record('error')
        throw error
      }) as T
    }
    record('success')
    return result
  } catch (error) {
    record('error')
    throw error
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

function mapRuntimeErrorValue(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error
  if (error instanceof SkillRunNotFoundError) return new ServiceError('NOT_FOUND', error.message)
  if (error instanceof SkillRunConflictError) return new ServiceError('REVISION_CONFLICT', error.message)
  if (error instanceof SkillRunTransitionError) return new ServiceError('INVALID_RUN_TRANSITION', error.message)
  if (error instanceof SkillRunWaitingActionExpiredError) return new ServiceError('WAITING_ACTION_EXPIRED', error.message)
  if (error instanceof SkillRuntimeFeatureDisabledError) return new ServiceError('FEATURE_DISABLED', error.message, { feature: error.message.split(': ').at(-1) ?? 'unknown' })
  if (error instanceof CapabilityGrantServiceError) {
    const code = error.code === 'NOT_FOUND' ? 'NOT_FOUND'
      : error.code === 'VALIDATION_ERROR' ? 'VALIDATION_ERROR'
        : error.code === 'INVALID_GRANT_STATE' ? 'CONFLICT'
          : error.code === 'APPROVAL_REQUIRED' ? 'CAPABILITY_APPROVAL_REQUIRED'
            : error.code === 'FORBIDDEN_CAPABILITY' ? 'CAPABILITY_NOT_SUPPORTED'
              : error.code === 'OWNERSHIP_VIOLATION' ? 'FORBIDDEN'
                : error.code === 'SCOPE_EXCEEDED' ? 'FORBIDDEN'
                  : 'CAPABILITY_GRANT_ERROR'
    return new ServiceError(code, error.message, normalizeServiceErrorDetails(error.details))
  }
  if (error instanceof PackageInstallReviewError) {
    const code = error.code === 'REVIEW_NOT_FOUND' ? 'NOT_FOUND' : 'PACKAGE_INSTALL_ERROR'
    return new ServiceError(code, error.message, { reviewCode: error.code })
  }
  if (error instanceof PackageInstallError) {
    if (error.code === 'FEATURE_DISABLED') return new ServiceError('FEATURE_DISABLED', error.message, { feature: error.message.split(': ').at(-1) ?? 'unknown' })
    return new ServiceError('PACKAGE_INSTALL_ERROR', error.message, { providerCode: error.code })
  }
  if (error instanceof ArtifactStoreError) {
    const code = error.message.startsWith('Artifact not found') ? 'NOT_FOUND' : 'ARTIFACT_ERROR'
    return new ServiceError(code, error.message)
  }
  return new ServiceError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Internal server error')
}

export const skillPackageRuntimeService = createSkillPackageRuntimeService()
