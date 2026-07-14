import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { SkillRunConflictError, SkillRunCoordinator } = await import('./skill-run-coordinator')
  const version = skillPackageRepo.createVersion({
    packageId: skillPackageRepo.createPackage({ name: 'Coordinator fixture', description: '', sourceType: 'local-directory' }).id,
    version: '1.0.0',
    manifest: {},
    manifestHash: 'coordinator-fixture',
    packagePath: '/packages/coordinator-fixture',
  })

  return { SkillRunConflictError, SkillRunCoordinator, skillPackageRepo, version }
}

describe('SkillRunCoordinator', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-skill-run-coordinator-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('starts a persisted run and returns only its run id', async () => {
    const { SkillRunCoordinator, skillPackageRepo, version } = await loadRuntime()
    const coordinator = new SkillRunCoordinator()

    const result = coordinator.startRun({
      skillVersionId: version.id,
      input: { article: 'hello' },
      context: { source: 'test' },
      surface: 'image',
    })

    expect(result).toEqual({ runId: expect.any(String) })
    expect(skillPackageRepo.getRun(result.runId)).toMatchObject({
      status: 'validating',
      revision: 1,
      surface: 'image',
    })
  })

  it('applies a confirmation command once and resumes a waiting run', async () => {
    const { SkillRunCoordinator, skillPackageRepo, version } = await loadRuntime()
    const coordinator = new SkillRunCoordinator()
    const { runId } = coordinator.startRun({ skillVersionId: version.id, input: { count: 1 }, context: {} })
    coordinator.transition(runId, 'waiting_approval', { expectedRevision: 1, waitingReason: 'confirm plan' })

    const first = coordinator.dispatchCommand(runId, {
      type: 'confirm',
      idempotencyKey: 'confirm-plan-1',
      expectedRevision: 2,
    })
    const repeated = coordinator.dispatchCommand(runId, {
      type: 'confirm',
      idempotencyKey: 'confirm-plan-1',
      expectedRevision: 2,
    })

    expect(first.status).toBe('running')
    expect(repeated).toEqual(first)
    expect(skillPackageRepo.getRun(runId)).toMatchObject({ status: 'running', revision: 3, waiting_reason: null })
    expect(coordinator.subscribeEvents(runId, 1).map((event) => event.seq)).toEqual([2, 3])
  })

  it('merges input changes only while waiting for input', async () => {
    const { SkillRunCoordinator, version } = await loadRuntime()
    const coordinator = new SkillRunCoordinator()
    const { runId } = coordinator.startRun({ skillVersionId: version.id, input: { count: 1, style: 'editorial' }, context: {} })
    coordinator.transition(runId, 'waiting_input', { expectedRevision: 1, waitingReason: 'need settings' })

    const run = coordinator.dispatchCommand(runId, {
      type: 'modify',
      idempotencyKey: 'adjust-count',
      expectedRevision: 2,
      patchInput: { count: 3 },
    })

    expect(run.status).toBe('waiting_input')
    expect(run.input).toEqual({ count: 3, style: 'editorial' })
  })

  it('records cancellation requests without overwriting the active state', async () => {
    const { SkillRunCoordinator, version } = await loadRuntime()
    const coordinator = new SkillRunCoordinator()
    const { runId } = coordinator.startRun({ skillVersionId: version.id, input: {}, context: {} })
    coordinator.transition(runId, 'running', { expectedRevision: 1 })

    const requested = coordinator.dispatchCommand(runId, {
      type: 'cancel',
      idempotencyKey: 'cancel-1',
      expectedRevision: 2,
    })

    expect(requested).toMatchObject({ status: 'running', cancelRequested: true, revision: 3 })
    expect(coordinator.transition(runId, 'cancelled', { expectedRevision: 3 }).status).toBe('cancelled')
  })

  it('rejects stale revisions without allowing concurrent writes to win', async () => {
    const { SkillRunConflictError, SkillRunCoordinator, version } = await loadRuntime()
    const coordinator = new SkillRunCoordinator()
    const { runId } = coordinator.startRun({ skillVersionId: version.id, input: {}, context: {} })

    coordinator.transition(runId, 'running', { expectedRevision: 1 })
    expect(() => coordinator.transition(runId, 'failed', { expectedRevision: 1, errorCode: 'STALE' }))
      .toThrow(SkillRunConflictError)
    expect(coordinator.getRun(runId)).toMatchObject({ status: 'running', revision: 2 })
  })

  it('marks stranded running runs interrupted and resumes them through validation', async () => {
    const { SkillRunCoordinator, skillPackageRepo, version } = await loadRuntime()
    const coordinator = new SkillRunCoordinator()
    const { runId } = coordinator.startRun({ skillVersionId: version.id, input: {}, context: {} })
    coordinator.transition(runId, 'running', { expectedRevision: 1 })

    expect(coordinator.markInterruptedRuns()).toBe(1)
    expect(skillPackageRepo.getRun(runId)).toMatchObject({ status: 'interrupted', revision: 3 })
    expect(coordinator.resumeRun(runId, { expectedRevision: 3 }).status).toBe('validating')
  })

  it('allows a running run to finish with recoverable errors', async () => {
    const { SkillRunCoordinator, version } = await loadRuntime()
    const coordinator = new SkillRunCoordinator()
    const { runId } = coordinator.startRun({ skillVersionId: version.id, input: {}, context: {} })
    coordinator.transition(runId, 'running', { expectedRevision: 1 })

    const run = coordinator.transition(runId, 'completed_with_errors', {
      expectedRevision: 2,
      output: { generated: 5, failed: 1 },
    })

    expect(run).toMatchObject({ status: 'completed_with_errors', output: { generated: 5, failed: 1 } })
    expect(run.finishedAt).toEqual(expect.any(Number))
  })
})
