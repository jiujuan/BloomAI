import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  const client = await import('../../../src/server/db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../../../src/server/http/app')
  const { legacySkillRepo } = await import('../../../src/server/db/repositories/skill.repo')
  const { skillPackageRepo } = await import('../../../src/server/db/repositories/skill-package.repo')
  const { legacyMigrationRepo } = await import('../../../src/server/db/repositories/legacy-migration.repo')
  const { skill_audit_events, skill_drafts, skill_legacy_migrations, skill_packages, skill_version_snapshots, skill_versions, skill_installations } = await import('../../../src/server/db/schema')
  return { app: createHonoApp(), client, legacySkillRepo, skillPackageRepo, legacyMigrationRepo, tables: { skill_audit_events, skill_drafts, skill_legacy_migrations, skill_packages, skill_version_snapshots, skill_versions, skill_installations } }
}

async function requestJson(
  app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> },
  route: string,
  init: RequestInit = {},
) {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  })
  return { response, body: await response.json() as any }
}

function makeLegacy(legacySkillRepo: any, type: string, source: string) {
  return legacySkillRepo.create({ name: `Integration ${type}`, description: 'real sqlite migration fixture', type, source, version: '1.0.0' })
}

function rows(db: any, table: any) {
  return db.select().from(table).all()
}

