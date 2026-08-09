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
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { sessionRepo } = await import('../../db/repositories/session.repo')
  const { messageRepo } = await import('../../db/repositories/message.repo')
  const { legacySkillRepo } = await import('../../db/repositories/skill.repo')
  return { app: createHonoApp(), client, skillPackageRepo, sessionRepo, messageRepo, legacySkillRepo }
}

describe('Chat Package Skill routes', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-chat-skill-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('lists only runnable installed skills for a chat session', async () => {
    const { app, skillPackageRepo, sessionRepo } = await loadApi()
    const session = sessionRepo.create({ title: 'Chat' })
    const pkg = skillPackageRepo.createPackage({ name: 'Chat Skill', description: 'usable', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '1.0.0',
      manifest: { requestedCapabilities: ['image.generate'] },
      manifestHash: 'chat-skill-hash',
      packagePath: path.join(dataDir, 'packages', 'chat-skill-hash'),
      securityStatus: 'verified',
      isCompatible: true,
    })
    skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })

    const response = await app.request(`/api/v1/chat/sessions/${session.id}/skills`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: [{ packageReference: `package:${pkg.id}`, skillVersionId: version.id, requiredCapabilities: ['image.generate'] }] })
  })

  it('creates a durable chat run and returns the same run for duplicate idempotency submits', async () => {
    const { app, skillPackageRepo, sessionRepo, messageRepo } = await loadApi()
    const session = sessionRepo.create({ title: 'Chat' })
    const pkg = skillPackageRepo.createPackage({ name: 'Chat Skill', description: '', sourceType: 'local-directory' })
    const version = skillPackageRepo.createVersion({
      packageId: pkg.id,
      version: '1.0.0',
      manifest: {},
      manifestHash: 'chat-run-hash',
      packagePath: path.join(dataDir, 'packages', 'chat-run-hash'),
      securityStatus: 'verified',
      isCompatible: true,
    })
    skillPackageRepo.createInstallation({ packageId: pkg.id, currentVersionId: version.id, status: 'installed', enabled: true })
    const body = JSON.stringify({ skillVersionId: `package:${version.id}`, input: { prompt: 'hello' }, idempotencyKey: 'chat-submit-1', userMessage: { content: 'hello' } })
    const first = await app.request(`/api/v1/chat/sessions/${session.id}/skill-runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    const firstBody = await first.json() as any
    const second = await app.request(`/api/v1/chat/sessions/${session.id}/skill-runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    const secondBody = await second.json() as any

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(secondBody.data).toMatchObject({ runId: firstBody.data.runId, created: false, skillVersionId: version.id })
    expect(messageRepo.list(session.id)).toHaveLength(2)
    expect(JSON.parse(messageRepo.list(session.id)[1].parts!)).toEqual([expect.objectContaining({ type: 'data-skill-run', data: expect.objectContaining({ runId: firstBody.data.runId }) })])
  })

  it('blocks a Legacy chat reference before idempotency, Run, or message side effects', async () => {
    const { app, legacySkillRepo, sessionRepo, messageRepo, skillPackageRepo } = await loadApi()
    const session = sessionRepo.create({ title: 'Legacy Chat' })
    const legacy = legacySkillRepo.create({
      name: 'Legacy Prompt',
      description: 'archive only',
      type: 'prompt-template',
      source: 'Translate {{text}}',
    })
    const beforeRuns = skillPackageRepo.listRuns({ limit: 100, offset: 0 }).data
    const beforeMessages = messageRepo.list(session.id)

    const response = await app.request(`/api/v1/chat/sessions/${session.id}/skill-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillVersionId: `legacy:${legacy.id}`,
        input: { text: 'hello' },
        idempotencyKey: 'legacy-chat-1',
        userMessage: { content: 'hello' },
      }),
    })
    const body = await response.json() as any

    expect(response.status).toBe(409)
    expect(body.error).toMatchObject({
      code: 'LEGACY_SKILL_RUN_DISABLED',
      legacyReference: `legacy:${legacy.id}`,
      migrationAction: 'preview-legacy-skill-migration',
    })
    expect(skillPackageRepo.listRuns({ limit: 100, offset: 0 }).data).toEqual(beforeRuns)
    expect(messageRepo.list(session.id)).toEqual(beforeMessages)
  })

  it('returns a stable validation error for malformed skill-run payloads', async () => {
    const { app, sessionRepo } = await loadApi()
    const session = sessionRepo.create({ title: 'Chat' })
    const response = await app.request(`/api/v1/chat/sessions/${session.id}/skill-runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skillVersionId: '', input: {}, idempotencyKey: '' }) })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })
})
