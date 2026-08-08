import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type App = { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }

let dataDir: string
let packageRoot: string
let artifactRoot: string
let exportRoot: string
let originalEnv: NodeJS.ProcessEnv

const validContent = {
  name: 'Creator Writer',
  slug: 'creator-writer',
  version: '1.0.0',
  description: 'Created from the v1.2 backend',
  skillMd: '# Creator Writer\n\nWrite a clear answer.',
  references: { 'references/style.md': '# Style' },
  assets: [],
  capabilities: [],
  visibility: 'private' as const,
  author: 'alice',
}

async function loadApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_RUNTIME_ENABLED = 'true'
  process.env.SKILL_PACKAGE_EXECUTION_ENABLED = 'true'
  process.env.SKILL_PACKAGE_IMPORT_ENABLED = 'true'
  process.env.SKILL_CREATOR_ENABLED = 'true'
  process.env.SKILL_CREATOR_PUBLISH_ENABLED = 'true'
  process.env.SKILL_PACKAGE_DATA_ROOT = packageRoot
  process.env.SKILL_ARTIFACT_ROOT = artifactRoot
  process.env.SKILL_EXPORT_ROOT = exportRoot

  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  return { app: createHonoApp(), client, skillPackageRepo }
}

async function requestJson(app: App, route: string, init: RequestInit = {}, actor = 'alice', role = 'admin') {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-bloom-role': role,
      'x-bloom-actor': actor,
      ...(init.headers ?? {}),
    },
  })
  return { response, body: await response.json() as any }
}

