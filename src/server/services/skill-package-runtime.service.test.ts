import { describe, expect, it, vi } from 'vitest'
import { ArtifactStoreError } from '../skills/artifacts'
import { PackageInstallError } from '../skills/packages/package-installer'
import { SkillRunConflictError, SkillRunTransitionError } from '../skills/runtime/skill-run-coordinator'
import { createSkillPackageRuntimeService } from './skill-package-runtime.service'

describe('skillPackageRuntimeService', () => {
  it('aggregates package versions, installations, and grants into the existing detail shape', () => {
    const service = createSkillPackageRuntimeService({
      repo: {
        getPackage: vi.fn(() => ({ id: 'pkg-1' })),
        listVersions: vi.fn(() => [{ id: 'v1' }, { id: 'v2' }]),
        listInstallations: vi.fn(() => [{ id: 'i1' }]),
        listCapabilityGrants: vi.fn((versionId: string) => [{ id: `g-${versionId}` }]),
      } as any,
    })

    expect(service.getPackageDetail('pkg-1')).toEqual({
      package: { id: 'pkg-1' },
      versions: [{ id: 'v1' }, { id: 'v2' }],
      installations: [{ id: 'i1' }],
      capabilityGrants: [
        { id: 'g-v1', skill_version_id: 'v1' },
        { id: 'g-v2', skill_version_id: 'v2' },
      ],
    })
  })

  it('maps async package installer failures to PACKAGE_INSTALL_ERROR', async () => {
    const service = createSkillPackageRuntimeService({
      createInstaller: () => ({ inspect: vi.fn(async () => { throw new PackageInstallError('invalid package') }) } as any),
    })

    await expect(service.inspectPackage({ kind: 'local-directory', directory: 'missing' })).rejects.toMatchObject({
      code: 'PACKAGE_INSTALL_ERROR', message: 'invalid package',
    })
  })

  it('rejects starting a run for a non-runnable package reference', () => {
    const service = createSkillPackageRuntimeService({ repo: { resolveRunnableVersion: vi.fn(() => undefined) } as any })
    expect(() => service.startRun({ skillId: 'pkg-1', input: {} })).toThrowError('Installed and enabled Package Skill was not found')
  })

  it('preserves command conflicts, invalid transitions, and cancel command shape', () => {
    const conflicting = createSkillPackageRuntimeService({
      coordinator: { dispatchCommand: vi.fn(() => { throw new SkillRunConflictError('run-1') }) } as any,
    })
    const transitioning = createSkillPackageRuntimeService({
      coordinator: { dispatchCommand: vi.fn(() => { throw new SkillRunTransitionError('running', 'created') }) } as any,
    })
    const dispatchCommand = vi.fn(() => ({ id: 'run-1', cancelRequested: true }))
    const cancelling = createSkillPackageRuntimeService({ coordinator: { dispatchCommand } as any })

    expect(() => conflicting.executeRunCommand('run-1', { type: 'cancel' })).toThrowError('Skill run revision conflict')
    try { conflicting.executeRunCommand('run-1', { type: 'cancel' }) } catch (error) { expect(error).toMatchObject({ code: 'REVISION_CONFLICT' }) }
    expect(() => transitioning.executeRunCommand('run-1', { type: 'cancel' })).toThrowError('Invalid skill run transition')
    try { transitioning.executeRunCommand('run-1', { type: 'cancel' }) } catch (error) { expect(error).toMatchObject({ code: 'INVALID_RUN_TRANSITION' }) }
    expect(cancelling.cancelRun('run-1', { idempotencyKey: 'once', expectedRevision: 2 })).toEqual({ id: 'run-1', cancelRequested: true })
    expect(dispatchCommand).toHaveBeenCalledWith('run-1', { type: 'cancel', idempotencyKey: 'once', expectedRevision: 2 })
  })

  it('maps missing artifacts to NOT_FOUND and forwards list calls through the run ownership check', () => {
    const artifactStore = { readContent: vi.fn(() => { throw new ArtifactStoreError('Artifact not found: artifact-1') }) } as any
    const repo = { listArtifacts: vi.fn(() => [{ id: 'artifact-1' }]) } as any
    const coordinator = { getRun: vi.fn(() => ({ id: 'run-1' })) } as any
    const service = createSkillPackageRuntimeService({ artifactStore, repo, coordinator })

    expect(service.listRunArtifacts('run-1')).toEqual([{ id: 'artifact-1' }])
    expect(() => service.readArtifactContent('artifact-1', 'run-1')).toThrowError('Artifact not found')
    try { service.readArtifactContent('artifact-1', 'run-1') } catch (error) { expect(error).toMatchObject({ code: 'NOT_FOUND' }) }
    expect(coordinator.getRun).toHaveBeenCalledWith('run-1')
  })

  it('uses NOT_FOUND when an installation cannot be removed', () => {
    const service = createSkillPackageRuntimeService({ repo: { deleteInstallation: vi.fn(() => false) } as any })
    expect(() => service.removeInstallation('missing')).toThrowError('Skill installation not found')
  })
})
