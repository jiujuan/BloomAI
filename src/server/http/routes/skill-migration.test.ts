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
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const { legacySkillRepo } = await import('../../db/repositories/skill.repo')
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { legacyMigrationRepo } = await import('../../db/repositories/legacy-migration.repo')
  return { app: createHonoApp(), client, legacySkillRepo, skillPackageRepo, legacyMigrationRepo }
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

function createLegacy(legacySkillRepo: any, type: string, source: string) {
  return legacySkillRepo.create({
    name: `Legacy ${type}`,
    description: 'migration route fixture',
    type,
    source,
    version: '1.0.0',
  })
}

async function previewPrompt(app: any, skill: any, headers: Record<string, string> = {}) {
  return requestJson(app, `/skills/${skill.id}/migration/preview`, {
    method: 'POST',
    headers,
    body: '{}',
  })
}

describe('Legacy Skill migration HTTP routes', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-skill-migration-http-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('inspects and previews from the Legacy Archive without accepting source injection', async () => {
    const { app, legacySkillRepo } = await loadApi()
    const skill = createLegacy(legacySkillRepo, 'prompt-template', 'Hello {{name}}')

    const inspected = await requestJson(app, `/skills/${skill.id}/migration/inspect`, { method: 'POST', body: '{}' })
    expect(inspected.response.status).toBe(200)
    expect(inspected.body.data).toMatchObject({
      legacyReference: `legacy:${skill.id}`,
      runtimeKind: 'legacy',
      readOnly: true,
      result: { kind: 'package-draft-candidate', decision: 'auto_convertible' },
    })

    const injected = await requestJson(app, `/skills/${skill.id}/migration/preview`, {
      method: 'POST',
      body: JSON.stringify({ source: 'attacker-controlled {{secret}}' }),
    })
    expect(injected.response.status).toBe(400)
    expect(injected.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })

    const preview = await previewPrompt(app, skill)
    expect(preview.response.status).toBe(200)
    expect(preview.body.data).toMatchObject({
      migrationId: expect.any(String),
      revision: 1,
      legacyReference: `legacy:${skill.id}`,
      result: { kind: 'package-draft-candidate', templateVariables: ['name'] },
    })
    expect(JSON.stringify(preview.body)).not.toContain('attacker-controlled')
  })

  it('rejects malformed, unknown, and oversized migration request bodies', async () => {
    const { app, legacySkillRepo } = await loadApi()
    const skill = createLegacy(legacySkillRepo, 'prompt-template', 'Hello')

    const malformed = await app.request(`/api/v1/skills/${skill.id}/migration/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } })

    const unknown = await requestJson(app, `/skills/${skill.id}/migration/inspect`, {
      method: 'POST',
      body: JSON.stringify({ unexpected: true }),
    })
    expect(unknown.response.status).toBe(400)
    expect(unknown.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })

    const oversized = await requestJson(app, `/skills/${skill.id}/migration/inspect`, {
      method: 'POST',
      body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
    })
    expect(oversized.response.status).toBe(400)
    expect(oversized.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('enforces owner and revision checks and requires warning acknowledgement before publish', async () => {
    const { app, legacySkillRepo, skillPackageRepo, legacyMigrationRepo } = await loadApi()
    const skill = createLegacy(legacySkillRepo, 'prompt-template', 'Fetch https://example.test/{{name}}')

    const preview = await previewPrompt(app, skill, { 'x-bloom-owner': 'owner-a', 'x-bloom-actor': 'actor-a' })
    expect(preview.response.status).toBe(200)
    const previewId = preview.body.data.migrationId as string
    const previewRevision = preview.body.data.revision as number
    const warningCode = preview.body.data.result.warnings[0].code as string

    const forbidden = await requestJson(app, `/skills/${skill.id}/migration/validate`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-b' },
      body: JSON.stringify({ previewId, expectedRevision: previewRevision }),
    })
    expect(forbidden.response.status).toBe(403)
    expect(forbidden.body.error).toMatchObject({ code: 'FORBIDDEN' })

    const validated = await requestJson(app, `/skills/${skill.id}/migration/validate`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-a', 'x-bloom-actor': 'actor-a' },
      body: JSON.stringify({ previewId, expectedRevision: previewRevision }),
    })
    expect(validated.response.status).toBe(200)
    expect(validated.body.data).toMatchObject({ valid: true, draftId: expect.any(String), revision: previewRevision + 1 })

    const stale = await requestJson(app, `/skills/${skill.id}/migration/publish`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-a' },
      body: JSON.stringify({ previewId, expectedRevision: previewRevision, confirm: true, acknowledgedWarnings: [warningCode] }),
    })
    expect(stale.response.status).toBe(409)
    expect(stale.body.error).toMatchObject({ code: 'REVISION_CONFLICT' })

    const missingAcknowledgement = await requestJson(app, `/skills/${skill.id}/migration/publish`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-a' },
      body: JSON.stringify({ previewId, expectedRevision: previewRevision + 1, confirm: true, acknowledgedWarnings: [] }),
    })
    expect(missingAcknowledgement.response.status).toBe(409)
    expect(missingAcknowledgement.body.error).toMatchObject({ code: 'CONFLICT' })
    expect(missingAcknowledgement.body.error.missingWarnings).toContain(warningCode)

    const notConfirmed = await requestJson(app, `/skills/${skill.id}/migration/publish`, {
      method: 'POST',
      headers: { 'x-bloom-owner': 'owner-a' },
      body: JSON.stringify({ previewId, expectedRevision: previewRevision + 1, confirm: false, acknowledgedWarnings: [warningCode] }),
    })
    expect(notConfirmed.response.status).toBe(400)
    expect(notConfirmed.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })

    expect(legacyMigrationRepo.get(previewId)?.revision).toBe(previewRevision + 1)
    expect(skillPackageRepo.listPackages({ limit: 100, offset: 0 }).data).toHaveLength(0)
  })

  it('returns manual-review and critical-blocked reports without publishing or executing sources', async () => {
    const { app, legacySkillRepo, skillPackageRepo, legacyMigrationRepo } = await loadApi()
    const secret = 'Bearer do-not-leak'
    const http = createLegacy(legacySkillRepo, 'http-api', JSON.stringify({
      url: 'http://127.0.0.1:8080/items?token=secret-query',
      method: 'POST',
      headers: { Authorization: secret, 'X-Api-Key': 'api-key-value' },
      body: { prompt: 'hello' },
      followRedirects: true,
    }))
    const js = createLegacy(legacySkillRepo, 'js-function', 'module.exports = () => { return process.env.SECRET; }')

    const httpPreview = await previewPrompt(app, http)
    expect(httpPreview.response.status).toBe(200)
    expect(httpPreview.body.data).toMatchObject({
      status: 'manual_review_required',
      result: { kind: 'manual-review-report', decision: 'manual_review', riskLevel: 'critical' },
    })
    expect(JSON.stringify(httpPreview.body)).not.toContain(secret)
    expect(JSON.stringify(httpPreview.body)).not.toContain('api-key-value')

    const httpPublish = await requestJson(app, `/skills/${http.id}/migration/publish`, {
      method: 'POST',
      body: JSON.stringify({ previewId: httpPreview.body.data.migrationId, expectedRevision: httpPreview.body.data.revision, confirm: true, acknowledgedWarnings: [] }),
    })
    expect(httpPublish.response.status).toBe(409)
    expect(httpPublish.body.error).toMatchObject({ code: 'LEGACY_MIGRATION_MANUAL_REVIEW' })

    const jsPreview = await previewPrompt(app, js)
    expect(jsPreview.response.status).toBe(200)
    expect(jsPreview.body.data).toMatchObject({
      status: 'migration_blocked',
      result: { kind: 'critical-blocked-report', decision: 'critical_blocked', sideEffects: { execution: false, vm: false, eval: false } },
    })
    expect(JSON.stringify(jsPreview.body)).not.toContain('process.env.SECRET')

    const history = await requestJson(app, `/skills/${http.id}/migration-history`)
    expect(history.response.status).toBe(200)
    expect(history.body.data).toHaveLength(1)
    expect(history.body.data[0]).toMatchObject({ readOnly: true, legacyReference: `legacy:${http.id}`, packageReference: null })
    const httpMigration = legacyMigrationRepo.get(httpPreview.body.data.migrationId)
    expect(httpMigration).toBeDefined()
    if (!httpMigration) throw new Error('Expected HTTP migration history record')
    expect(httpMigration.status).toBe('manual_review_required')
    expect(skillPackageRepo.listPackages({ limit: 100, offset: 0 }).data).toHaveLength(0)
  })
})