describe('SKL12-P2-003 Creator and Runtime settings HTTP contract', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-003-data-'))
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-003-packages-'))
    artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-003-artifacts-'))
    exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p2-003-export-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    for (const directory of [dataDir, packageRoot, artifactRoot, exportRoot]) fs.rmSync(directory, { recursive: true, force: true })
  })

  it('supports owner-isolated draft list, revision CAS, validation, preview, and tracked publish', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const created = await requestJson(app, '/skill-drafts', { method: 'POST', body: JSON.stringify({ content: validContent, ownerId: 'spoofed-owner' }) })
    expect(created.response.status).toBe(400)

    const draft = await requestJson(app, '/skill-drafts', { method: 'POST', body: JSON.stringify({ content: validContent }) })
    expect(draft.response.status).toBe(201)
    expect(draft.body.data.ownerId).toBe('alice')
    const draftId = draft.body.data.id as string

    const ownList = await requestJson(app, '/skill-drafts?limit=10&offset=0', {}, 'alice', 'user')
    expect(ownList.response.status).toBe(200)
    expect(ownList.body.data).toHaveLength(1)
    expect(ownList.body.meta.page).toMatchObject({ limit: 10, offset: 0, total: 1 })

    const otherList = await requestJson(app, '/skill-drafts', {}, 'bob', 'user')
    expect(otherList.response.status).toBe(200)
    expect(otherList.body.data).toHaveLength(0)

    const stale = await requestJson(app, `/skill-drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 0, patch: { description: 'stale' } }) })
    expect(stale.response.status).toBe(409)
    expect(stale.body.error.code).toBe('REVISION_CONFLICT')

    const updated = await requestJson(app, `/skill-drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, patch: { description: 'updated' } }) })
    expect(updated.response.status).toBe(200)
    expect(updated.body.data.revision).toBe(2)

    const validation = await requestJson(app, `/skill-drafts/${draftId}/validate`, { method: 'POST', body: '{}' })
    expect(validation.response.status).toBe(200)
    expect(validation.body.data.valid).toBe(true)
    const preview = await requestJson(app, `/skill-drafts/${draftId}/preview`, { method: 'POST', body: '{}' })
    expect(preview.response.status).toBe(200)
    expect(preview.body.data.published).toBe(false)

    const published = await requestJson(app, `/skill-drafts/${draftId}/publish`, {
      method: 'POST',
      headers: { 'x-request-id': 'p2-003-publish-1' },
      body: JSON.stringify({ enable: true, expectedRevision: 2, idempotencyKey: 'creator-publish-1' }),
    })
    expect(published.response.status).toBe(201)
    expect(published.body.data).toMatchObject({
      draftId,
      installationEnabled: true,
      idempotent: false,
    })
    expect(skillPackageRepo.getDraft(draftId)).toMatchObject({ status: 'published', published_version_id: published.body.data.versionId })
    expect(skillPackageRepo.getVersion(published.body.data.versionId)).toMatchObject({ package_id: published.body.data.packageId })
    expect(skillPackageRepo.listVersions(published.body.data.packageId)).toHaveLength(1)
    expect(skillPackageRepo.getInstallation(published.body.data.installationId)).toMatchObject({ package_id: published.body.data.packageId, current_version_id: published.body.data.versionId })

    const audit = await requestJson(app, '/skill-runtime/audit?action=skill.draft.published&resourceId=' + draftId, {}, 'admin', 'admin')
    expect(audit.response.status).toBe(200)
    expect(audit.body.data[0]).toMatchObject({ actor: 'alice', resourceId: draftId, securityDecision: 'allowed', policyVersion: 'skills-admin-v1.2' })
    expect(audit.body.data[0].payload).toMatchObject({ requestId: 'p2-003-publish-1', packageId: published.body.data.packageId, versionId: published.body.data.versionId })
  })

  it('makes creator publish idempotent and rejects a different key or untrusted identity', async () => {
    const { app, skillPackageRepo } = await loadApi()
    const missingActor = await requestJson(app, '/skill-drafts', { method: 'POST', body: JSON.stringify({ content: validContent }) }, '', 'admin')
    expect(missingActor.response.status).toBe(403)

    const draft = await requestJson(app, '/skill-drafts', { method: 'POST', body: JSON.stringify({ content: validContent }) })
    const draftId = draft.body.data.id as string
    const first = await requestJson(app, `/skill-drafts/${draftId}/publish`, { method: 'POST', body: JSON.stringify({ idempotencyKey: 'same-key' }) })
    expect(first.response.status).toBe(201)

    const retry = await requestJson(app, `/skill-drafts/${draftId}/publish`, { method: 'POST', body: JSON.stringify({ idempotencyKey: 'same-key' }) })
    expect(retry.response.status).toBe(200)
    expect(retry.body.data).toMatchObject({ idempotent: true, packageId: first.body.data.packageId, versionId: first.body.data.versionId })

    const conflict = await requestJson(app, `/skill-drafts/${draftId}/publish`, { method: 'POST', body: JSON.stringify({ idempotencyKey: 'different-key' }) })
    expect(conflict.response.status).toBe(409)
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(skillPackageRepo.listPackages({ limit: 50, offset: 0 }).total).toBe(1)

    const spoofed = await requestJson(app, `/skill-drafts/${draftId}/publish`, { method: 'POST', body: JSON.stringify({ actor: 'bob', idempotencyKey: 'same-key' }) })
    expect(spoofed.response.status).toBe(400)
  })

  it('protects runtime settings, validates safe fields, audits updates, rolls back, and reflects them in diagnostics', async () => {
    const { app } = await loadApi()
    const denied = await requestJson(app, '/skill-runtime/settings', {}, 'alice', 'user')
    expect(denied.response.status).toBe(403)

    const initial = await requestJson(app, '/skill-runtime/settings', {}, 'admin', 'admin')
    expect(initial.response.status).toBe(200)
    expect(initial.body.data.runtime).not.toHaveProperty('legacyExecutionEnabled')
    expect(initial.body.data.runtime).not.toHaveProperty('packageDataRoot')
    expect(initial.body.data.featureFlags).toHaveProperty('creatorEnabled')

    const updated = await requestJson(app, '/skill-runtime/settings', {
      method: 'PATCH',
      headers: { 'x-request-id': 'p2-003-settings-1' },
      body: JSON.stringify({ runtime: { workerConcurrency: 4, packageExecutionEnabled: false }, featureFlags: { creatorEnabled: true } }),
    }, 'admin', 'admin')
    expect(updated.response.status).toBe(200)
    expect(updated.body.data.runtime.workerConcurrency).toBe(4)
    expect(updated.body.data.runtime.packageExecutionEnabled).toBe(false)
    expect(updated.body.data.featureFlags.creatorEnabled).toBe(true)

    const diagnostics = await requestJson(app, '/skill-runtime/diagnostics', {}, 'admin', 'admin')
    expect(diagnostics.response.status).toBe(200)
    expect(diagnostics.body.data.configuration).toMatchObject({ workerConcurrency: 4, packageExecutionEnabled: false })
    expect(diagnostics.body.data.health.status).toBe('degraded')

    const invalid = await requestJson(app, '/skill-runtime/settings', { method: 'PATCH', body: JSON.stringify({ runtime: { workerConcurrency: 0 } }) }, 'admin', 'admin')
    expect(invalid.response.status).toBe(400)
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR')

    const legacy = await requestJson(app, '/skill-runtime/settings', { method: 'PATCH', body: JSON.stringify({ runtime: { legacyExecutionEnabled: true }, legacyLifecycle: 'active' }) }, 'admin', 'admin')
    expect(legacy.response.status).toBe(400)
    expect(legacy.body.error.code).toBe('VALIDATION_ERROR')
    expect(JSON.stringify(legacy.body)).not.toContain('SKILL_LEGACY')

    const rolled = await requestJson(app, '/skill-runtime/settings/rollback', {
      method: 'POST',
      headers: { 'x-request-id': 'p2-003-settings-rollback' },
      body: JSON.stringify({}),
    }, 'admin', 'admin')
    expect(rolled.response.status).toBe(200)
    expect(rolled.body.data.runtime.workerConcurrency).toBe(1)
    expect(rolled.body.data.runtime.packageExecutionEnabled).toBe(true)

    const audit = await requestJson(app, '/skill-runtime/audit?action=skill.runtime.settings.updated', {}, 'admin', 'admin')
    expect(audit.response.status).toBe(200)
    expect(audit.body.data[0]).toMatchObject({ actor: 'admin', securityDecision: 'allowed', policyVersion: 'skills-admin-v1.2' })
    expect(audit.body.data[0].payload).toMatchObject({ requestId: 'p2-003-settings-1' })

    const ordinary = await requestJson(app, '/settings', { method: 'PATCH', body: JSON.stringify({ 'skill_runtime.workerConcurrency': '9' }) }, 'admin', 'admin')
    expect(ordinary.response.status).toBe(400)
  })
})
