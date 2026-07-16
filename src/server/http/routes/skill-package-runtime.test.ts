import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let fixtureDir: string
let exportDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const app = createHonoApp()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { skillRepo } = await import('../../db/repositories/skill.repo')
  const { ArtifactStore } = await import('../../skills/artifacts')
  return { app, client, skillPackageRepo, skillRepo, ArtifactStore }
}

function writeFixture(relativePath: string, content: string) {
  const target = path.join(fixtureDir, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

async function requestJson(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, route: string, init?: RequestInit) {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return { response, body: await response.json() as any }
}

function createRunnableFixture(repo: Awaited<ReturnType<typeof loadApi>>['skillPackageRepo']) {
  const pkg = repo.createPackage({ name: 'Runnable Package', description: '', sourceType: 'local-directory' })
  const version = repo.createVersion({
    packageId: pkg.id,
    version: '1.0.0',
    manifest: { name: 'Runnable Package' },
    manifestHash: 'runnable-package-hash',
    packagePath: path.join(dataDir, 'packages', 'runnable-package-hash'),
  })
  const installation = repo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
  return { pkg, version, installation }
}

describe('Skill Package Runtime HTTP API', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-http-runtime-data-'))
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-http-runtime-fixture-'))
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-http-runtime-export-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(fixtureDir, { recursive: true, force: true })
    fs.rmSync(exportDir, { recursive: true, force: true })
  })

  it('validates JSON input and returns the uniform error envelope', async () => {
    const { app } = await loadApi()
    const response = await app.request('/api/v1/skill-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' } })
  })

  it('inspects without persistence and installs packages', async () => {
    writeFixture('writer/SKILL.md', '# Writer\n')
    writeFixture('writer/references/style.md', '# Style\n')
    const { app } = await loadApi()
    const payload = { source: { kind: 'local-directory', directory: fixtureDir } }

    const inspected = await requestJson(app, '/skill-packages/inspect', { method: 'POST', body: JSON.stringify(payload) })
    expect(inspected.response.status).toBe(200)
    expect(inspected.body.data.packages).toHaveLength(1)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'packages'))).toBe(false)

    const installed = await requestJson(app, '/skill-packages/install', { method: 'POST', body: JSON.stringify(payload) })
    expect(installed.response.status).toBe(201)
    expect(installed.body.data.status).toBe('awaiting_permission_review')
    expect(installed.body.data.packages).toHaveLength(1)
  })

  it('paginates, fetches, and uninstalls persisted package records', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const pkg = skillPackageRepo.createPackage({ name: 'Listed Package', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: {}, manifestHash: 'listed-hash', packagePath: '/listed' })
    const installation = skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'awaiting_permission_review', enabled: false })

    const listed = await requestJson(app, '/skill-packages?limit=1&offset=0')
    expect(listed.response.status).toBe(200)
    expect(listed.body.meta).toMatchObject({ limit: 1, offset: 0, total: 1 })
    expect(listed.body.data[0].id).toBe(pkg.id)

    const detail = await requestJson(app, `/skill-packages/${pkg.id}`)
    expect(detail.response.status).toBe(200)
    expect(detail.body.data.versions[0].id).toBe(version.id)
    expect(detail.body.data.installations[0].id).toBe(installation.id)

    const uninstalled = await requestJson(app, '/skill-installations/' + installation.id, { method: 'DELETE' })
    expect(uninstalled.response.status).toBe(200)
    expect(uninstalled.body).toEqual({ data: { uninstalled: true } })
    expect((await requestJson(app, '/skill-installations/' + installation.id, { method: 'DELETE' })).response.status).toBe(404)
  })

  it('manages installation enablement and revokes capability grants', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { pkg, version, installation } = createRunnableFixture(skillPackageRepo)
    const grant = skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id,
      capability: 'web.fetch',
      grantMode: 'persistent',
      scope: { allowedDomains: ['example.com'] },
      grantedBy: 'user',
    })

    const before = await requestJson(app, '/skill-packages/' + pkg.id)
    expect(before.response.status).toBe(200)
    expect(before.body.data.capabilityGrants).toHaveLength(1)
    expect(before.body.data.capabilityGrants[0]).toMatchObject({ id: grant.id, skill_version_id: version.id })

    const disabled = await requestJson(app, '/skill-installations/' + installation.id, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    expect(disabled.response.status).toBe(200)
    expect(disabled.body.data).toMatchObject({ id: installation.id, enabled: 0 })

    const revoked = await requestJson(app, '/skill-capability-grants/' + grant.id, { method: 'DELETE' })
    expect(revoked.response.status).toBe(200)
    expect(revoked.body).toEqual({ data: { revoked: true } })
    expect((await requestJson(app, '/skill-capability-grants/' + grant.id, { method: 'DELETE' })).response.status).toBe(404)

    const after = await requestJson(app, '/skill-packages/' + pkg.id)
    expect(after.body.data.capabilityGrants[0].revoked_at).toEqual(expect.any(Number))
  })

  it('creates, lists, retrieves, filters events, commands idempotently, and cancels runs', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { pkg, version } = createRunnableFixture(skillPackageRepo)

    const created = await requestJson(app, '/skill-runs', {
      method: 'POST',
      body: JSON.stringify({ skillId: pkg.id, input: { article: 'Hello' }, context: { locale: 'zh-CN' } }),
    })
    expect(created.response.status).toBe(201)
    expect(created.body.data).toMatchObject({ status: 'validating', revision: 1 })
    const runId = created.body.data.runId as string

    const listed = await requestJson(app, `/skill-runs?limit=1&skillVersionId=${version.id}&status=validating`)
    expect(listed.response.status, JSON.stringify(listed.body)).toBe(200)
    expect(listed.body.meta).toMatchObject({ limit: 1, offset: 0, total: 1 })
    expect(listed.body.data[0]).toMatchObject({ id: runId, skillVersionId: version.id, status: 'validating' })

    const fetched = await requestJson(app, `/skill-runs/${runId}`)
    expect(fetched.response.status).toBe(200)
    expect(fetched.body.data.context).toMatchObject({ locale: 'zh-CN' })

    const events = await requestJson(app, `/skill-runs/${runId}/events?afterSeq=1`)
    expect(events.response.status).toBe(200)
    expect(events.body.meta).toEqual({ afterSeq: 1 })
    expect(events.body.data).toHaveLength(1)
    expect(events.body.data[0]).toMatchObject({ seq: 2, type: 'run.status_changed' })

    const firstCancel = await requestJson(app, `/skill-runs/${runId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: 'cancel-once', expectedRevision: 1 }),
    })
    expect(firstCancel.response.status).toBe(200)
    expect(firstCancel.body.data).toMatchObject({ id: runId, revision: 2, cancelRequested: true })

    const duplicateCancel = await requestJson(app, `/skill-runs/${runId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ type: 'cancel', idempotencyKey: 'cancel-once', expectedRevision: 1 }),
    })
    expect(duplicateCancel.response.status).toBe(200)
    expect(duplicateCancel.body.data).toMatchObject({ id: runId, revision: 2, cancelRequested: true })

    const conflict = await requestJson(app, `/skill-runs/${runId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ type: 'cancel', idempotencyKey: 'cancel-late', expectedRevision: 1 }),
    })
    expect(conflict.response.status).toBe(409)
    expect(conflict.body.error.code).toBe('REVISION_CONFLICT')
  })

  it('rejects direct versions without an enabled installation', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const pkg = skillPackageRepo.createPackage({ name: 'Pending Package', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: {}, manifestHash: 'pending-hash', packagePath: '/pending' })
    skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'awaiting_permission_review', enabled: false })

    const response = await requestJson(app, '/skill-runs', {
      method: 'POST',
      body: JSON.stringify({ skillVersionId: version.id, input: {} }),
    })
    expect(response.response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })

  it('lists, reads, and exports artifacts for a run', async () => {
    const { app, skillPackageRepo, ArtifactStore } = await loadApi()
    const { pkg } = createRunnableFixture(skillPackageRepo)
    const created = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillId: pkg.id, input: {} }) })
    const runId = created.body.data.runId as string
    const artifact = new ArtifactStore().writeText({ runId, kind: 'markdown', fileName: 'summary.md', content: '# Done' })

    const artifacts = await requestJson(app, `/skill-runs/${runId}/artifacts`)
    expect(artifacts.response.status).toBe(200)
    expect(artifacts.body.data).toHaveLength(1)
    expect(artifacts.body.data[0].id).toBe(artifact.id)

    const content = await app.request(`/api/v1/skill-artifacts/${artifact.id}/content?runId=${encodeURIComponent(runId)}`)
    expect(content.status).toBe(200)
    expect(content.headers.get('content-type')).toContain('text/markdown')
    await expect(content.text()).resolves.toBe('# Done')

    const exported = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      body: JSON.stringify({ runId, destinationDir: exportDir }),
    })
    expect(exported.response.status).toBe(200)
    expect(exported.body.data.path).toBe(path.join(exportDir, 'summary.md'))
    expect(fs.readFileSync(exported.body.data.path, 'utf8')).toBe('# Done')
  })

  it('rejects artifact reads and exports when a valid artifact id is requested through another run id', async () => {
    const { app, skillPackageRepo, ArtifactStore } = await loadApi()
    const { pkg } = createRunnableFixture(skillPackageRepo)
    const first = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillId: pkg.id, input: { article: 'first' } }) })
    const second = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillId: pkg.id, input: { article: 'second' } }) })
    const firstRunId = first.body.data.runId as string
    const secondRunId = second.body.data.runId as string
    const artifact = new ArtifactStore().writeText({ runId: firstRunId, kind: 'markdown', fileName: 'summary.md', content: '# Done' })

    const missingRunId = await app.request(`/api/v1/skill-artifacts/${artifact.id}/content`)
    expect(missingRunId.status).toBe(400)

    const otherRunContent = await app.request(`/api/v1/skill-artifacts/${artifact.id}/content?runId=${encodeURIComponent(secondRunId)}`)
    expect(otherRunContent.status).toBe(404)

    const otherRunExport = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      body: JSON.stringify({ runId: secondRunId, destinationDir: exportDir }),
    })
    expect(otherRunExport.response.status).toBe(404)
    expect(otherRunExport.body.error.code).toBe('NOT_FOUND')
  })

  it('keeps Legacy Skills synchronous while blocking Package references from the old API', async () => {
    const { app, skillPackageRepo, skillRepo } = await loadApi()
    const legacy = skillRepo.create({
      name: 'Legacy adder',
      description: '',
      type: 'js-function',
      source: 'function run(input) { return { total: input.a + input.b } }',
    })
    const legacyRun = await requestJson(app, `/skills/${legacy.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ input: { a: 2, b: 3 } }),
    })
    expect(legacyRun.response.status).toBe(200)
    expect(legacyRun.body.data).toMatchObject({ total: 5 })

    const { pkg } = createRunnableFixture(skillPackageRepo)
    const packageRun = await requestJson(app, `/skills/${pkg.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ input: {} }),
    })
    expect(packageRun.response.status).toBe(409)
    expect(packageRun.body.error.code).toBe('PACKAGE_SKILL_ASYNC_ONLY')
  })
})
