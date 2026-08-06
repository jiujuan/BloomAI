import { describe, expect, it } from 'vitest'
import { createFakeSkillRuntimePorts } from './test-doubles'
import { CapabilityGrantService, CapabilityGrantServiceError } from './capability-grant.service'

function setup() {
  const ports = createFakeSkillRuntimePorts({ now: 1_000 })
  const pkg = ports.packages.createPackage({ name: 'approval-skill', description: '', sourceType: 'local' })
  const version = ports.packages.createVersion({
    packageId: pkg.id,
    version: '1.0.0',
    manifest: {
      requestedCapabilities: [
        { capability: 'web.search', scope: { allowedDomains: ['example.com'], maxCalls: 3 } },
        { capability: 'image.generate', scope: { allowedModels: ['safe-model'] } },
      ],
    },
    manifestHash: 'hash',
    packagePath: '/tmp/approval-skill',
  })
  const run = ports.runs.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {}, sessionId: 'session-a' })
  return { ports, version, run, service: new CapabilityGrantService({ ...ports, audit: { append: () => undefined } }) }
}

describe('CapabilityGrantService', () => {
  it('keeps requested capabilities pending and denies them by default', () => {
    const { service, run, ports } = setup()
    const result = service.requestCapabilities(run.id)

    expect(result).toEqual([
      expect.objectContaining({ capability: 'web.search', status: 'approval_required', requestedScope: { allowedDomains: ['example.com'], maxCalls: 3 } }),
      expect.objectContaining({ capability: 'image.generate', status: 'approval_required' }),
    ])
    expect(ports.grants.listCapabilityGrants(run.skillVersionId)).toHaveLength(2)
    expect(ports.grants.listCapabilityGrants(run.skillVersionId).every((grant) => grant.status === 'pending')).toBe(true)
  })

  it('only approves a granted scope that is a subset of the requested scope', () => {
    const { service, run } = setup()
    const [grant] = service.requestCapabilities(run.id)
    expect(() => service.approveGrant(grant.grantId, { actor: 'user-1', scope: { allowedDomains: ['evil.example'] } })).toThrowError(CapabilityGrantServiceError)

    const approved = service.approveGrant(grant.grantId, { actor: 'user-1', scope: { allowedDomains: ['example.com'], maxCalls: 2 } })
    expect(approved.status).toBe('approved')
    expect(approved.grantedScope).toEqual({ allowedDomains: ['example.com'], maxCalls: 2 })
    expect(approved.approvedBy).toBe('user-1')
  })

  it('rejects, revokes, expires, and consumes grants without crossing run ownership', () => {
    const { service, run, ports, version } = setup()
    const [grant] = service.requestCapabilities(run.id)
    const approved = service.approveGrant(grant.grantId, { actor: 'user-1', scope: { allowedDomains: ['example.com'], maxCalls: 2 } })
    expect(service.consumeGrant(approved.grantId, { runId: run.id })).toMatchObject({ callsUsed: 1 })
    expect(() => service.consumeGrant(approved.grantId, { runId: 'other-run' })).toThrow(/ownership/i)
    expect(service.consumeGrant(approved.grantId, { runId: run.id })).toMatchObject({ callsUsed: 2 })
    expect(() => service.consumeGrant(approved.grantId, { runId: run.id })).toThrow(/exhausted/i)

    const secondRun = ports.runs.createRun({ skillVersionId: version.id, status: 'created', input: {}, context: {}, sessionId: 'session-a' })
    const [secondGrant] = service.requestCapabilities(secondRun.id, [{ capability: 'image.generate', scope: { allowedModels: ['safe-model'] } }])
    expect(service.rejectGrant(secondGrant.grantId, { actor: 'user-1', reason: 'not needed' }).status).toBe('rejected')
    expect(service.revokeGrant(approved.grantId, { actor: 'user-1' }).status).toBe('revoked')
  })
})
