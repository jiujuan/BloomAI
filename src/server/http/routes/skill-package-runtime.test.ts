import fs from 'fs'
import os from 'os'
import path from 'path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { skill_artifacts, skill_run_queue, skill_runs_v2 } from '../../db/schema'

let dataDir: string
let fixtureDir: string
let exportDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadApi(env: Record<string, string> = {}) {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = env.SKILL_PACKAGE_RUNTIME_ENABLED ?? 'true'
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const app = createHonoApp()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { legacySkillRepo } = await import('../../db/repositories/skill.repo')
  const { ArtifactStore } = await import('../../skills/artifacts')
  return { app, client, skillPackageRepo, legacySkillRepo, ArtifactStore }
}

function writeFixture(relativePath: string, content: string) {
  const target = path.join(fixtureDir, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

async function requestJson(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, route: string, init?: RequestInit) {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-bloom-role': 'admin', ...(init?.headers ?? {}) },
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
    securityStatus: 'verified',
  })
  const installation = repo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
  return { pkg, version, installation }
}

describe('Skill Package Runtime HTTP API', () => {
  it('returns a redacted runtime capability summary', async () => {
    const { app } = await loadApi()
    const response = await app.request(new URL('/api/v1/skill-runtime/capabilities', 'http://localhost'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ protocolVersion: '1.1', runtimeEnabled: true })
    expect(body.data).not.toHaveProperty('packageDataRoot')
    expect(body.data).not.toHaveProperty('artifactRoot')
  })
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-runtime-data-'))
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-runtime-fixture-'))
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-runtime-export-'))
    originalEnv = { ...process.env }
    process.env.SKILL_EXPORT_ROOT = exportDir
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

  it('returns FEATURE_DISABLED when package import is disabled', async () => {
    const { app } = await loadApi({ SKILL_PACKAGE_RUNTIME_ENABLED: 'false', SKILL_PACKAGE_IMPORT_ENABLED: 'false' })
    const result = await requestJson(app, '/skill-packages/inspect', {
      method: 'POST',
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir } }),
    })
    expect(result.response.status).toBe(409)
    expect(result.body.error).toMatchObject({ code: 'FEATURE_DISABLED' })
  })

  it('rejects command-shaped source metadata instead of accepting arbitrary shell input', async () => {
    const { app } = await loadApi()
    const result = await requestJson(app, '/skill-packages/inspect', {
      method: 'POST',
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir, command: 'powershell -Command Get-ChildItem' } }),
    })
    expect(result.response.status).toBe(400)
    expect(result.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('validates JSON input and returns the uniform error envelope', async () => {
    const { app } = await loadApi()
    const response = await app.request('/api/v1/skill-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request body must be valid JSON',
        details: {},
        retryable: false,
        requestId: expect.any(String),
      },
    })
  })

  it('inspects without persistence and installs packages', async () => {
    writeFixture('writer/SKILL.md', '# Writer\n')
    writeFixture('writer/references/style.md', '# Style\n')
    const { app } = await loadApi()
    const payload = { source: { kind: 'local-directory', directory: fixtureDir } }

    const inspected = await requestJson(app, '/skill-packages/inspect', { method: 'POST', body: JSON.stringify(payload) })
    expect(inspected.response.status).toBe(200)
    expect(inspected.body.data.reviewId).toEqual(expect.any(String))
    expect(inspected.body.data.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(inspected.body.data.packages).toHaveLength(1)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'packages'))).toBe(false)

    const review = await requestJson(app, `/skill-import-reviews/${inspected.body.data.reviewId}`)
    expect(review.response.status).toBe(200)
    expect(review.body.data).toMatchObject({
      id: inspected.body.data.reviewId,
      sourceSha: inspected.body.data.sourceFingerprint,
      status: 'validated',
    })

    const installed = await requestJson(app, '/skill-packages/install', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        reviewId: inspected.body.data.reviewId,
        sourceFingerprint: inspected.body.data.sourceFingerprint,
        confirm: true,
      }),
    })
    expect(installed.response.status).toBe(201)
    expect(installed.body.data.status).toBe('awaiting_permission_review')
    expect(installed.body.data.packages).toHaveLength(1)
  })

  it('supports approving and rejecting import reviews through the HTTP contract', async () => {
    writeFixture('approved/SKILL.md', '# Approved\n')
    const { app } = await loadApi()

    const inspected = await requestJson(app, '/skill-packages/inspect', {
      method: 'POST',
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir } }),
    })
    const reviewId = inspected.body.data.reviewId

    const approved = await requestJson(app, `/skill-import-reviews/${reviewId}/approve`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'operator-1' },
      body: JSON.stringify({}),
    })
    expect(approved.response.status).toBe(200)
    expect(approved.body.data).toMatchObject({ id: reviewId, status: 'approved', reviewer: 'operator-1' })

    const missing = await requestJson(app, '/skill-import-reviews/missing')
    expect(missing.response.status).toBe(404)
    expect(missing.body.error.code).toBe('NOT_FOUND')

    writeFixture('rejected/SKILL.md', '# Rejected\n')
    const rejectedInspection = await requestJson(app, '/skill-packages/inspect', {
      method: 'POST',
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir } }),
    })
    const rejected = await requestJson(app, `/skill-import-reviews/${rejectedInspection.body.data.reviewId}/reject`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'operator-2' },
      body: JSON.stringify({ reason: 'Policy review failed' }),
    })
    expect(rejected.response.status).toBe(200)
    expect(rejected.body.data).toMatchObject({ status: 'rejected', reviewer: 'operator-2' })

    const rejectedInstall = await requestJson(app, '/skill-packages/install', {
      method: 'POST',
      body: JSON.stringify({
        source: { kind: 'local-directory', directory: fixtureDir },
        reviewId: rejectedInspection.body.data.reviewId,
        sourceFingerprint: rejectedInspection.body.data.sourceFingerprint,
        confirm: true,
      }),
    })
    expect(rejectedInstall.response.status).toBe(400)
    expect(rejectedInstall.body.error.code).toBe('PACKAGE_INSTALL_ERROR')
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

    const uninstalled = await requestJson(app, '/skill-installations/' + installation.id, { method: 'DELETE', body: JSON.stringify({ expectedRevision: 0, idempotencyKey: 'uninstall-http-1' }) })
    expect(uninstalled.response.status).toBe(200)
    expect(uninstalled.body.data).toMatchObject({ uninstalled: true, installation: { status: 'uninstalled', enabled: 0 } })
    const duplicateUninstall = await requestJson(app, '/skill-installations/' + installation.id, { method: 'DELETE', body: JSON.stringify({ expectedRevision: 0, idempotencyKey: 'uninstall-http-1' }) })
    expect(duplicateUninstall.response.status).toBe(200)
    expect(duplicateUninstall.body.data.installation).toMatchObject({ status: 'uninstalled', enabled: 0 })
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
      body: JSON.stringify({ enabled: false, expectedRevision: 0, idempotencyKey: 'disable-http-1' }),
    })
    expect(disabled.response.status).toBe(200)
    expect(disabled.body.data).toMatchObject({ id: installation.id, enabled: 0 })

    const revoked = await requestJson(app, '/skill-capability-grants/' + grant.id, { method: 'DELETE', headers: { 'x-bloom-actor': 'admin-1' } })
    expect(revoked.response.status).toBe(200)
    expect(revoked.body).toMatchObject({ data: { revoked: true }, meta: { requestId: expect.any(String) } })
    const duplicateRevoke = await requestJson(app, '/skill-capability-grants/' + grant.id, { method: 'DELETE', headers: { 'x-bloom-actor': 'admin-1' } })
    expect(duplicateRevoke.response.status).toBe(200)
    expect(duplicateRevoke.body.data).toMatchObject({ revoked: true, grant: { status: 'revoked' } })

    const after = await requestJson(app, '/skill-packages/' + pkg.id)
    expect(after.body.data.capabilityGrants[0].revoked_at).toEqual(expect.any(Number))
  })

  it('exposes capability approval lifecycle and run capability status', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const pkg = skillPackageRepo.createPackage({ name: 'Approval Package', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '1.0.0',
      manifest: { requestedCapabilities: [{ capability: 'web.search', scope: { allowedDomains: ['example.com'], maxCalls: 2 } }] },
      manifestHash: 'approval-package-hash',
      packagePath: path.join(dataDir, 'packages', 'approval-package-hash'),
      securityStatus: 'verified',
    })
    skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })

    const created = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillVersionId: `package:${version.id}`, input: {} }) })
    expect(created.response.status).toBe(201)
    const runId = created.body.data.runId as string

    const pending = await requestJson(app, `/skill-runs/${runId}/capabilities`)
    expect(pending.response.status).toBe(200)
    expect(pending.body.data).toEqual([expect.objectContaining({ capability: 'web.search', state: 'approval_required', grantStatus: 'pending' })])
    const grantId = pending.body.data[0].grantId as string

    const approved = await requestJson(app, `/skill-capability-grants/${grantId}/approve`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'admin-1' },
      body: JSON.stringify({ scope: { allowedDomains: ['example.com'], maxCalls: 1 } }),
    })
    expect(approved.response.status).toBe(200)
    expect(approved.body.data).toMatchObject({ grantId, status: 'approved', approvedBy: 'admin-1', grantedScope: { allowedDomains: ['example.com'], maxCalls: 1 } })

    const granted = await requestJson(app, `/skill-runs/${runId}/capabilities`)
    expect(granted.body.data[0]).toMatchObject({ state: 'granted', grantStatus: 'approved' })

    const invalidActor = await requestJson(app, `/skill-capability-grants/${grantId}/revoke`, { method: 'POST', headers: { 'x-bloom-actor': 'admin-1' }, body: JSON.stringify({ actor: '' }) })
    expect(invalidActor.response.status).toBe(400)
    expect(invalidActor.body.error.code).toBe('VALIDATION_ERROR')

    const revoked = await requestJson(app, `/skill-capability-grants/${grantId}/revoke`, { method: 'POST', headers: { 'x-bloom-actor': 'admin-1' }, body: JSON.stringify({ reason: 'test cleanup' }) })
    expect(revoked.response.status).toBe(200)
    expect(revoked.body.data).toMatchObject({ grantId, status: 'revoked', revokeReason: 'test cleanup' })
  })

  it('creates, lists, retrieves, filters events, commands idempotently, and cancels runs', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { pkg, version } = createRunnableFixture(skillPackageRepo)

    const created = await requestJson(app, '/skill-runs', {
      method: 'POST',
      body: JSON.stringify({ skillId: `package:${pkg.id}`, input: { article: 'Hello' }, context: { locale: 'zh-CN' } }),
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
    expect(events.body.meta).toMatchObject({ afterSeq: 1, requestId: expect.any(String) })
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
      body: JSON.stringify({ skillVersionId: `package:${version.id}`, input: {} }),
    })
    expect(response.response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })

  it('lists, previews, updates, diffs, and switches immutable package versions', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { pkg, version: current, installation } = createRunnableFixture(skillPackageRepo)
    const candidate = {
      version: '2.0.0',
      manifest: {
        name: 'Runnable Package',
        description: 'updated',
        requestedCapabilities: [{ capability: 'web.search', scope: { allowedDomains: ['example.com'] } }],
        prompt: 'private prompt must not be returned verbatim',
        files: [{ path: 'SKILL.md', sha256: 'new-file-sha', sizeBytes: 128 }],
      },
      manifestHash: 'runnable-package-v2-hash',
      packagePath: path.join(dataDir, 'packages', 'runnable-package-v2-hash'),
      sourceSnapshot: { sourceSha256: 'runnable-package-v2-source', files: [{ path: 'SKILL.md', sha256: 'new-file-sha' }] },
      securityStatus: 'verified',
    }

    const listed = await requestJson(app, `/skill-packages/${pkg.id}/versions`)
    expect(listed.response.status).toBe(200)
    expect(listed.body.data).toHaveLength(1)
    expect(listed.body.data[0]).toMatchObject({ id: current.id, packageId: pkg.id, immutableHash: expect.any(String), status: 'runnable' })

    const detail = await requestJson(app, `/skill-versions/${current.id}`)
    expect(detail.response.status).toBe(200)
    expect(detail.body.data).toMatchObject({ id: current.id, packageId: pkg.id, manifest: { name: 'Runnable Package' } })
    expect(detail.body.data).not.toHaveProperty('manifest_json')

    const preview = await requestJson(app, `/skill-packages/${pkg.id}/update/preview`, { method: 'POST', body: JSON.stringify(candidate) })
    expect(preview.response.status).toBe(200)
    expect(preview.body.data).toMatchObject({ packageId: pkg.id, currentVersionId: current.id, duplicate: false, checks: { compatible: true } })
    expect(preview.body.data.diff.capabilities.added).toEqual(['web.search'])
    expect(preview.body.data.diff.manifestChanges.find((change: any) => change.path === 'prompt')).toMatchObject({ to: { changed: true, sha256: expect.any(String) } })
    expect(JSON.stringify(preview.body.data.diff)).not.toContain('private prompt must not be returned verbatim')

    const updated = await requestJson(app, `/skill-packages/${pkg.id}/update`, { method: 'POST', body: JSON.stringify({ ...candidate, confirm: true }) })
    expect(updated.response.status).toBe(201)
    expect(updated.body.data).toMatchObject({ packageId: pkg.id, duplicate: false, currentVersionId: current.id })
    const nextVersionId = updated.body.data.version.id as string
    expect(nextVersionId).not.toBe(current.id)
    expect(skillPackageRepo.getInstallation(installation.id)).toMatchObject({ current_version_id: current.id, revision: 0 })

    const diff = await requestJson(app, `/skill-versions/${current.id}/diff?toVersionId=${encodeURIComponent(nextVersionId)}`)
    expect(diff.response.status).toBe(200)
    expect(diff.body.data).toMatchObject({ fromVersionId: current.id, toVersionId: nextVersionId, sourceShaChanged: true, capabilities: { added: ['web.search'] } })
    expect(JSON.stringify(diff.body.data)).not.toContain('private prompt must not be returned verbatim')

    const switched = await requestJson(app, `/skill-installations/${installation.id}/switch-version`, {
      method: 'POST',
      body: JSON.stringify({ versionId: nextVersionId, expectedRevision: 0, idempotencyKey: 'switch-v2-http' }),
    })
    expect(switched.response.status).toBe(200)
    expect(switched.body.data).toMatchObject({ id: installation.id, currentVersionId: nextVersionId, previousVersionId: current.id, revision: 1 })

    const duplicateSwitch = await requestJson(app, `/skill-installations/${installation.id}/switch-version`, {
      method: 'POST',
      body: JSON.stringify({ versionId: nextVersionId, expectedRevision: 0, idempotencyKey: 'switch-v2-http' }),
    })
    expect(duplicateSwitch.response.status).toBe(200)
    expect(duplicateSwitch.body.data).toMatchObject({ currentVersionId: nextVersionId, revision: 1 })

    const conflict = await requestJson(app, `/skill-installations/${installation.id}/switch-version`, {
      method: 'POST',
      body: JSON.stringify({ versionId: current.id, expectedRevision: 0, idempotencyKey: 'stale-switch-http' }),
    })
    expect(conflict.response.status).toBe(409)
    expect(conflict.body.error.code).toBe('REVISION_CONFLICT')
  })
  it('disables new runs while preserving an existing run, then supports enable and rollback', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { pkg, version: current, installation } = createRunnableFixture(skillPackageRepo)
    const started = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillVersionId: `package:${current.id}`, input: { beforeDisable: true } }) })
    expect(started.response.status).toBe(201)
    const runId = started.body.data.runId as string

    const disabled = await requestJson(app, `/skill-installations/${installation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false, expectedRevision: 0, idempotencyKey: 'lifecycle-disable-1' }),
    })
    expect(disabled.response.status).toBe(200)
    expect(disabled.body.data).toMatchObject({ status: 'disabled', enabled: 0, revision: 1 })
    expect((await requestJson(app, `/skill-runs/${runId}`)).response.status).toBe(200)

    const rejectedRun = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillVersionId: `package:${current.id}`, input: { afterDisable: true } }) })
    expect(rejectedRun.response.status).toBe(404)

    const enabled = await requestJson(app, `/skill-installations/${installation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true, expectedRevision: 1, idempotencyKey: 'lifecycle-enable-1' }),
    })
    expect(enabled.response.status).toBe(200)
    expect(enabled.body.data).toMatchObject({ status: 'installed', enabled: 1, revision: 2 })

    const nextVersion = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '2.0.0',
      manifest: { name: 'Runnable Package v2' },
      manifestHash: 'runnable-package-v2-lifecycle-hash',
      packagePath: path.join(dataDir, 'packages', 'runnable-package-v2-lifecycle-hash'),
      securityStatus: 'verified',
    })
    const switched = await requestJson(app, `/skill-installations/${installation.id}/switch-version`, {
      method: 'POST',
      body: JSON.stringify({ versionId: nextVersion.id, expectedRevision: 2, idempotencyKey: 'lifecycle-switch-1' }),
    })
    expect(switched.response.status).toBe(200)
    const rolledBack = await requestJson(app, `/skill-installations/${installation.id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ versionId: current.id, expectedRevision: 3, idempotencyKey: 'lifecycle-rollback-1', reason: 'verified rollback after smoke failure' }),
    })
    expect(rolledBack.response.status).toBe(200)
    expect(rolledBack.body.data).toMatchObject({ currentVersionId: current.id, previousVersionId: nextVersion.id, rollbackReason: 'verified rollback after smoke failure', revision: 4 })
    expect(skillPackageRepo.getVersion(nextVersion.id)).toBeTruthy()
  })

  it('uninstalls and soft-deletes without removing package, version, run, or audit records', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { pkg, version, installation } = createRunnableFixture(skillPackageRepo)
    const uninstalled = await requestJson(app, `/skill-installations/${installation.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: 0, idempotencyKey: 'lifecycle-uninstall-1' }),
    })
    expect(uninstalled.response.status).toBe(200)
    expect(skillPackageRepo.getInstallation(installation.id)).toMatchObject({ status: 'uninstalled', enabled: 0, current_version_id: version.id })

    const deleted = await requestJson(app, `/skill-packages/${pkg.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true, idempotencyKey: 'lifecycle-delete-1', reason: 'retire test package' }),
    })
    expect(deleted.response.status).toBe(200)
    expect(deleted.body.data).toMatchObject({ id: pkg.id, deletedAt: expect.any(Number), deleteReason: 'retire test package' })
    expect(skillPackageRepo.getPackage(pkg.id)).toMatchObject({ deleted_at: expect.any(Number), delete_reason: 'retire test package' })
    expect(skillPackageRepo.getVersion(version.id)).toBeTruthy()
    expect(skillPackageRepo.getInstallation(installation.id)).toBeTruthy()
  })

  it('blocks package deletion while a Run is still active after uninstall', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const { pkg, version, installation } = createRunnableFixture(skillPackageRepo)
    const started = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillVersionId: `package:${version.id}`, input: {} }) })
    expect(started.response.status).toBe(201)
    const uninstalled = await requestJson(app, `/skill-installations/${installation.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: 0, idempotencyKey: 'lifecycle-uninstall-running-1' }),
    })
    expect(uninstalled.response.status).toBe(200)
    const deleted = await requestJson(app, `/skill-packages/${pkg.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true, idempotencyKey: 'lifecycle-delete-running-1', reason: 'must remain auditable' }),
    })
    expect(deleted.response.status).toBe(409)
    expect(deleted.body.error.code).toBe('CONFLICT')
  })

  it('lists, reads, and exports artifacts for a run', async () => {
    const { app, skillPackageRepo, ArtifactStore } = await loadApi()
    const { pkg } = createRunnableFixture(skillPackageRepo)
    const created = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillId: `package:${pkg.id}`, input: {} }) })
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
      headers: { 'x-bloom-actor': 'http-test-user' },
      body: JSON.stringify({ runId, destinationDir: exportDir, confirmed: true, auditReason: 'Export generated artifact for verification' }),
    })
    expect(exported.response.status).toBe(200)
    expect(exported.body.data.path).toBe(path.join(exportDir, 'summary.md'))
    expect(fs.readFileSync(exported.body.data.path, 'utf8')).toBe('# Done')
  })

  it('rejects artifact reads and exports when a valid artifact id is requested through another run id', async () => {
    const { app, skillPackageRepo, ArtifactStore } = await loadApi()
    const { pkg } = createRunnableFixture(skillPackageRepo)
    const first = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillId: `package:${pkg.id}`, input: { article: 'first' } }) })
    const second = await requestJson(app, '/skill-runs', { method: 'POST', body: JSON.stringify({ skillId: `package:${pkg.id}`, input: { article: 'second' } }) })
    const firstRunId = first.body.data.runId as string
    const secondRunId = second.body.data.runId as string
    const artifact = new ArtifactStore().writeText({ runId: firstRunId, kind: 'markdown', fileName: 'summary.md', content: '# Done' })

    const missingRunId = await app.request(`/api/v1/skill-artifacts/${artifact.id}/content`)
    expect(missingRunId.status).toBe(400)

    const otherRunContent = await app.request(`/api/v1/skill-artifacts/${artifact.id}/content?runId=${encodeURIComponent(secondRunId)}`)
    expect(otherRunContent.status).toBe(404)

    const otherRunExport = await requestJson(app, `/skill-artifacts/${artifact.id}/export`, {
      method: 'POST',
      headers: { 'x-bloom-actor': 'http-test-user' },
      body: JSON.stringify({ runId: secondRunId, destinationDir: exportDir, confirmed: true, auditReason: 'Verify artifact ownership enforcement' }),
    })
    expect(otherRunExport.response.status).toBe(404)
    expect(otherRunExport.body.error.code).toBe('NOT_FOUND')
  })

  it('blocks Legacy execution before creating any run, queue, worker, grant, or artifact record', async () => {
    const { app, client, skillPackageRepo, legacySkillRepo } = await loadApi()
    const legacy = legacySkillRepo.create({
      name: 'Legacy adder',
      description: '',
      type: 'js-function',
      source: 'function run(input) { return { total: input.a + input.b } }',
    })

    const legacyRun = await requestJson(app, `/skills/${legacy.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ input: { a: 2, b: 3 } }),
    })
    expect(legacyRun.response.status).toBe(404)
    expect(legacySkillRepo.listRuns(legacy.id)).toHaveLength(0)

    const legacyPackageRun = await requestJson(app, '/skill-runs', {
      method: 'POST',
      body: JSON.stringify({ skillId: `legacy:${legacy.id}`, input: { a: 2, b: 3 } }),
    })
    expect(legacyPackageRun.response.status).toBe(409)
    expect(legacyPackageRun.body.error).toMatchObject({ code: 'LEGACY_SKILL_RUN_DISABLED' })
    expect(legacyPackageRun.body.error).toMatchObject({
      details: {
        legacyReference: `legacy:${legacy.id}`,
        migrationAction: 'preview-legacy-skill-migration',
      },
    })

    const counts = () => ({
      packageRuns: Number(client.getOrmDb().select({ count: sql<number>`count(*)` }).from(skill_runs_v2).get()?.count ?? 0),
      queueItems: Number(client.getOrmDb().select({ count: sql<number>`count(*)` }).from(skill_run_queue).get()?.count ?? 0),
      artifacts: Number(client.getOrmDb().select({ count: sql<number>`count(*)` }).from(skill_artifacts).get()?.count ?? 0),
      activeWorkers: Number(client.getOrmDb().select({ count: sql<number>`count(*)` }).from(skill_runs_v2).where(sql`${skill_runs_v2.worker_id} is not null`).get()?.count ?? 0),
    })
    expect(counts()).toEqual({ packageRuns: 0, queueItems: 0, artifacts: 0, activeWorkers: 0 })

    const { pkg } = createRunnableFixture(skillPackageRepo)
    const packageRun = await requestJson(app, `/skills/package:${pkg.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ input: {} }),
    })
    expect(packageRun.response.status).toBe(404)
    expect(counts()).toEqual({ packageRuns: 0, queueItems: 0, artifacts: 0, activeWorkers: 0 })
  })
})
