import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'


type App = {
  request(input: RequestInfo | URL, init?: RequestInit): Response | Promise<Response>
}

type JsonResponse = {
  response: Response
  body: any
}

const SENSITIVE_VALUES = [
  'Bearer do-not-leak',
  'api-key-value',
  'secret-query',
  'process.env.SECRET',
  'should-not-leak',
]

async function removeTemporaryDirectory(dataDir: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
      return
    } catch (error) {
      lastError = error
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
      if (code !== 'EPERM' && code !== 'EBUSY') throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  console.error('Temporary directory cleanup failed after retries:', lastError)
}

async function main(): Promise<void> {
  const originalEnv = { ...process.env }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-skills-migration-'))
  const artifactRoot = path.join(dataDir, 'artifacts')
  let externalNetworkCalls = 0
  const originalFetch = globalThis.fetch

  process.env.DATA_DIR = dataDir
  // Keep Mastra's schedule store in memory so the offline verifier can remove its temp directory on Windows.
  process.env.VITEST = 'true'
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  process.env.SKILL_ARTIFACT_ROOT = artifactRoot
  globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
    externalNetworkCalls += 1
    throw new Error('External network access is forbidden during offline migration verification')
  }) as typeof fetch

  let closeDb: (() => void) | undefined
  try {
    const client = await import('../src/server/db/client')
    const { createHonoApp } = await import('../src/server/http/app')
    const { skillRepo } = await import('../src/server/db/repositories/skill.repo')
    const { skillPackageRepo } = await import('../src/server/db/repositories/skill-package.repo')
    const { legacyMigrationRepo } = await import('../src/server/db/repositories/legacy-migration.repo')
    const { getOrmDb } = await import('../src/server/db/client')
    const schema = await import('../src/server/db/schema')
    closeDb = client.closeDb

    await client.runMigrations()
    const app = createHonoApp()

    const prompt = skillRepo.create({
      name: 'Offline Prompt Template',
      description: 'Offline migration verification fixture',
      type: 'prompt-template',
      source: 'Hello {{name}}',
      version: '1.0.0',
    })
    const http = skillRepo.create({
      name: 'Offline HTTP API',
      description: 'Must remain manual review only',
      type: 'http-api',
      source: JSON.stringify({
        url: 'http://127.0.0.1:8080/items?token=secret-query',
        method: 'POST',
        headers: { Authorization: 'Bearer do-not-leak', 'X-Api-Key': 'api-key-value' },
        body: { prompt: 'hello' },
        followRedirects: true,
      }),
      version: '1.0.0',
    })
    const js = skillRepo.create({
      name: 'Offline JavaScript Function',
      description: 'Must remain critical blocked',
      type: 'js-function',
      source: 'module.exports = () => process.env.SECRET',
      version: '1.0.0',
    })
    const unknown = skillRepo.create({
      name: 'Offline Unknown Skill',
      description: 'Must fail closed',
      type: 'unknown-runtime',
      source: 'should-not-leak',
      version: '1.0.0',
    })

    const responseBodies: any[] = []
    const requestJson = async (route: string, init: RequestInit = {}): Promise<JsonResponse> => {
      const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), {
        headers: { 'Content-Type': 'application/json', 'x-bloom-role': 'admin', ...(init.headers ?? {}) },
        ...init,
      })
      let body: any = null
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) body = await response.json()
      else if (response.status !== 204) body = await response.text()
      if (body !== null) responseBodies.push(body)
      return { response, body }
    }
    const expectStatus = (result: JsonResponse, expected: number, label: string): void => {
      assert.equal(result.response.status, expected, `${label}: expected HTTP ${expected}, got ${result.response.status}: ${JSON.stringify(result.body)}`)
    }

    const overview = await requestJson('/skills/overview?runtimeKind=legacy&limit=100')
    expectStatus(overview, 200, 'Legacy overview')
    const cards = overview.body.data as any[]
    assert.ok(cards.some((card) => card.reference === `legacy:${prompt.id}` && card.readOnly === true && card.lifecycle === 'read-only'), 'Legacy overview must expose a read-only card')

    const detail = await requestJson(`/skills/${prompt.id}`)
    expectStatus(detail, 200, 'Legacy detail')
    assert.equal(detail.body.data.readOnly, true, 'Legacy detail must be read-only')
    assert.equal(detail.body.data.runtimeKind, 'legacy', 'Legacy detail must identify the Legacy plane')

    const legacyRun = await requestJson(`/skills/${prompt.id}/run`, { method: 'POST', body: JSON.stringify({ input: { name: 'Ada' } }) })
    expectStatus(legacyRun, 409, 'Legacy run')
    assert.equal(legacyRun.body.error.code, 'LEGACY_SKILL_RUN_DISABLED')
    assert.equal(skillRepo.listRuns(prompt.id).length, 0, 'Legacy run must not create a legacy skill_runs row')

    const legacyCreate = await requestJson('/skills', { method: 'POST', body: JSON.stringify({ name: 'forbidden', description: 'forbidden', type: 'prompt-template', source: 'x' }) })
    expectStatus(legacyCreate, 409, 'Legacy create')
    assert.equal(legacyCreate.body.error.code, 'LEGACY_SKILL_FROZEN')
    const legacyInstall = await requestJson('/skills/install', { method: 'POST', body: JSON.stringify({ id: prompt.id }) })
    expectStatus(legacyInstall, 409, 'Legacy install')
    assert.equal(legacyInstall.body.error.code, 'LEGACY_SKILL_FROZEN')
    const legacyPatch = await requestJson(`/skills/${prompt.id}`, { method: 'PATCH', body: JSON.stringify({ description: 'tampered' }) })
    expectStatus(legacyPatch, 409, 'Legacy patch')
    assert.equal(legacyPatch.body.error.code, 'LEGACY_SKILL_FROZEN')
    const legacyDelete = await requestJson(`/skills/${prompt.id}`, { method: 'DELETE' })
    expectStatus(legacyDelete, 409, 'Legacy delete')
    assert.equal(legacyDelete.body.error.code, 'LEGACY_SKILL_FROZEN')

    const crossPlaneRun = await requestJson('/skill-runs', { method: 'POST', body: JSON.stringify({ skillId: `legacy:${prompt.id}`, input: {}, surface: 'skills' }) })
    expectStatus(crossPlaneRun, 409, 'Package Runtime Legacy reference')
    assert.equal(crossPlaneRun.body.error.code, 'LEGACY_SKILL_RUN_DISABLED')

    const inspect = await requestJson(`/skills/${prompt.id}/migration/inspect`, { method: 'POST', body: '{}' })
    expectStatus(inspect, 200, 'Prompt inspect')
    assert.equal(inspect.body.data.result.decision, 'auto_convertible')
    assert.equal(inspect.body.data.readOnly, true)

    const preview = await requestJson(`/skills/${prompt.id}/migration/preview`, { method: 'POST', body: '{}' })
    expectStatus(preview, 200, 'Prompt preview')
    assert.equal(preview.body.data.result.kind, 'package-draft-candidate')
    assert.equal(preview.body.data.revision, 1)
    const previewId = String(preview.body.data.migrationId)
    const previewRevision = Number(preview.body.data.revision)

    const validated = await requestJson(`/skills/${prompt.id}/migration/validate`, {
      method: 'POST',
      body: JSON.stringify({ previewId, expectedRevision: previewRevision }),
    })
    expectStatus(validated, 200, 'Prompt validate')
    assert.equal(validated.body.data.valid, true)
    assert.equal(validated.body.data.revision, previewRevision + 1)
    const draftId = String(validated.body.data.draftId)

    const warnings = (validated.body.data.warnings ?? []).map((warning: any) => String(warning.code))
    const publish = await requestJson(`/skills/${prompt.id}/migration/publish`, {
      method: 'POST',
      body: JSON.stringify({
        previewId,
        expectedRevision: Number(validated.body.data.revision),
        confirm: true,
        acknowledgedWarnings: warnings,
      }),
    })
    expectStatus(publish, 201, 'Prompt publish')
    assert.equal(publish.body.data.lifecycle, 'migration_published')
    assert.equal(publish.body.data.readOnly, true)
    const packageId = String(publish.body.data.packageId)
    const packageVersionId = String(publish.body.data.skillVersionId)
    const installationId = String(publish.body.data.installationId)

    const history = await requestJson(`/skills/${prompt.id}/migration-history`)
    expectStatus(history, 200, 'Prompt migration history')
    assert.ok(history.body.data.some((entry: any) => entry.id === previewId && entry.packageReference === `package:${packageId}` && entry.readOnly === true), 'Published migration history must retain Legacy-to-Package provenance')
    assert.equal(legacyMigrationRepo.get(previewId)?.packageId, packageId)
    assert.equal(legacyMigrationRepo.get(previewId)?.packageVersionId, packageVersionId)

    const packageDetail = await requestJson(`/skill-packages/${packageId}`)
    expectStatus(packageDetail, 200, 'Published Package detail')
    assert.equal(packageDetail.body.data.package.id, packageId)
    const versions = await requestJson(`/skill-packages/${packageId}/versions`)
    expectStatus(versions, 200, 'Published Package versions')
    assert.ok(versions.body.data.some((version: any) => version.id === packageVersionId), 'Published Package version must exist')
    const installations = await requestJson('/skill-installations?limit=100')
    expectStatus(installations, 200, 'Package installations')
    const installation = installations.body.data.find((item: any) => item.id === installationId)
    assert.ok(installation, 'Published Package installation must exist')
    assert.equal(installation.packageId ?? installation.package_id, packageId, `installation=${JSON.stringify(installation)}`)
    assert.equal(installation.currentVersionId ?? installation.current_version_id, packageVersionId, `installation=${JSON.stringify(installation)}`)

    const enabled = await requestJson(`/skill-installations/${installationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true, expectedRevision: Number(installation.revision ?? 0), idempotencyKey: 'offline-migration-enable-1' }),
    })
    expectStatus(enabled, 200, 'Enable published Package installation')
    assert.equal(Number(enabled.body.data.enabled), 1)

    const packageRun = await requestJson('/skill-runs', {
      method: 'POST',
      body: JSON.stringify({ skillVersionId: `package:${packageVersionId}`, input: { name: 'Ada' }, surface: 'skills' }),
    })
    expectStatus(packageRun, 201, 'Package Runtime run')
    assert.ok(packageRun.body.data.runId, 'Package Runtime must return a durable run id')
    const packageRunId = String(packageRun.body.data.runId)
    const runDetail = await requestJson(`/skill-runs/${packageRunId}`)
    expectStatus(runDetail, 200, 'Package Runtime run detail')
    assert.equal(runDetail.body.data.id, packageRunId)
    const runEvents = await requestJson(`/skill-runs/${packageRunId}/events`)
    expectStatus(runEvents, 200, 'Package Runtime run events')
    assert.ok(Array.isArray(runEvents.body.data), 'Package Runtime events must be an array')

    const httpPreview = await requestJson(`/skills/${http.id}/migration/preview`, { method: 'POST', body: '{}' })
    expectStatus(httpPreview, 200, 'HTTP manual-review preview')
    assert.equal(httpPreview.body.data.status, 'manual_review_required')
    assert.equal(httpPreview.body.data.result.decision, 'manual_review')
    assert.equal(httpPreview.body.data.result.kind, 'manual-review-report')
    assert.equal(skillPackageRepo.listPackages({ limit: 100, offset: 0 }).data.length, 1, 'Manual-review Legacy source must not create a Package')

    const jsPreview = await requestJson(`/skills/${js.id}/migration/preview`, { method: 'POST', body: '{}' })
    expectStatus(jsPreview, 200, 'JavaScript critical-blocked preview')
    assert.equal(jsPreview.body.data.status, 'migration_blocked')
    assert.equal(jsPreview.body.data.result.decision, 'critical_blocked')
    assert.equal(jsPreview.body.data.result.sideEffects.execution, false)
    assert.equal(jsPreview.body.data.result.sideEffects.vm, false)
    assert.equal(jsPreview.body.data.result.sideEffects.eval, false)

    const unknownPreview = await requestJson(`/skills/${unknown.id}/migration/preview`, { method: 'POST', body: '{}' })
    expectStatus(unknownPreview, 200, 'Unknown Legacy preview')
    assert.equal(unknownPreview.body.data.status, 'migration_blocked')
    assert.equal(unknownPreview.body.data.result.decision, 'unsupported')

    const migrationRows = getOrmDb().select().from(schema.skill_legacy_migrations).all() as any[]
    const packageRows = getOrmDb().select().from(schema.skill_packages).all() as any[]
    const versionRows = getOrmDb().select().from(schema.skill_versions).all() as any[]
    const snapshotRows = getOrmDb().select().from(schema.skill_version_snapshots).all() as any[]
    const installationRows = getOrmDb().select().from(schema.skill_installations).all() as any[]
    const draftRows = getOrmDb().select().from(schema.skill_drafts).all() as any[]
    const auditRows = getOrmDb().select().from(schema.skill_audit_events).all() as any[]
    const packageById = new Map(packageRows.map((row) => [row.id, row]))
    const versionById = new Map(versionRows.map((row) => [row.id, row]))
    const snapshotByVersion = new Map(snapshotRows.map((row) => [row.version_id, row]))
    const installationByPackageVersion = new Map(installationRows.map((row) => [`${row.package_id}:${row.current_version_id}`, row]))
    const draftById = new Map(draftRows.map((row) => [row.id, row]))
    const orphanedRecords = migrationRows.filter((row) => {
      if (row.status !== 'migration_published') return false
      const previewPayload = JSON.parse(row.preview_json ?? '{}')
      const mappedDraft = typeof previewPayload.draftId === 'string' ? draftById.get(previewPayload.draftId) : undefined
      return !row.package_id || !row.package_version_id || !packageById.has(row.package_id) || !versionById.has(row.package_version_id)
        || versionById.get(row.package_version_id)?.package_id !== row.package_id
        || !snapshotByVersion.has(row.package_version_id)
        || !installationByPackageVersion.has(`${row.package_id}:${row.package_version_id}`)
        || !mappedDraft
        || !auditRows.some((audit) => audit.resource_id === row.legacy_skill_id && audit.source_fingerprint === row.source_sha256)
    }).length

    const outputText = JSON.stringify({ inspect: inspect.body, preview: preview.body, validated: validated.body, publish: publish.body, history: history.body, httpPreview: httpPreview.body, jsPreview: jsPreview.body, unknownPreview: unknownPreview.body })
    const secretLeak = SENSITIVE_VALUES.some((secret) => outputText.includes(secret))
    assert.equal(secretLeak, false, 'Migration output must not contain source secrets or executable JavaScript')
    assert.equal(externalNetworkCalls, 0, 'Offline migration verification must not make external network requests')
    assert.equal(orphanedRecords, 0, 'Published migration must not leave orphaned Package provenance records')
    assert.equal(draftRows.filter((row) => row.id === draftId && row.status === 'published').length, 1, 'Validated migration draft must be published exactly once')

    const result = {
      legacyReadOnly: true,
      legacyRunBlocked: true,
      promptTemplatePublished: true,
      httpApiManualReview: true,
      jsFunctionBlocked: true,
      packageE2E: true,
      secretLeak,
      externalNetworkCalls,
      orphanedRecords,
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    try { closeDb?.() } catch (error) { console.error('Database cleanup failed:', error) } finally {
      globalThis.fetch = originalFetch
      process.env = originalEnv
      await removeTemporaryDirectory(dataDir)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
