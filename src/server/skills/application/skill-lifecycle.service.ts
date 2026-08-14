import { ServiceError } from '../../services/errors'
import type { AuditRepository, Clock, InstallationSnapshot, PackageSkillRepository, PackageSnapshot, SkillRunRepository, VersionSnapshot } from './ports'

type CapabilityVersionRevalidator = {
  revalidateVersion(versionId: string): { safe: boolean; findings?: readonly { capability: string; reason: string }[] }
}

type LifecycleDependencies = {
  packages: PackageSkillRepository
  runs?: Pick<SkillRunRepository, 'listRuns'>
  audit?: AuditRepository
  clock?: Clock
  capabilityGrantService?: CapabilityVersionRevalidator
}

type AuditContext = {
  actor?: string | null
  requestId?: string
}

type InstallationCommandOptions = {
  expectedRevision: number
  idempotencyKey: string
} & AuditContext

type DeletePackageOptions = {
  confirm: boolean
  idempotencyKey: string
  reason: string
} & AuditContext

const ACTIVE_RUN_STATUSES = new Set(['created', 'validating', 'running', 'waiting_input', 'waiting_approval'])

export function createSkillLifecycleService(dependencies: LifecycleDependencies) {
  const clock = dependencies.clock ?? { now: () => Date.now() }

  function installationOrThrow(id: string): InstallationSnapshot {
    const installation = dependencies.packages.getInstallation(id)
    if (!installation) throw new ServiceError('NOT_FOUND', 'Skill installation not found')
    return installation
  }

  function packageOrThrow(id: string): PackageSnapshot {
    const packageRecord = dependencies.packages.getPackage(id)
    if (!packageRecord) throw new ServiceError('NOT_FOUND', 'Skill package not found')
    return packageRecord
  }

  function assertCommandOptions(options: InstallationCommandOptions) {
    if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0) {
      throw new ServiceError('VALIDATION_ERROR', 'expectedRevision must be a non-negative integer')
    }
    if (!options.idempotencyKey.trim()) throw new ServiceError('VALIDATION_ERROR', 'idempotencyKey is required')
  }

  function assertRevision(installation: InstallationSnapshot, expectedRevision: number) {
    if ((installation.revision ?? 0) !== expectedRevision) {
      throw new ServiceError('REVISION_CONFLICT', 'Skill installation revision is stale', {
        expectedRevision,
        actualRevision: installation.revision ?? 0,
      })
    }
  }

  function audit(action: string, resourceType: string, resourceId: string, payload: Record<string, unknown>, context?: AuditContext) {
    dependencies.audit?.append({
      actor: context?.actor ?? null,
      action,
      resourceType,
      resourceId,
      payload: { ...payload, ...(context?.requestId ? { requestId: context.requestId } : {}) },
    })
  }

  function mutateInstallation(
    installationId: string,
    enabled: boolean,
    options: InstallationCommandOptions,
  ): InstallationSnapshot {
    assertCommandOptions(options)
    const duplicate = dependencies.packages.getInstallationCommandResult?.(installationId, options.idempotencyKey)
    if (duplicate) return duplicate
    const installation = installationOrThrow(installationId)
    assertRevision(installation, options.expectedRevision)
    if (installation.status === 'uninstalled' || installation.deletedAt !== null && installation.deletedAt !== undefined) {
      throw new ServiceError('CONFLICT', 'Uninstalled skill installation cannot be enabled or disabled')
    }
    if (enabled) {
      const currentVersion = dependencies.packages.getVersion(installation.currentVersionId)
      assertActivatableVersion(currentVersion, installation.packageId)
      assertCapabilitiesRevalidated(dependencies.capabilityGrantService, currentVersion.id)
    }
    if (!dependencies.packages.setInstallationEnabledCas) {
      throw new ServiceError('INTERNAL_ERROR', 'Skill installation lifecycle CAS is unavailable')
    }
    const updated = dependencies.packages.setInstallationEnabledCas({
      installationId,
      enabled,
      expectedRevision: options.expectedRevision,
      idempotencyKey: options.idempotencyKey,
    })
    if (!updated) throw new ServiceError('REVISION_CONFLICT', 'Skill installation revision is stale')
    audit(enabled ? 'skill.installation.enabled' : 'skill.installation.disabled', 'skill_installation', installationId, {
      expectedRevision: options.expectedRevision,
      newRevision: updated.revision ?? options.expectedRevision,
      previousVersionId: installation.currentVersionId,
      currentVersionId: updated.currentVersionId,
    }, options)
    return updated
  }

  function uninstallInstallation(installationId: string, options: InstallationCommandOptions): InstallationSnapshot {
    assertCommandOptions(options)
    const duplicate = dependencies.packages.getInstallationCommandResult?.(installationId, options.idempotencyKey)
    if (duplicate) return duplicate
    const installation = installationOrThrow(installationId)
    assertRevision(installation, options.expectedRevision)
    if (installation.status === 'uninstalled') return installation
    if (!dependencies.packages.uninstallInstallation) {
      throw new ServiceError('INTERNAL_ERROR', 'Skill installation uninstall lifecycle is unavailable')
    }
    const updated = dependencies.packages.uninstallInstallation({
      installationId,
      expectedRevision: options.expectedRevision,
      idempotencyKey: options.idempotencyKey,
    })
    if (!updated) throw new ServiceError('REVISION_CONFLICT', 'Skill installation revision is stale')
    audit('skill.installation.uninstalled', 'skill_installation', installationId, {
      expectedRevision: options.expectedRevision,
      newRevision: updated.revision ?? options.expectedRevision,
      currentVersionId: installation.currentVersionId,
    }, options)
    return updated
  }

  function rollbackInstallation(
    installationId: string,
    input: InstallationCommandOptions & { versionId?: string; reason: string },
  ): InstallationSnapshot {
    assertCommandOptions(input)
    const reason = input.reason.trim()
    if (!reason) throw new ServiceError('VALIDATION_ERROR', 'rollback reason is required')
    const duplicate = dependencies.packages.getInstallationCommandResult?.(installationId, input.idempotencyKey)
    if (duplicate) return duplicate
    const installation = installationOrThrow(installationId)
    assertRevision(installation, input.expectedRevision)
    if (installation.status !== 'installed' || !installation.enabled) {
      throw new ServiceError('CONFLICT', 'Only an enabled installed skill can be rolled back')
    }
    const targetVersionId = input.versionId ?? installation.previousVersionId
    if (!targetVersionId) throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', 'No previous verified skill version is available for rollback')
    const target = dependencies.packages.getVersion(targetVersionId)
    assertRollbackTarget(target, installation.packageId, installation.currentVersionId)
    assertCapabilitiesRevalidated(dependencies.capabilityGrantService, target.id)
    if (!dependencies.packages.rollbackInstallation) {
      throw new ServiceError('INTERNAL_ERROR', 'Skill installation rollback lifecycle is unavailable')
    }
    const updated = dependencies.packages.rollbackInstallation({
      installationId,
      versionId: targetVersionId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      reason,
    })
    if (!updated) throw new ServiceError('REVISION_CONFLICT', 'Skill installation revision is stale')
    audit('skill.installation.rollback', 'skill_installation', installationId, {
      expectedRevision: input.expectedRevision,
      newRevision: updated.revision ?? input.expectedRevision,
      previousVersionId: installation.currentVersionId,
      currentVersionId: updated.currentVersionId,
      reason,
    }, input)
    return updated
  }

  function requestDeletePackage(packageId: string, input: DeletePackageOptions): PackageSnapshot {
    if (input.confirm !== true) throw new ServiceError('VALIDATION_ERROR', 'Package deletion requires confirm=true')
    if (!input.idempotencyKey.trim()) throw new ServiceError('VALIDATION_ERROR', 'idempotencyKey is required')
    const reason = input.reason.trim()
    if (!reason) throw new ServiceError('VALIDATION_ERROR', 'delete reason is required')
    const packageRecord = packageOrThrow(packageId)
    if (packageRecord.deletedAt !== null && packageRecord.deletedAt !== undefined) return packageRecord

    const installations = dependencies.packages.listInstallations(packageId)
    if (installations.some((installation) => installation.status !== 'uninstalled' && installation.status !== 'deleted')) {
      throw new ServiceError('CONFLICT', 'Skill package has an active installation')
    }

    for (const version of dependencies.packages.listVersions(packageId)) {
      const runningRuns = dependencies.runs?.listRuns({ limit: 1000, offset: 0, skillVersionId: version.id })
      if (runningRuns?.data.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) {
        throw new ServiceError('CONFLICT', 'Skill package has a running Run')
      }
    }

    if (!dependencies.packages.softDeletePackage) {
      throw new ServiceError('INTERNAL_ERROR', 'Skill package soft delete lifecycle is unavailable')
    }
    const deleted = dependencies.packages.softDeletePackage({ packageId, idempotencyKey: input.idempotencyKey, reason })
    if (!deleted) throw new ServiceError('CONFLICT', 'Skill package could not be deleted')
    audit('skill.package.soft_deleted', 'skill_package', packageId, { reason }, input)
    return deleted
  }

  return {
    disableInstallation: (installationId: string, options: InstallationCommandOptions) => mutateInstallation(installationId, false, options),
    enableInstallation: (installationId: string, options: InstallationCommandOptions) => mutateInstallation(installationId, true, options),
    uninstallInstallation,
    rollbackInstallation,
    requestDeletePackage,
    now: () => clock.now(),
  }
}

function assertActivatableVersion(target: VersionSnapshot | undefined, packageId: string): asserts target is VersionSnapshot {
  if (!target || target.packageId !== packageId || !target.isCompatible || target.status !== 'runnable') {
    throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', 'Only a runnable compatible version can be enabled')
  }
}

function assertCapabilitiesRevalidated(revalidator: CapabilityVersionRevalidator | undefined, versionId: string) {
  if (!revalidator) return
  const result = revalidator.revalidateVersion(versionId)
  if (!result.safe) {
    const firstFinding = result.findings?.[0]
    throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', firstFinding?.reason ?? 'Version capability declarations are not allowed')
  }
}

function assertRollbackTarget(target: VersionSnapshot | undefined, packageId: string, currentVersionId: string): asserts target is VersionSnapshot {
  if (!target || target.packageId !== packageId || target.id === currentVersionId) {
    throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', 'Rollback target does not belong to this installation')
  }
  if (!target.isCompatible || target.status !== 'runnable' || !['verified', 'approved'].includes(target.securityStatus ?? '')) {
    throw new ServiceError('SKILL_VERSION_INCOMPATIBLE', 'Rollback target is not a verified runnable compatible version')
  }
}