describe('Legacy migration SQLite integration', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-skills-migration-integration-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../../src/server/db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('publishes prompt-template migration as one durable Package mapping and retries idempotently', async () => {
    const { app, client, legacySkillRepo, skillPackageRepo, legacyMigrationRepo, tables } = await loadApi()
    const db = client.getOrmDb()
    const legacy = makeLegacy(legacySkillRepo, 'prompt-template', 'Hello {{name}}')
    const originalSource = legacySkillRepo.get(legacy.id)?.source

    const preview = await requestJson(app, `/skills/${legacy.id}/migration/preview`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-a', 'x-bloom-actor': 'actor-a' },
      body: '{}',
    })
    expect(preview.response.status).toBe(200)
    expect(preview.body.data.result.decision).toBe('auto_convertible')

    const validated = await requestJson(app, `/skills/${legacy.id}/migration/validate`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-a', 'x-bloom-actor': 'actor-a' },
      body: JSON.stringify({ previewId: preview.body.data.migrationId, expectedRevision: preview.body.data.revision }),
    })
    expect(validated.response.status).toBe(200)
    expect(validated.body.data.valid).toBe(true)

    const published = await requestJson(app, `/skills/${legacy.id}/migration/publish`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-a', 'x-bloom-actor': 'actor-a' },
      body: JSON.stringify({ previewId: preview.body.data.migrationId, expectedRevision: validated.body.data.revision, confirm: true, acknowledgedWarnings: [] }),
    })
    expect(published.response.status).toBe(201)
    expect(published.body.data).toMatchObject({
      legacyReference: `legacy:${legacy.id}`,
      packageReference: expect.stringMatching(/^package:/),
      lifecycle: 'migration_published',
      readOnly: true,
    })

    const mapping = legacyMigrationRepo.get(preview.body.data.migrationId)
    expect(mapping).toMatchObject({ status: 'migration_published', decision: 'auto_convertible', packageId: published.body.data.packageId, packageVersionId: published.body.data.skillVersionId, ownerId: 'owner-a', revision: validated.body.data.revision + 1 })
    expect(legacySkillRepo.get(legacy.id)?.source).toBe(originalSource)

    const packageRow = skillPackageRepo.getPackage(published.body.data.packageId)
    const versionRow = skillPackageRepo.getVersion(published.body.data.skillVersionId)
    const installationRows = skillPackageRepo.listInstallations(published.body.data.packageId)
    const draftRow = skillPackageRepo.getDraft(validated.body.data.draftId)
    expect(packageRow).toMatchObject({ source_type: 'legacy-migration', source_uri: `legacy:${legacy.id}` })
    expect(versionRow).toMatchObject({ package_id: packageRow?.id, status: 'runnable', security_status: 'approved' })
    expect(installationRows).toHaveLength(1)
    expect(installationRows[0]).toMatchObject({ current_version_id: versionRow?.id, status: 'disabled', enabled: 0 })
    expect(draftRow).toMatchObject({ status: 'published', published_version_id: versionRow?.id })
    if (!packageRow || !versionRow || !installationRows[0]) throw new Error('Expected published Package provenance records')
    expect(rows(db, tables.skill_version_snapshots)).toHaveLength(1)
    expect(rows(db, tables.skill_audit_events)).toHaveLength(1)
    expect(rows(db, tables.skill_legacy_migrations)).toHaveLength(1)

    const countsBeforeRetry = {
      packages: rows(db, tables.skill_packages).length,
      versions: rows(db, tables.skill_versions).length,
      snapshots: rows(db, tables.skill_version_snapshots).length,
      installations: rows(db, tables.skill_installations).length,
      audits: rows(db, tables.skill_audit_events).length,
    }
    const retry = await requestJson(app, `/skills/${legacy.id}/migration/publish`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-a', 'x-bloom-actor': 'actor-a' },
      body: JSON.stringify({ previewId: preview.body.data.migrationId, expectedRevision: mapping!.revision, confirm: true, acknowledgedWarnings: [] }),
    })
    expect(retry.response.status).toBe(201)
    expect(retry.body.data).toMatchObject({ packageId: published.body.data.packageId, skillVersionId: published.body.data.skillVersionId, installationId: published.body.data.installationId, revision: mapping!.revision })
    expect({
      packages: rows(db, tables.skill_packages).length,
      versions: rows(db, tables.skill_versions).length,
      snapshots: rows(db, tables.skill_version_snapshots).length,
      installations: rows(db, tables.skill_installations).length,
      audits: rows(db, tables.skill_audit_events).length,
    }).toEqual(countsBeforeRetry)
  })

  it('does not create Package records for http-api or js-function migration decisions', async () => {
    const { app, client, legacySkillRepo, skillPackageRepo, legacyMigrationRepo, tables } = await loadApi()
    const db = client.getOrmDb()
    const http = makeLegacy(legacySkillRepo, 'http-api', JSON.stringify({ url: 'https://example.test/items', method: 'GET' }))
    const js = makeLegacy(legacySkillRepo, 'js-function', 'return eval(input)')

    const httpPreview = await requestJson(app, `/skills/${http.id}/migration/preview`, { method: 'POST', body: '{}' })
    const jsPreview = await requestJson(app, `/skills/${js.id}/migration/preview`, { method: 'POST', body: '{}' })
    expect(httpPreview.body.data.status).toBe('manual_review_required')
    expect(jsPreview.body.data.status).toBe('migration_blocked')
    expect(rows(db, tables.skill_packages)).toHaveLength(0)
    expect(rows(db, tables.skill_versions)).toHaveLength(0)
    expect(rows(db, tables.skill_installations)).toHaveLength(0)
    expect(rows(db, tables.skill_audit_events)).toHaveLength(0)
    expect(legacyMigrationRepo.listByLegacySkill(http.id)).toHaveLength(1)
    expect(legacyMigrationRepo.listByLegacySkill(js.id)).toHaveLength(1)
    expect(skillPackageRepo.listPackages({ limit: 100, offset: 0 }).data).toHaveLength(0)
  })

  it('rolls back Package, snapshot, installation, draft, mapping, and audit writes on publish failure', async () => {
    const { app, client, legacySkillRepo, skillPackageRepo, legacyMigrationRepo, tables } = await loadApi()
    const db = client.getOrmDb()
    const legacy = makeLegacy(legacySkillRepo, 'prompt-template', 'Rollback {{name}}')
    const preview = await requestJson(app, `/skills/${legacy.id}/migration/preview`, { method: 'POST', body: '{}' })
    const validated = await requestJson(app, `/skills/${legacy.id}/migration/validate`, {
      method: 'POST',
      body: JSON.stringify({ previewId: preview.body.data.migrationId, expectedRevision: preview.body.data.revision }),
    })
    expect(validated.body.data.valid).toBe(true)

    // Simulate a concurrent writer publishing the draft outside the migration
    // transaction. The publish precondition must fail before any new Package,
    // Version, Snapshot, Installation, or Audit row is committed.
    const poisonPackage = skillPackageRepo.createPackage({ name: 'Poison Package', description: '', sourceType: 'test' })
    const poisonVersion = skillPackageRepo.createVersion({
      packageId: poisonPackage.id,
      version: '0.0.1',
      manifest: {},
      manifestHash: 'poison-manifest',
      packagePath: path.join(dataDir, 'poison'),
    })
    const baselineCounts = {
      packages: rows(db, tables.skill_packages).length,
      versions: rows(db, tables.skill_versions).length,
      snapshots: rows(db, tables.skill_version_snapshots).length,
      installations: rows(db, tables.skill_installations).length,
      audits: rows(db, tables.skill_audit_events).length,
    }
    const poisoned = skillPackageRepo.markDraftPublished({
      id: validated.body.data.draftId,
      ownerId: 'local-user',
      versionId: poisonVersion.id,
      validation: {},
    })
    expect(poisoned).toBeTruthy()

    const publish = await requestJson(app, `/skills/${legacy.id}/migration/publish`, {
      method: 'POST',
      body: JSON.stringify({ previewId: preview.body.data.migrationId, expectedRevision: validated.body.data.revision, confirm: true, acknowledgedWarnings: [] }),
    })
    expect(publish.response.status).toBe(409)
    expect(publish.body.error).toMatchObject({ code: 'INVALID_RUN_TRANSITION' })
    expect(rows(db, tables.skill_packages).length).toBe(baselineCounts.packages)
    expect(rows(db, tables.skill_versions).length).toBe(baselineCounts.versions)
    expect(rows(db, tables.skill_version_snapshots).length).toBe(baselineCounts.snapshots)
    expect(rows(db, tables.skill_installations).length).toBe(baselineCounts.installations)
    expect(rows(db, tables.skill_audit_events).length).toBe(baselineCounts.audits)
    expect(legacyMigrationRepo.get(preview.body.data.migrationId)).toMatchObject({ status: 'migration_previewed', packageId: null, packageVersionId: null, revision: validated.body.data.revision })
    expect(skillPackageRepo.getDraft(validated.body.data.draftId)).toMatchObject({ status: 'published', published_version_id: poisonVersion.id })
  })
})