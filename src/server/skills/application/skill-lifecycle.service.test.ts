import { describe, expect, it, vi } from 'vitest'
import { ServiceError } from '../../services/errors'
import { createSkillLifecycleService } from './skill-lifecycle.service'

const version1 = {
  id: 'version-1', packageId: 'package-1', version: '1.0.0', runtime: 'instruction-agent',
  manifest: {}, manifestHash: 'hash-1', packagePath: '/packages/one', sourceSnapshot: {},
  isCompatible: true, status: 'runnable', securityStatus: 'verified', createdAt: 1,
}
const version2 = { ...version1, id: 'version-2', version: '2.0.0', createdAt: 2 }

function makeDependencies() {
  const installation: any = {
    id: 'installation-1', packageId: 'package-1', currentVersionId: 'version-2', previousVersionId: 'version-1',
    status: 'installed', enabled: true, revision: 4, installedAt: 1, updatedAt: 4,
    disabledAt: null, uninstalledAt: null, deletedAt: null, rollbackReason: null,
  }
  const packages = {
    getPackage: vi.fn(() => ({ id: 'package-1', name: 'Demo', description: '', sourceType: 'local', sourceUri: null, sourceRef: null, createdAt: 1, updatedAt: 1 })),
    getVersion: vi.fn((id: string) => id === version1.id ? version1 : id === version2.id ? version2 : undefined),
    listVersions: vi.fn(() => [version2, version1]),
    getInstallation: vi.fn(() => installation),
    listInstallations: vi.fn(() => [installation]),
    setInstallationEnabledCas: vi.fn(({ enabled }: { enabled: boolean }) => {
      installation.enabled = enabled
      installation.status = enabled ? 'installed' : 'disabled'
      installation.revision += 1
      return { ...installation }
    }),
    uninstallInstallation: vi.fn(() => {
      installation.status = 'uninstalled'
      installation.enabled = false
      installation.revision += 1
      return { ...installation }
    }),
    rollbackInstallation: vi.fn(() => {
      installation.currentVersionId = version1.id
      installation.previousVersionId = version2.id
      installation.revision += 1
      installation.rollbackReason = 'rollback after failed verification'
      return { ...installation }
    }),
    softDeletePackage: vi.fn(() => ({ id: 'package-1', name: 'Demo', description: '', sourceType: 'local', sourceUri: null, sourceRef: null, createdAt: 1, updatedAt: 1, deletedAt: 10, deleteReason: 'retire package' })),
  }
  const runs = { listRuns: vi.fn(() => ({ data: [], total: 0 })) }
  const audit = { append: vi.fn() }
  return { packages, runs, audit, installation }
}

describe('skill lifecycle service', () => {
  it('disables and re-enables an installation through revision CAS and audits the transition', () => {
    const dependencies = makeDependencies()
    const service = createSkillLifecycleService({ ...dependencies, clock: { now: () => 10 } } as any)

    expect(service.disableInstallation('installation-1', { expectedRevision: 4, idempotencyKey: 'disable-1' })).toMatchObject({ enabled: false, revision: 5 })
    expect(service.enableInstallation('installation-1', { expectedRevision: 5, idempotencyKey: 'enable-1' })).toMatchObject({ enabled: true, revision: 6 })
    expect(dependencies.packages.setInstallationEnabledCas).toHaveBeenNthCalledWith(1, { installationId: 'installation-1', enabled: false, expectedRevision: 4, idempotencyKey: 'disable-1' })
    expect(dependencies.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'skill.installation.disabled', resourceId: 'installation-1' }))
    expect(dependencies.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'skill.installation.enabled', resourceId: 'installation-1' }))
  })

  it('uninstalls without deleting the installation or its historical references', () => {
    const dependencies = makeDependencies()
    const service = createSkillLifecycleService({ ...dependencies, clock: { now: () => 10 } } as any)
    expect(service.uninstallInstallation('installation-1', { expectedRevision: 4, idempotencyKey: 'uninstall-1' })).toMatchObject({ status: 'uninstalled', enabled: false })
    expect(dependencies.packages.uninstallInstallation).toHaveBeenCalledWith({ installationId: 'installation-1', expectedRevision: 4, idempotencyKey: 'uninstall-1' })
    expect(dependencies.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'skill.installation.uninstalled' }))
  })

  it('rolls back only to a compatible verified runnable version and records the reason', () => {
    const dependencies = makeDependencies()
    const service = createSkillLifecycleService({ ...dependencies, clock: { now: () => 10 } } as any)
    const result = service.rollbackInstallation('installation-1', { versionId: 'version-1', expectedRevision: 4, idempotencyKey: 'rollback-1', reason: 'rollback after failed verification' })
    expect(result).toMatchObject({ currentVersionId: 'version-1', rollbackReason: 'rollback after failed verification' })
    expect(dependencies.packages.rollbackInstallation).toHaveBeenCalledWith({ installationId: 'installation-1', versionId: 'version-1', expectedRevision: 4, idempotencyKey: 'rollback-1', reason: 'rollback after failed verification' })
  })

  it('blocks package deletion while an installation or run is active', () => {
    const dependencies = makeDependencies()
    const service = createSkillLifecycleService({ ...dependencies, clock: { now: () => 10 } } as any)
    expect(() => service.requestDeletePackage('package-1', { confirm: true, idempotencyKey: 'delete-1', reason: 'retire package' })).toThrowError(new ServiceError('CONFLICT', 'Skill package has an active installation'))
    dependencies.packages.listInstallations.mockReturnValue([{ ...dependencies.installation, status: 'uninstalled', enabled: false }])
    dependencies.runs.listRuns.mockReturnValue({ data: [{ id: 'run-1', status: 'running', skillVersionId: version1.id }], total: 1 } as any)
    expect(() => service.requestDeletePackage('package-1', { confirm: true, idempotencyKey: 'delete-2', reason: 'retire package' })).toThrowError(new ServiceError('CONFLICT', 'Skill package has a running Run'))
  })

  it('soft deletes an uninstalled package after explicit confirmation', () => {
    const dependencies = makeDependencies()
    dependencies.packages.listInstallations.mockReturnValue([{ ...dependencies.installation, status: 'uninstalled', enabled: false }])
    const service = createSkillLifecycleService({ ...dependencies, clock: { now: () => 10 } } as any)
    const result = service.requestDeletePackage('package-1', { confirm: true, idempotencyKey: 'delete-1', reason: 'retire package' })
    expect(result).toMatchObject({ deletedAt: 10, deleteReason: 'retire package' })
    expect(dependencies.packages.softDeletePackage).toHaveBeenCalledWith({ packageId: 'package-1', idempotencyKey: 'delete-1', reason: 'retire package' })
    expect(dependencies.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'skill.package.soft_deleted' }))
  })
})
