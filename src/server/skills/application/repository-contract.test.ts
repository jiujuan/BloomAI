import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillRuntimePorts } from './ports'
import { createFakeSkillRuntimePorts } from './test-doubles'

const sqliteDirs: string[] = []

async function createFixture(kind: 'fake' | 'sqlite'): Promise<SkillRuntimePorts & { cleanup: () => Promise<void> }> {
  if (kind === 'fake') {
    const ports = createFakeSkillRuntimePorts({ now: 1_700_000_000_000 })
    return { ...ports, cleanup: async () => {} }
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-runtime-contract-'))
  sqliteDirs.push(dataDir)
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createSqliteSkillRuntimePorts } = await import('../../db/repositories/skill-package.repo')
  const ports = createSqliteSkillRuntimePorts()
  return {
    ...ports,
    cleanup: async () => {
      client.closeDb()
      vi.resetModules()
      delete process.env.DATA_DIR
      fs.rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

afterEach(() => {
  delete process.env.DATA_DIR
})

for (const kind of ['fake', 'sqlite'] as const) {
  describe(`${kind} runtime repository contract`, () => {
    let ports: SkillRuntimePorts & { cleanup: () => Promise<void> }
    let versionId: string

    beforeEach(async () => {
      ports = await createFixture(kind)
      const packageRow = ports.packages.createPackage({
        name: `${kind}-package`,
        description: 'contract fixture',
        sourceType: 'local',
      })
      const version = ports.packages.createVersion({
        packageId: packageRow.id,
        version: '1.0.0',
        manifest: { name: 'contract', capabilities: ['web.search'] },
        manifestHash: 'manifest-hash',
        packagePath: '/tmp/contract-package',
      })
      versionId = version.id
      ports.packages.createInstallation({
        packageId: packageRow.id,
        currentVersionId: version.id,
        status: 'installed',
      })
    })

    afterEach(async () => {
      await ports.cleanup()
    })

    it('returns immutable package, version, installation and run snapshots', () => {
      const packagePage = ports.packages.listPackages({ limit: 1, offset: 0 })
      expect(packagePage.total).toBe(1)
      const packageSnapshot = packagePage.data[0]
      expect(packageSnapshot).toBeDefined()

      const version = ports.packages.getVersion(versionId)
      expect(version).toBeDefined()
      if (!version || !packageSnapshot) throw new Error('fixture was not created')

      const mutableVersion = version as { manifest: Record<string, unknown> }
      mutableVersion.manifest.name = 'mutated'
      expect(ports.packages.getVersion(version.id)?.manifest.name).toBe('contract')

      const run = ports.runs.createRun({
        skillVersionId: version.id,
        status: 'created',
        input: { prompt: 'hello' },
        context: { source: 'test' },
      })
      const mutableRun = run as { input: Record<string, unknown> }
      mutableRun.input.prompt = 'mutated'
      expect(ports.runs.getRun(run.id)?.input.prompt).toBe('hello')
    })

    it('enforces revision conflicts and command idempotency', () => {
      const run = ports.runs.createRun({
        skillVersionId: versionId,
        status: 'created',
        input: {},
        context: {},
      })
      const request = {
        runId: run.id,
        expectedRevision: 0,
        changes: { status: 'running' as const },
        event: { schemaVersion: 1, type: 'run.started', payload: { source: 'contract' } },
        command: { idempotencyKey: 'start-command' },
      }

      const first = ports.runs.compareAndSet(request)
      expect(first?.duplicate).toBe(false)
      expect(first?.run.revision).toBe(1)

      const duplicate = ports.runs.compareAndSet(request)
      expect(duplicate?.duplicate).toBe(true)
      expect(duplicate?.run.id).toBe(run.id)
      expect(duplicate?.run.revision).toBe(1)

      const stale = ports.runs.compareAndSet({
        ...request,
        command: { idempotencyKey: 'different-command' },
      })
      expect(stale).toBeUndefined()
    })

    it('supports pagination and filters at their boundaries', () => {
      const second = ports.runs.createRun({ skillVersionId: versionId, status: 'failed', input: {}, context: {} })
      ports.runs.createRun({ skillVersionId: versionId, status: 'completed', input: {}, context: {} })

      expect(ports.runs.listRuns({ limit: 0, offset: 0 }).data).toHaveLength(0)
      expect(ports.runs.listRuns({ limit: 1, offset: 1 }).data).toHaveLength(1)
      expect(ports.runs.listRuns({ limit: 10, offset: 99 }).data).toHaveLength(0)
      expect(ports.runs.listRuns({ limit: 10, offset: 0, status: 'failed' }).data.map((run) => run.id)).toEqual([second.id])
      expect(ports.runs.listRuns({ limit: 10, offset: 0, skillVersionId: versionId }).total).toBe(2)
      expect(ports.runs.listRuns({ limit: 10, offset: 0, skillVersionId: 'missing' }).total).toBe(0)
    })

    it('keeps installation ownership isolated between packages', () => {
      const firstPackage = ports.packages.listPackages({ limit: 10, offset: 0 }).data[0]
      if (!firstPackage) throw new Error('fixture was not created')
      const secondPackage = ports.packages.createPackage({ name: 'second', description: '', sourceType: 'local' })
      const secondVersion = ports.packages.createVersion({ packageId: secondPackage.id, version: '1.0.0', manifest: {}, manifestHash: 'second', packagePath: '/tmp/second' })
      const secondInstallation = ports.packages.createInstallation({ packageId: secondPackage.id, currentVersionId: secondVersion.id, status: 'installed' })

      expect(ports.packages.listInstallations(firstPackage.id)).toHaveLength(1)
      expect(ports.packages.listInstallations(secondPackage.id)).toEqual([secondInstallation])
      expect(ports.packages.deleteInstallation(secondInstallation.id)).toBe(true)
      expect(ports.packages.getInstallation(secondInstallation.id)).toBeUndefined()
      expect(ports.packages.listInstallations(firstPackage.id)).toHaveLength(1)
    })

    it('enforces artifact ownership by run', () => {
      const runA = ports.runs.createRun({ skillVersionId: versionId, status: 'created', input: {}, context: {} })
      const runB = ports.runs.createRun({ skillVersionId: versionId, status: 'created', input: {}, context: {} })
      const artifact = ports.artifacts.createArtifact({ runId: runA.id, kind: 'text', path: '/tmp/a.txt', sha256: 'sha-a' })

      expect(ports.artifacts.listArtifacts(runA.id)).toEqual([artifact])
      expect(ports.artifacts.listArtifacts(runB.id)).toEqual([])
      expect(ports.artifacts.getArtifact(artifact.id)?.runId).toBe(runA.id)
    })

    it('filters grants by version, session and expiry, and supports revoke and one-time consume', () => {
      const otherPackage = ports.packages.createPackage({ name: 'other', description: '', sourceType: 'local' })
      const otherVersion = ports.packages.createVersion({ packageId: otherPackage.id, version: '1.0.0', manifest: {}, manifestHash: 'other', packagePath: '/tmp/other' })
      const grant = ports.grants.createCapabilityGrant({
        skillVersionId: versionId,
        capability: 'web.search',
        grantMode: 'once',
        scope: { domains: ['example.com'] },
        sessionId: 'session-a',
        expiresAt: 1_700_000_000_100,
      })
      ports.grants.createCapabilityGrant({ skillVersionId: otherVersion.id, capability: 'web.search', grantMode: 'persistent' })

      expect(ports.grants.listCapabilityGrants(versionId)).toHaveLength(1)
      expect(ports.grants.findActiveCapabilityGrant({ skillVersionId: versionId, capability: 'web.search', sessionId: 'session-b', now: 1_700_000_000_000 })).toBeUndefined()
      expect(ports.grants.findActiveCapabilityGrant({ skillVersionId: versionId, capability: 'web.search', sessionId: 'session-a', now: 1_700_000_000_101 })).toBeUndefined()
      expect(ports.grants.findActiveCapabilityGrant({ skillVersionId: versionId, capability: 'web.search', sessionId: 'session-a', now: 1_700_000_000_000 })).toMatchObject({ id: grant.id })
      expect(ports.grants.consumeCapabilityGrant(grant.id, 1_700_000_000_050)).toBe(true)
      expect(ports.grants.consumeCapabilityGrant(grant.id, 1_700_000_000_060)).toBe(false)
      expect(ports.grants.findActiveCapabilityGrant({ skillVersionId: versionId, capability: 'web.search', sessionId: 'session-a', now: 1_700_000_000_000 })).toBeUndefined()
    })

    it('allocates the next event sequence after the highest existing sequence', () => {
      const run = ports.runs.createRun({ skillVersionId: versionId, status: 'created', input: {}, context: {} })
      ports.events.appendEvent({ runId: run.id, seq: 1, schemaVersion: 1, type: 'first', payload: {} })
      ports.events.appendEvent({ runId: run.id, seq: 3, schemaVersion: 1, type: 'third', payload: {} })
      expect(ports.events.nextSequence(run.id)).toBe(4)
      expect(ports.events.appendEvent({ runId: run.id, schemaVersion: 1, producer: 'worker', occurredAt: 1_700_000_000_000, type: 'fourth', payload: {} }).seq).toBe(4)
      expect(ports.events.listEvents(run.id, { afterSeq: 1, limit: 1 })).toHaveLength(1)
      expect(ports.events.listEventsPage?.({ runId: run.id, afterSeq: 1, limit: 2 })).toMatchObject({ nextAfterSeq: null })
    })

    it('creates a run and queue item atomically and enforces lease ownership', () => {
      if (!ports.runs.createRunAndEnqueue) throw new Error('adapter does not implement atomic run creation')
      const created = ports.runs.createRunAndEnqueue({
        skillVersionId: versionId,
        status: 'created',
        input: { queued: true },
        context: {},
        availableAt: 100,
      })
      expect(created.queue).toMatchObject({ runId: created.run.id, status: 'queued', attempt: 0 })

      const first = ports.queue.claimNext({ workerId: 'worker-a', leaseMs: 50, now: 100 })
      expect(first).toMatchObject({ id: created.queue.id, status: 'leased', leaseOwner: 'worker-a', attempt: 1 })
      expect(ports.queue.claimNext({ workerId: 'worker-b', leaseMs: 50, now: 100 })).toBeUndefined()
      expect(ports.queue.claimNext({ workerId: 'worker-b', leaseMs: 50, now: 151 })).toMatchObject({ leaseOwner: 'worker-b', attempt: 2 })
      expect(ports.queue.ack({ queueId: created.queue.id, workerId: 'worker-a', now: 151 })).toBe(false)
      expect(ports.queue.ack({ queueId: created.queue.id, workerId: 'worker-b', now: 151 })).toBe(true)
      expect(ports.queue.get(created.queue.id)).toMatchObject({ status: 'done', leaseOwner: null, leaseUntil: null })
    })
  })
}

void sqliteDirs
