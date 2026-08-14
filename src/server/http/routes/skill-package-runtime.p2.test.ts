import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let fixtureDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_IMPORT_ENABLED = 'true'
  process.env.SKILL_PACKAGE_EXECUTION_ENABLED = 'true'
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  return { app: createHonoApp(), client, skillPackageRepo }
}

async function requestJson(
  app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> },
  route: string,
  init: RequestInit = {},
) {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-bloom-role': 'admin', ...(init.headers ?? {}) },
  })
  return { response, body: await response.json() as any }
}

describe('SKL12-P2-001 Package/Import/Installation HTTP contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-001-data-'))
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-001-fixture-'))
    fs.writeFileSync(path.join(fixtureDir, 'SKILL.md'), '# P2 package\n')
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('allows user package and installation lifecycle operations', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const pkg = skillPackageRepo.createPackage({ name: 'Readable Package', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: {}, manifestHash: 'readable-hash', packagePath: fixtureDir, securityStatus: 'verified' })
    const installation = skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
    const deletable = skillPackageRepo.createPackage({ name: 'Deletable Package', description: '', sourceType: 'local-directory' })

    const read = await requestJson(app, '/skill-packages?search=Readable')
    expect(read.response.status).toBe(200)
    expect(read.body.data).toHaveLength(1)

    const userHeaders = { 'x-bloom-role': 'user' }
    const inspect = await requestJson(app, '/skill-packages/inspect', { method: 'POST', headers: userHeaders, body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir } }) })
    const approved = await requestJson(app, `/skill-import-reviews/${inspect.body.data.reviewId}/approve`, {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({}),
    })
    const install = await requestJson(app, '/skill-packages/install', { method: 'POST', headers: userHeaders, body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir }, reviewId: inspect.body.data.reviewId, sourceFingerprint: inspect.body.data.sourceFingerprint, confirm: true }) })
    const update = await requestJson(app, `/skill-packages/${pkg.id}/update`, {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({
        version: '2.0.0',
        manifest: { name: 'Readable Package', description: 'updated' },
        manifestHash: 'readable-v2-hash',
        packagePath: fixtureDir,
        sourceSnapshot: { sourceSha256: 'readable-v2-source', files: [] },
        securityStatus: 'verified',
        confirm: true,
      }),
    })
    const disable = await requestJson(app, `/skill-installations/${installation.id}`, { method: 'PATCH', headers: userHeaders, body: JSON.stringify({ enabled: false, expectedRevision: 0, idempotencyKey: 'p2-user-disable' }) })
    const remove = await requestJson(app, `/skill-packages/${deletable.id}`, { method: 'DELETE', headers: userHeaders, body: JSON.stringify({ confirm: true, idempotencyKey: 'p2-user-delete', reason: 'retire package' }) })

    expect(inspect.response.status).toBe(200)
    expect(inspect.body.data).toMatchObject({ reviewId: expect.any(String), sourceFingerprint: expect.any(String) })
    expect(approved.response.status).toBe(200)
    expect(approved.body.data.reviewer).toBe('local-user')
    expect(install.response.status).toBe(201)
    expect(install.body.data.status).toBe('awaiting_permission_review')
    expect(update.response.status).toBe(201)
    expect(update.body.data).toMatchObject({ packageId: pkg.id, duplicate: false })
    expect(disable.response.status).toBe(200)
    expect(disable.body.data).toMatchObject({ id: installation.id, enabled: 0, status: 'disabled' })
    expect(remove.response.status).toBe(200)
    expect(remove.body.data).toMatchObject({ id: deletable.id, deletedAt: expect.any(Number) })
  })

  it('filters archived packages, applies stable sorting, and reports the filtered total', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const alpha = skillPackageRepo.createPackage({ name: 'Alpha Package', description: 'first searchable package', sourceType: 'local-directory' })
    const beta = skillPackageRepo.createPackage({ name: 'Beta Package', description: 'second searchable package', sourceType: 'github-archive' })
    const gamma = skillPackageRepo.createPackage({ name: 'Gamma Package', description: 'third searchable package', sourceType: 'local-directory' })
    const archived = skillPackageRepo.createPackage({ name: 'Archived Package', description: 'searchable archived package', sourceType: 'local-directory' })
    skillPackageRepo.softDeletePackage({ packageId: archived.id, idempotencyKey: 'p2-catalog-archive', reason: 'catalog fixture' })

    const filtered = await requestJson(app, '/skill-packages?search=Package&sourceType=local-directory&sort=name&direction=asc&limit=1&offset=0')
    expect(filtered.response.status).toBe(200)
    expect(filtered.body.data.map((item: any) => item.name)).toEqual([alpha.name])
    expect(filtered.body.meta.page).toEqual({ limit: 1, offset: 0, total: 2 })

    const secondPage = await requestJson(app, '/skill-packages?search=Package&sourceType=local-directory&sort=name&direction=asc&limit=1&offset=1')
    expect(secondPage.response.status).toBe(200)
    expect(secondPage.body.data.map((item: any) => item.name)).toEqual([gamma.name])
    expect(secondPage.body.meta.page).toEqual({ limit: 1, offset: 1, total: 2 })

    const github = await requestJson(app, '/skill-packages?sourceType=github-archive&includeArchived=false&sort=name&direction=asc')
    expect(github.body.data.map((item: any) => item.id)).toEqual([beta.id])
    expect(github.body.meta.page.total).toBe(1)

    const archivedResult = await requestJson(app, '/skill-packages?search=Archived&includeArchived=true&sort=name&direction=asc')
    expect(archivedResult.response.status).toBe(200)
    expect(archivedResult.body.data.map((item: any) => item.id)).toEqual([archived.id])
    expect(archivedResult.body.meta.page.total).toBe(1)

    const invalidQuery = await requestJson(app, '/skill-packages?sort=name&unexpected=true')
    expect(invalidQuery.response.status).toBe(400)
    expect(invalidQuery.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('uses the authenticated actor for review decisions and audits installation lifecycle writes', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const inspected = await requestJson(app, '/skill-packages/inspect', {
      method: 'POST',
      headers: { 'x-bloom-actor': 'operator-1' },
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir } }),
    })
    expect(inspected.response.status).toBe(200)

    const approved = await requestJson(app, `/skill-import-reviews/${inspected.body.data.reviewId}/approve`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'operator-1' },
      body: JSON.stringify({}),
    })
    expect(approved.response.status).toBe(200)
    expect(approved.body.data.reviewer).toBe('operator-1')

    const pkg = skillPackageRepo.createPackage({ name: 'Audited Package', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: {}, manifestHash: 'audit-hash', packagePath: fixtureDir, securityStatus: 'verified' })
    const installation = skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
    const disabled = await requestJson(app, `/skill-installations/${installation.id}`, {
      method: 'PATCH',
      headers: { 'x-bloom-actor': 'operator-1' },
      body: JSON.stringify({ enabled: false, expectedRevision: 0, idempotencyKey: 'p2-audit-disable-1' }),
    })
    expect(disabled.response.status).toBe(200)

    const audit = await requestJson(app, '/skill-runtime/audit?action=skill.installation.disabled&resourceId=' + encodeURIComponent(installation.id))
    expect(audit.response.status).toBe(200)
    expect(audit.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: 'operator-1', action: 'skill.installation.disabled', resourceId: installation.id }),
    ]))
  })

  it('rejects spoofed reviewer fields and validates strict install/update payloads', async () => {
    const { app } = await loadApi()
    const inspected = await requestJson(app, '/skill-packages/inspect', { method: 'POST', body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir } }) })
    const spoofed = await requestJson(app, `/skill-import-reviews/${inspected.body.data.reviewId}/approve`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'operator-1' },
      body: JSON.stringify({ reviewer: 'spoofed-operator' }),
    })
    expect(spoofed.response.status).toBe(400)
    expect(spoofed.body.error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: expect.any(String) })

    const invalidInstall = await requestJson(app, '/skill-packages/install', {
      method: 'POST',
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir }, reviewId: 'review', sourceFingerprint: 'a'.repeat(64), confirm: true, unexpected: true }),
    })
    expect(invalidInstall.response.status).toBe(400)
    expect(invalidInstall.body.error.code).toBe('VALIDATION_ERROR')
  })
})
