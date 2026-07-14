import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { SkillRunCoordinator } = await import('../../skills/runtime')
  return { app: createHonoApp(), skillPackageRepo, SkillRunCoordinator }
}

async function requestJson(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, route: string, init?: RequestInit) {
  const response = await app.request(new URL(`/api/v1${route}`, 'http://localhost'), { headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, ...init })
  return { response, body: await response.json() as any }
}

describe('article illustration HTTP API', () => {
  beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-article-http-')); originalEnv = { ...process.env } })
  afterEach(async () => { const client = await import('../../db/client'); client.closeDb(); vi.resetModules(); process.env = originalEnv; fs.rmSync(dataDir, { recursive: true, force: true }) })

  it('creates, edits, confirms, recovers, and exports a skill-backed plan', async () => {
    const { app, skillPackageRepo, SkillRunCoordinator } = await loadApi()
    const pkg = skillPackageRepo.createPackage({ name: 'Illustrator', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({ packageId: pkg.id, version: '1.0.0', manifest: { capabilities: ['image.generate'] }, manifestHash: 'image-capable', packagePath: '/illustrator' })
    skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
    skillPackageRepo.createCapabilityGrant({
      skillVersionId: version.id,
      capability: 'image.generate',
      grantMode: 'persistent',
      scope: { allowedModels: ['model-a'], maxCalls: 2 },
    })

    const eligible = await requestJson(app, '/article-illustrations/eligible-skills')
    expect(eligible.body.data).toContainEqual(expect.objectContaining({
      skillVersionId: version.id,
      activeImageGrant: expect.objectContaining({ maxCalls: 2, allowedModels: ['model-a'] }),
    }))

    const created = await requestJson(app, '/article-illustrations/plans', {
      method: 'POST',
      body: JSON.stringify({
        source: { type: 'text', text: '# Heading\n\nArticle body' },
        mode: 'skill',
        skillVersionId: version.id,
        config: { imageCount: 2, model: 'model-a' },
      }),
    })
    expect(created.response.status).toBe(201)
    expect(created.body.data).toMatchObject({ status: 'waiting_approval', run_id: expect.any(String) })
    expect(created.body.data.scenes).toHaveLength(2)

    const jobId = created.body.data.id
    const runId = created.body.data.run_id as string
    const coordinator = new SkillRunCoordinator()
    expect(coordinator.getRun(runId)).toMatchObject({ status: 'waiting_approval', context: expect.objectContaining({ jobId }) })
    expect((await requestJson(app, '/article-illustrations/recoverable')).body.data).toContainEqual(expect.objectContaining({ id: jobId, status: 'waiting_approval' }))

    const updated = await requestJson(app, `/article-illustrations/${jobId}/scenes/${created.body.data.scenes[0].id}`, { method: 'PATCH', body: JSON.stringify({ prompt: 'Edited prompt' }) })
    expect(updated.body.data.prompt).toBe('Edited prompt')

    const waitingRun = coordinator.getRun(runId)
    const runningRun = coordinator.transition(runId, 'running', { expectedRevision: waitingRun.revision })
    coordinator.transition(runId, 'interrupted', { expectedRevision: runningRun.revision, errorCode: 'PROCESS_INTERRUPTED' })
    const recoverable = await requestJson(app, '/article-illustrations/recoverable')
    expect(recoverable.body.data).toContainEqual(expect.objectContaining({ id: jobId, status: 'interrupted' }))

    const resumed = await requestJson(app, `/article-illustrations/${jobId}/resume`, { method: 'POST', body: '{}' })
    expect(resumed.body.data.status).toBe('waiting_approval')
    expect(coordinator.getRun(runId).status).toBe('waiting_approval')

    const confirmed = await requestJson(app, `/article-illustrations/${jobId}/confirm`, { method: 'POST', body: '{}' })
    expect(confirmed.body.data.status).toBe('running')
    const exported = await requestJson(app, `/article-illustrations/${jobId}/export`)
    expect(exported.body.data.markdown).toContain('Edited prompt')
  })

  it('requires consent and signals pasted-text fallback without relaxing SSRF protection', async () => {
    const { app } = await loadApi()
    const denied = await requestJson(app, '/article-illustrations/plans', { method: 'POST', body: JSON.stringify({ source: { type: 'url', url: 'https://example.test/a', consent: false }, mode: 'fallback', config: {} }) })
    expect(denied.response.status).toBe(400)
    expect(denied.body.error).toMatchObject({ code: 'URL_CONSENT_REQUIRED', canPasteText: false })

    const blocked = await requestJson(app, '/article-illustrations/plans', { method: 'POST', body: JSON.stringify({ source: { type: 'url', url: 'http://127.0.0.1/a', consent: true }, mode: 'fallback', config: {} }) })
    expect(blocked.response.status).toBe(400)
    expect(blocked.body.error).toMatchObject({ code: 'URL_NOT_ALLOWED', canPasteText: true })
  })
})