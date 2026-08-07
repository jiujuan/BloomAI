import { describe, expect, it, vi } from 'vitest'
import { ServiceError } from '../../services/errors'
import { createSkillVersionService } from './skill-version.service'

const v1 = {
  id: 'v1', packageId: 'pkg-1', version: '1.0.0', runtime: 'instruction-agent',
  manifest: { name: 'demo', requestedCapabilities: ['web.search'] }, manifestHash: 'hash-1', packagePath: '/packages/one',
  sourceSnapshot: { sourceSha256: 'source-1' }, isCompatible: true, createdAt: 1,
  status: 'runnable', securityStatus: 'verified', immutableHash: 'immutable-1', snapshotHash: 'snapshot-1',
}
const v2 = {
  ...v1, id: 'v2', version: '2.0.0', manifestHash: 'hash-2', sourceSnapshot: { sourceSha256: 'source-2' },
  immutableHash: 'immutable-2', snapshotHash: 'snapshot-2', createdAt: 2,
}

function makeDeps() {
  const installation = { id: 'install-1', packageId: 'pkg-1', currentVersionId: 'v1', previousVersionId: null, status: 'installed', enabled: true, revision: 3, installedAt: 1, updatedAt: 1 }
  const packages: any = {
    getPackage: vi.fn(() => ({ id: 'pkg-1' })),
    getVersion: vi.fn((id: string) => id === 'v1' ? v1 : id === 'v2' ? v2 : undefined),
    listVersions: vi.fn(() => [v2, v1]),
    createVersion: vi.fn(() => v2),
    findVersionByImmutableHash: vi.fn(() => undefined),
    listInstallations: vi.fn(() => [installation]),
    getInstallation: vi.fn(() => installation),
    switchCurrentVersion: vi.fn(() => ({ ...installation, currentVersionId: 'v2', previousVersionId: 'v1', revision: 4 })),
  }
  return { packages, installation }
}

describe('skill version service', () => {
  it('lists versions and computes a deterministic safe diff', () => {
    const { packages } = makeDeps()
    const service = createSkillVersionService({ packages } as any)
    expect(service.listVersions('pkg-1')).toEqual([v2, v1])
    expect(service.diffVersions('v1', 'v2')).toMatchObject({ fromVersionId: 'v1', toVersionId: 'v2', sourceShaChanged: true })
  })

  it('previews an update without changing the current installation pointer', async () => {
    const { packages, installation } = makeDeps()
    const service = createSkillVersionService({ packages } as any)
    const preview = await service.previewUpdate('pkg-1', { version: '2.0.0', manifest: v2.manifest, manifestHash: v2.manifestHash, packagePath: v2.packagePath, sourceSnapshot: v2.sourceSnapshot })
    expect(preview).toMatchObject({ packageId: 'pkg-1', currentVersionId: 'v1', duplicate: false, diff: { sourceShaChanged: true } })
    expect(installation.currentVersionId).toBe('v1')
    expect(packages.createVersion).not.toHaveBeenCalled()
  })

  it('exposes manifest, capability, source provenance, and security risk changes before update', async () => {
    const { packages } = makeDeps()
    const service = createSkillVersionService({
      packages,
      runs: { listRuns: vi.fn(() => ({ data: [{ id: 'run-1', status: 'running' }], total: 1 })) },
      grants: { listCapabilityGrants: vi.fn(() => [{ id: 'grant-1', status: 'approved', revokedAt: null }]) },
    } as any)

    const preview = await service.previewUpdate('pkg-1', {
      version: '3.0.0',
      manifest: { name: 'demo', requestedCapabilities: ['web.search', 'image.generate'] },
      manifestHash: 'hash-3',
      packagePath: '/packages/three',
      sourceSnapshot: { sourceSha256: 'source-3', resolvedCommit: 'commit-3' },
      securityStatus: 'unreviewed',
      securityFindings: { warnings: ['new executable'] },
    } as any)

    expect(preview.candidate).toMatchObject({
      sourceSnapshot: { sourceSha256: 'source-3', resolvedCommit: 'commit-3' },
      securityStatus: 'unreviewed',
      securityFindings: { warnings: ['new executable'] },
    })
    expect(preview.diff).toMatchObject({
      capabilities: { added: ['image.generate'] },
      source: { fromSha: 'source-1', toSha: 'source-3', toCommit: 'commit-3' },
      security: { statusChanged: true, findingsChanged: true },
    })
    expect(preview.diff?.riskSummary.warnings).toEqual(expect.arrayContaining([
      'capability expansion: image.generate',
      'security findings changed',
    ]))
    expect(preview.checks).toMatchObject({ runningRuns: 1, activeGrants: 1 })
  })

  it('rejects preview and update against an archived package', async () => {
    const { packages } = makeDeps()
    packages.getPackage.mockReturnValue({ id: 'pkg-1', deletedAt: 123, deleteReason: 'retired' })
    const service = createSkillVersionService({ packages } as any)
    const candidate = { version: '3.0.0', manifest: {}, manifestHash: 'hash-3', packagePath: '/packages/three' }

    await expect(service.previewUpdate('pkg-1', candidate)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(service.updatePackage('pkg-1', candidate)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('deduplicates identical immutable content and does not switch current automatically', async () => {
    const { packages } = makeDeps()
    packages.findVersionByImmutableHash.mockReturnValue(v1)
    const service = createSkillVersionService({ packages } as any)
    const result = await service.updatePackage('pkg-1', { version: '1.0.0', manifest: v1.manifest, manifestHash: v1.manifestHash, packagePath: v1.packagePath, sourceSnapshot: v1.sourceSnapshot })
    expect(result).toMatchObject({ duplicate: true, version: v1 })
    expect(packages.createVersion).not.toHaveBeenCalled()
    expect(packages.switchCurrentVersion).not.toHaveBeenCalled()
  })

  it('uses CAS/idempotency when switching current version', () => {
    const { packages } = makeDeps()
    const service = createSkillVersionService({ packages } as any)
    expect(service.switchCurrent('install-1', 'v2', { expectedRevision: 3, idempotencyKey: 'switch-1' })).toMatchObject({ currentVersionId: 'v2', revision: 4 })
    expect(packages.switchCurrentVersion).toHaveBeenCalledWith({ installationId: 'install-1', versionId: 'v2', expectedRevision: 3, idempotencyKey: 'switch-1' })
  })

  it('keeps current version unchanged when update creation fails', async () => {
    const { packages, installation } = makeDeps()
    packages.createVersion.mockImplementation(() => { throw new Error('write failed') })
    const service = createSkillVersionService({ packages } as any)
    await expect(service.updatePackage('pkg-1', { version: '3.0.0', manifest: {}, manifestHash: 'hash-3', packagePath: '/packages/three', sourceSnapshot: {} })).rejects.toThrow('write failed')
    expect(installation.currentVersionId).toBe('v1')
  })

  it('rejects switching to a version from another package or an incompatible version', () => {
    const { packages } = makeDeps()
    packages.getVersion.mockReturnValue({ ...v2, packageId: 'pkg-2' })
    const service = createSkillVersionService({ packages } as any)
    expect(() => service.switchCurrent('install-1', 'v2', { expectedRevision: 3, idempotencyKey: 'switch-2' })).toThrow(ServiceError)
    expect(() => service.switchCurrent('install-1', 'v2', { expectedRevision: 3, idempotencyKey: 'switch-3' })).toThrow()
  })
})
