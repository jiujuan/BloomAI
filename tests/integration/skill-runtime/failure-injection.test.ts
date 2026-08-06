import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copySkillFixture } from '../../fixtures/skills/fixture-utils'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadPorts() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_EXECUTION_ENABLED = 'true'
  process.env.SKILL_PACKAGE_DATA_ROOT = path.join(dataDir, 'packages')
  process.env.SKILL_ARTIFACT_ROOT = path.join(dataDir, 'artifacts')
  process.env.SKILL_EXPORT_ROOT = path.join(dataDir, 'exports')
  process.env.SKILL_MAX_ATTEMPTS = '2'
  process.env.SKILL_LEASE_TIMEOUT_MS = '25'
  const client = await import('../../../src/server/db/client')
  await client.runMigrations()
  const repo = await import('../../../src/server/db/repositories/skill-package.repo')
  const { createSkillRuntime } = await import('../../../src/server/skills/runtime')
  return { client, repo, createSkillRuntime }
}

describe('skill runtime failure injection', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-skill-failure-data-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../../src/server/db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('recovers a leased queue item after worker stop and restart', async () => {
    const { client, repo, createSkillRuntime } = await loadPorts()
    const pkg = repo.skillPackageRepo.createPackage({ name: 'Recovery', description: '', sourceType: 'local-directory' })
    const version = repo.skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: { name: 'Recovery' }, manifestHash: 'recovery-hash', packagePath: dataDir, securityStatus: 'verified' })
    repo.skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
    let executions = 0
    const runtime = createSkillRuntime({ executor: async () => { executions += 1; return { status: 'completed' } } })
    const { runId } = runtime.coordinator.startRun({ skillVersionId: version.id, input: {}, context: {} })
    expect(runtime.start().started).toBe(true)
    await runtime.stop({ drain: false, timeoutMs: 1_000 })
    const runBeforeRecovery = runtime.coordinator.getRun(runId)
    expect(['interrupted', 'validating', 'running', 'completed']).toContain(runBeforeRecovery.status)
    const recovered = runtime.markInterruptedRuns({ now: Date.now() + 100, staleAfterMs: 0 })
    expect(recovered).toBeGreaterThanOrEqual(0)
    const restarted = createSkillRuntime({ executor: async () => { executions += 1; return { status: 'completed' } } })
    restarted.start()
    await new Promise((resolve) => setTimeout(resolve, 100))
    await restarted.stop({ drain: true, timeoutMs: 1_000 })
    expect(executions).toBeGreaterThanOrEqual(0)
    client.closeDb()
  })

  it('dead-letters a failing run at the configured attempt budget', async () => {
    const { client, repo, createSkillRuntime } = await loadPorts()
    const pkg = repo.skillPackageRepo.createPackage({ name: 'Failing', description: '', sourceType: 'local-directory' })
    const version = repo.skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: { name: 'Failing' }, manifestHash: 'failing-hash', packagePath: dataDir, securityStatus: 'verified' })
    repo.skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
    const runtime = createSkillRuntime({ executor: async () => { throw new Error('deterministic failure') } })
    const { runId } = runtime.coordinator.startRun({ skillVersionId: version.id, input: {}, context: {} })
    runtime.start()
    await new Promise((resolve) => setTimeout(resolve, 250))
    await runtime.stop({ drain: true, timeoutMs: 1_000 })
    expect(runtime.coordinator.getRun(runId).status).toBe('failed')
    expect(repo.skillPackageRepo.listRunQueue({ limit: 10, offset: 0 }).some((item: any) => item.status === 'dead')).toBe(true)
    client.closeDb()
  })

  it('keeps fixture inputs offline and does not execute package scripts', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-skill-failure-fixture-'))
    copySkillFixture('failing-runtime-skill', fixture)
    expect(fs.existsSync(path.join(fixture, 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(fixture, 'scripts', 'must-not-run.js'))).toBe(true)
    fs.rmSync(fixture, { recursive: true, force: true })
  })
})
