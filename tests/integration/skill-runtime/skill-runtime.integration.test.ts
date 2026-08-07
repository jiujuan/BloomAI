import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copySkillFixture, fixturePath } from '../../fixtures/skills/fixture-utils'

let dataDir: string
let packageRoot: string
let artifactRoot: string
let exportRoot: string
let originalEnv: NodeJS.ProcessEnv

async function loadRuntimeApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_IMPORT_ENABLED = 'true'
  process.env.SKILL_PACKAGE_EXECUTION_ENABLED = 'true'
  process.env.SKILL_PACKAGE_DATA_ROOT = packageRoot
  process.env.SKILL_ARTIFACT_ROOT = artifactRoot
  process.env.SKILL_EXPORT_ROOT = exportRoot
  process.env.SKILL_WORKER_CONCURRENCY = '1'
  process.env.SKILL_LEASE_TIMEOUT_MS = '250'
  process.env.SKILL_MAX_ATTEMPTS = '2'
  const { createHonoApp } = await import('../../../src/server/http/app')
  const client = await import('../../../src/server/db/client')
  await client.runMigrations()
  const { createSkillRuntime } = await import('../../../src/server/skills/runtime')
  const { skillPackageRepo } = await import('../../../src/server/db/repositories/skill-package.repo')
  return { client, app: createHonoApp(), createSkillRuntime, skillPackageRepo }
}

async function requestJson(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, route: string, init?: RequestInit) {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return { response, body: await response.json() as any }
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = read()
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    value = read()
  }
  if (!predicate(value)) throw new Error(`Timed out waiting for state: ${JSON.stringify(value)}`)
  return value
}

describe('skill runtime offline integration vertical slice', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-runtime-integration-data-'))
    packageRoot = path.join(dataDir, 'packages')
    artifactRoot = path.join(dataDir, 'artifacts')
    exportRoot = path.join(dataDir, 'exports')
    fs.mkdirSync(exportRoot, { recursive: true })
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../../src/server/db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('runs inspect → install → HTTP run → durable queue → worker → artifact → export', async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-runtime-fixture-'))
    copySkillFixture('minimal-valid-skill', fixture)
    const { app, client, skillPackageRepo, createSkillRuntime } = await loadRuntimeApi()

    const inspected = await requestJson(app, '/skill-packages/inspect', {
      method: 'POST',
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixture } }),
    })
    expect(inspected.response.status).toBe(200)
    const inspection = inspected.body.data
    expect(inspection.reviewId).toEqual(expect.any(String))
    expect(inspection.packages).toHaveLength(1)

    const installed = await requestJson(app, '/skill-packages/install', {
      method: 'POST',
      body: JSON.stringify({
        source: { kind: 'local-directory', directory: fixture },
        reviewId: inspection.reviewId,
        sourceFingerprint: inspection.sourceFingerprint,
        confirm: true,
      }),
    })
    expect(installed.response.status).toBe(201)
    const installedPackage = installed.body.data.packages[0]
    expect(installedPackage.versionId).toEqual(expect.any(String))

    const packageRecord = skillPackageRepo.getPackage(installedPackage.packageId)
    const version = skillPackageRepo.getVersion(installedPackage.versionId)
    expect(packageRecord).toBeTruthy()
    expect(version).toBeTruthy()
    const installation = skillPackageRepo.createInstallation({
      packageId: installedPackage.packageId,
      currentVersionId: installedPackage.versionId,
      status: 'installed',
      enabled: true,
    })

    const { ArtifactStore } = await import('../../../src/server/skills/artifacts')
    const artifactStore = new ArtifactStore()
    const runtime = createSkillRuntime({
      executor: async (run) => {
        artifactStore.writeText({
          runId: run.id,
          kind: 'markdown',
          fileName: 'result.md',
          content: `# ${String(run.input.message ?? 'ok')}\n`,
        })
        return { status: 'completed', output: { ok: true, source: 'offline-fixture' } }
      },
    })
    expect(runtime.start()).toEqual({ started: true })

    const created = await requestJson(app, '/skill-runs', {
      method: 'POST',
      body: JSON.stringify({ skillVersionId: `package:${version!.id}`, input: { message: 'hello' } }),
    })
    expect(created.response.status).toBe(201)
    const runId = created.body.data.runId as string

    const completed = await waitFor(
      () => skillPackageRepo.getRun(runId),
      (run): run is NonNullable<typeof run> => Boolean(run && ['completed', 'failed'].includes(run.status)),
    )
    expect(completed).toBeDefined()
    if (!completed) throw new Error('Run disappeared after reaching a terminal state')
    expect(completed.status).toBe('completed')

    const artifacts = await requestJson(app, `/skill-runs/${runId}/artifacts`)
    expect(artifacts.response.status).toBe(200)
    expect(artifacts.body.data).toHaveLength(1)
    const artifact = artifacts.body.data[0]
    expect(fs.existsSync(path.join(artifactRoot, runId, artifact.path))).toBe(true)
    expect(artifact.runId).toBe(runId)

    const exported = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      body: JSON.stringify({ runId, destinationDir: exportRoot, confirmed: true, auditReason: 'offline integration acceptance' }),
    })
    expect(exported.response.status).toBe(200)
    expect(fs.existsSync(exported.body.data.path)).toBe(true)
    expect(installation.enabled).toBeTruthy()
    await runtime.stop({ drain: false })
    client.closeDb()
    fs.rmSync(fixture, { recursive: true, force: true })
  })

  it('keeps inspect side-effect free and blocks ownership crossover for artifact reads', async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-runtime-fixture-'))
    copySkillFixture('references-and-assets', fixture)
    const { app, client, skillPackageRepo, createSkillRuntime } = await loadRuntimeApi()
    const inspected = await requestJson(app, '/skill-packages/inspect', {
      method: 'POST',
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixture } }),
    })
    expect(inspected.response.status).toBe(200)
    expect(skillPackageRepo.listPackages({ limit: 10, offset: 0 }).total).toBe(0)

    const packageRecord = skillPackageRepo.createPackage({ name: 'Ownership fixture', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({ packageId: packageRecord.id, version: '1.0.0', manifest: { name: 'Ownership fixture' }, manifestHash: 'ownership-hash', packagePath: fixture, securityStatus: 'verified' })
    skillPackageRepo.createInstallation({ packageId: packageRecord.id, currentVersionId: version.id, status: 'installed', enabled: true })
    const runtime = createSkillRuntime({ executor: async () => ({ status: 'completed' }) })
    const started = runtime.coordinator.startRun({ skillVersionId: version.id, input: {}, context: {} })
    const { ArtifactStore } = await import('../../../src/server/skills/artifacts')
    const store = new ArtifactStore()
    const own = store.writeText({ runId: started.runId, kind: 'markdown', fileName: 'owned.md', content: 'owned' })
    const other = runtime.coordinator.startRun({ skillVersionId: version.id, input: {}, context: {} })
    const response = await requestJson(app, `/skill-artifacts/${own.id}/content?runId=${other.runId}`)
    expect(response.response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')

    client.closeDb()
    fs.rmSync(fixture, { recursive: true, force: true })
  })
})

