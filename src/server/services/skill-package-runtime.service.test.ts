import { describe, expect, it, vi } from 'vitest'
import { ArtifactStoreError } from '../skills/artifacts'
import { CapabilityGrantServiceError } from '../skills/application/capability-grant.service'
import { PackageInstallReviewError, packageInstallReviewService } from '../skills/packages/package-install-review.service'
import { ServiceError } from './errors'
import { withSkillCorrelation } from '../skills/observability/skill-runtime.logger'
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
      code: 'PACKAGE_INSTALL_ERROR', message: 'invalid package', details: { providerCode: 'PACKAGE_INSTALL_ERROR' },
    })
  })

  it('rejects starting a run for a disabled installation before coordinator creation', () => {
    const resolveRunnableVersion = vi.fn(() => undefined)
    const startRun = vi.fn()
    const service = createSkillPackageRuntimeService({
      repo: { resolveRunnableVersion } as any,
      coordinator: { startRun } as any,
    })

    expect(() => service.startRun({ skillId: 'pkg-1', input: {} })).toThrowError('Installed and enabled Package Skill was not found')
    expect(resolveRunnableVersion).toHaveBeenCalledWith('pkg-1')
    expect(startRun).not.toHaveBeenCalled()
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


  it('records approval outcomes with correlation and does not let telemetry change the result', () => {
    const metrics = {
      recordApproval: vi.fn(),
      recordError: vi.fn(),
    }
    const approve = vi.spyOn(packageInstallReviewService, 'approve').mockReturnValue({ id: 'review-1', status: 'approved' } as any)
    const reject = vi.spyOn(packageInstallReviewService, 'reject').mockImplementation(() => {
      throw new PackageInstallReviewError('REVIEW_REJECTED', 'review rejected: secret-token')
    })
    const service = createSkillPackageRuntimeService({ metrics: metrics as any })

    const approved = withSkillCorrelation({ requestId: 'req-approval', packageId: 'pkg-1', skillVersionId: 'version-1' }, () => service.approveImportReview('review-1', 'admin'))
    expect(approved).toEqual({ id: 'review-1', status: 'approved' })
    expect(metrics.recordApproval).toHaveBeenCalledWith(expect.objectContaining({
      action: 'approve',
      outcome: 'success',
      durationMs: expect.any(Number),
      correlation: expect.objectContaining({ requestId: 'req-approval', versionId: 'version-1' }),
    }))

    expect(() => withSkillCorrelation({ requestId: 'req-reject' }, () => service.rejectImportReview('review-1', 'admin'))).toThrowError('review rejected')
    expect(metrics.recordApproval).toHaveBeenCalledWith(expect.objectContaining({
      action: 'reject',
      outcome: 'error',
      durationMs: expect.any(Number),
      correlation: expect.objectContaining({ requestId: 'req-reject' }),
    }))
    expect(metrics.recordError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PACKAGE_INSTALL_ERROR', operation: 'reject' }))

    approve.mockImplementation(() => ({ id: 'review-1', status: 'approved' } as any))
    metrics.recordApproval.mockImplementation(() => { throw new Error('telemetry unavailable') })
    expect(service.approveImportReview('review-1', 'admin')).toEqual({ id: 'review-1', status: 'approved' })
    approve.mockRestore()
    reject.mockRestore()
  })

  it('records mapped runtime errors by operation without exposing raw error text', async () => {
    const cases = [
      {
        operation: 'run',
        code: 'FORBIDDEN',
        error: new ServiceError('FORBIDDEN', 'authorization=top-secret'),
        invoke: (service: ReturnType<typeof createSkillPackageRuntimeService>) => service.executeRunCommand('run-1', { type: 'cancel' }),
        create: (error: unknown, metrics: any) => createSkillPackageRuntimeService({ coordinator: { dispatchCommand: vi.fn(() => { throw error }) } as any, metrics }),
      },
      {
        operation: 'run',
        code: 'REVISION_CONFLICT',
        error: new SkillRunConflictError('run-1'),
        invoke: (service: ReturnType<typeof createSkillPackageRuntimeService>) => service.executeRunCommand('run-1', { type: 'cancel' }),
        create: (error: unknown, metrics: any) => createSkillPackageRuntimeService({ coordinator: { dispatchCommand: vi.fn(() => { throw error }) } as any, metrics }),
      },
      {
        operation: 'capability',
        code: 'CAPABILITY_NOT_SUPPORTED',
        error: new CapabilityGrantServiceError('FORBIDDEN_CAPABILITY', 'capability denied: top-secret'),
        invoke: (service: ReturnType<typeof createSkillPackageRuntimeService>) => service.approveCapabilityGrant('grant-1', { actor: 'admin' }),
        create: (error: unknown, metrics: any) => createSkillPackageRuntimeService({ capabilityGrantService: { approveGrant: vi.fn(() => { throw error }) } as any, metrics }),
      },
      {
        operation: 'inspect',
        code: 'PACKAGE_INSTALL_ERROR',
        error: new PackageInstallError('package token=top-secret'),
        invoke: (service: ReturnType<typeof createSkillPackageRuntimeService>) => service.inspectPackage({ kind: 'local-directory', directory: 'missing' }),
        create: (error: unknown, metrics: any) => createSkillPackageRuntimeService({ createInstaller: () => ({ inspect: vi.fn(() => { throw error }) } as any), metrics }),
      },
      {
        operation: 'artifact',
        code: 'ARTIFACT_ERROR',
        error: new ArtifactStoreError('artifact secret=top-secret'),
        invoke: (service: ReturnType<typeof createSkillPackageRuntimeService>) => service.readArtifactContent('artifact-1', 'run-1'),
        create: (error: unknown, metrics: any) => createSkillPackageRuntimeService({ coordinator: { getRun: vi.fn(() => ({ id: 'run-1' })) } as any, artifactStore: { readContent: vi.fn(() => { throw error }) } as any, metrics }),
      },
    ] as const

    for (const testCase of cases) {
      const metrics = { recordApproval: vi.fn(), recordError: vi.fn() }
      const service = testCase.create(testCase.error, metrics)
      let result: unknown
      try { result = testCase.invoke(service) } catch (error) { result = Promise.reject(error) }
      await expect(Promise.resolve(result)).rejects.toBeDefined()
      expect(metrics.recordError).toHaveBeenCalledWith(expect.objectContaining({ code: testCase.code, operation: testCase.operation }))
      const serialized = JSON.stringify(metrics.recordError.mock.calls[0][0])
      expect(serialized).not.toContain('top-secret')
    }
  })

  it('preserves mapped errors when error telemetry throws', () => {
    const metrics = {
      recordApproval: vi.fn(),
      recordError: vi.fn(() => { throw new Error('telemetry unavailable') }),
    }
    const service = createSkillPackageRuntimeService({
      metrics: metrics as any,
      coordinator: { dispatchCommand: vi.fn(() => { throw new SkillRunConflictError('run-1') }) } as any,
    })

    expect(() => service.executeRunCommand('run-1', { type: 'cancel' })).toThrowError('Skill run revision conflict')
    expect(metrics.recordError).toHaveBeenCalledTimes(1)
  })

})
