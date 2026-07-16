import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateForSessionInput } from '../../services/image-studio.service'

let dataDir: string
let fixtureDir: string
let uploadDir: string
let exportDir: string
let originalEnv: NodeJS.ProcessEnv
let generationAttempt = 0

const generateForSessionMock = vi.fn(async (input: GenerateForSessionInput) => {
  generationAttempt += 1
  const { imageGenerationRepo } = await import('../../db/repositories/image-generation.repo')
  const failed = generationAttempt === 4
  return imageGenerationRepo.create({
    session_id: input.sessionId,
    prompt: input.prompt,
    provider_id: 'article-e2e-fixture',
    model: input.model,
    aspect_ratio: input.aspectRatioId ?? null,
    style: input.styleId ?? null,
    status: failed ? 'failed' : 'completed',
    error_msg: failed ? 'fixture provider rejected image four' : null,
  })
})

async function loadApi() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  const client = await import('../../db/client')
  await client.runMigrations()
  const { createHonoApp } = await import('../app')
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const imageStudioService = await import('../../services/image-studio.service')
  return { app: createHonoApp(), client, skillPackageRepo, imageStudioService }
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

async function waitForJob(app: { request: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> }, jobId: string, expectedStatus: string) {
  let job: any
  await vi.waitFor(async () => {
    const result = await requestJson(app, `/article-illustrations/${jobId}`)
    expect(result.response.status).toBe(200)
    expect(result.body.data.status).toBe(expectedStatus)
    job = result.body.data
  }, { timeout: 10_000, interval: 25 })
  return job
}

describe('article illustration end-to-end acceptance', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-article-e2e-data-'))
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-article-e2e-fixture-'))
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-article-e2e-upload-'))
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-article-e2e-export-'))
    originalEnv = { ...process.env }
    generationAttempt = 0
    generateForSessionMock.mockClear()
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.restoreAllMocks()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(fixtureDir, { recursive: true, force: true })
    fs.rmSync(uploadDir, { recursive: true, force: true })
    fs.rmSync(exportDir, { recursive: true, force: true })
  })

  it('installs an article fixture, processes uploaded Markdown, and keeps the whole image workflow traceable', async () => {
    writeFixture('article-illustrator/SKILL.md', `---
name: Article E2E Illustrator
description: Create six editorial illustrations from a Markdown article
runtime: instruction-agent
capabilities:
  image.generate:
    allowedModels: [agnes-image-2.1-flash]
    maxCalls: 7
recommended_surface: image-studio
output_artifacts: [markdown, image-reference]
---
Create an editable illustration plan before generating images.
`)
    const markdownPath = path.join(uploadDir, 'city-at-dawn.md')
    fs.writeFileSync(markdownPath, '# 城市黎明\n\n清晨的街道逐渐苏醒，六个场景记录城市从夜色到日出的变化。\n\n## 尾声\n\n阳光照亮河岸。')

    const { app, client, skillPackageRepo, imageStudioService } = await loadApi()
    vi.spyOn(imageStudioService, 'generateForSession').mockImplementation(generateForSessionMock)
    const installed = await requestJson(app, '/skill-packages/install', {
      method: 'POST',
      body: JSON.stringify({ source: { kind: 'local-directory', directory: fixtureDir } }),
    })
    expect(installed.response.status).toBe(201)
    expect(installed.body.data).toMatchObject({ status: 'awaiting_permission_review', packages: [expect.objectContaining({ relativeSkillPath: 'article-illustrator' })] })

    // The Vitest setup closes SQLite when temporary Package staging paths are removed; reopen the same test database before simulating approval.
    await client.runMigrations()

    const fixture = installed.body.data.packages[0]
    skillPackageRepo.createInstallation({ packageId: fixture.packageId, currentVersionId: fixture.versionId, status: 'installed', enabled: true })
    skillPackageRepo.createCapabilityGrant({
      skillVersionId: fixture.versionId,
      capability: 'image.generate',
      grantMode: 'persistent',
      scope: { allowedModels: ['agnes-image-2.1-flash'], maxCalls: 7 },
    })

    const eligible = await requestJson(app, '/article-illustrations/eligible-skills')
    expect(eligible.response.status).toBe(200)
    expect(eligible.body.data).toContainEqual(expect.objectContaining({
      skillVersionId: fixture.versionId,
      packageName: 'article-illustrator',
      activeImageGrant: expect.objectContaining({ maxCalls: 7, allowedModels: ['agnes-image-2.1-flash'] }),
    }))

    const planned = await requestJson(app, '/article-illustrations/plans', {
      method: 'POST',
      body: JSON.stringify({
        source: { type: 'file', filePath: markdownPath, fileName: 'city-at-dawn.md' },
        mode: 'skill',
        skillVersionId: fixture.versionId,
        config: { imageCount: 6, model: 'agnes-image-2.1-flash', aspectRatioId: '4:3', styleId: 'editorial' },
      }),
    })
    expect(planned.response.status).toBe(201)
    expect(planned.body.data).toMatchObject({ status: 'waiting_approval', source_type: 'file', source_label: 'city-at-dawn.md', run_id: expect.any(String) })
    expect(planned.body.data.scenes).toHaveLength(6)

    const jobId = planned.body.data.id as string
    const runId = planned.body.data.run_id as string
    const confirmed = await requestJson(app, `/article-illustrations/${jobId}/confirm`, { method: 'POST', body: '{}' })
    expect(confirmed.response.status).toBe(200)
    expect(confirmed.body.data.status).toBe('running')

    const withFailure = await waitForJob(app, jobId, 'completed_with_errors')
    expect(generateForSessionMock).toHaveBeenCalledTimes(6)
    expect(withFailure.scenes).toHaveLength(6)
    const failedScene = withFailure.scenes.find((scene: any) => scene.status === 'failed')
    expect(failedScene).toMatchObject({ retry_count: 0, error_message: 'fixture provider rejected image four' })
    expect(withFailure.scenes.filter((scene: any) => scene.status === 'completed')).toHaveLength(5)

    const retried = await requestJson(app, `/article-illustrations/${jobId}/scenes/${failedScene.id}/retry`, { method: 'POST', body: '{}' })
    expect(retried.response.status).toBe(200)
    expect(retried.body.data.scenes.find((scene: any) => scene.id === failedScene.id)).toMatchObject({ retry_count: 1 })
    const completed = await waitForJob(app, jobId, 'completed')
    expect(generateForSessionMock).toHaveBeenCalledTimes(7)
    expect(completed.scenes.every((scene: any) => scene.status === 'completed')).toBe(true)

    const imageSessionId = completed.image_session_id as string
    const reopened = await requestJson(app, `/image-sessions/${imageSessionId}/generations`)
    expect(reopened.response.status).toBe(200)
    expect(reopened.body.data).toHaveLength(7)
    expect(reopened.body.data.filter((generation: any) => generation.status === 'completed')).toHaveLength(6)
    expect(reopened.body.data).toContainEqual(expect.objectContaining({ status: 'failed', error_msg: 'fixture provider rejected image four' }))

    const artifacts = await requestJson(app, `/skill-runs/${runId}/artifacts`)
    expect(artifacts.response.status).toBe(200)
    expect(artifacts.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'markdown', path: 'illustrations.md' }),
      expect.objectContaining({ kind: 'prompt' }),
      expect.objectContaining({ kind: 'image-reference' }),
    ]))
    const manifest = artifacts.body.data.find((artifact: any) => artifact.kind === 'markdown' && artifact.path === 'illustrations.md')
    const artifactContent = await app.request(new URL(`/api/v1/skill-artifacts/${manifest.id}/content?runId=${encodeURIComponent(runId)}`, 'http://localhost'))
    expect(artifactContent.status).toBe(200)
    await expect(artifactContent.text()).resolves.toContain('# Illustrations')
    const exported = await requestJson(app, `/skill-artifacts/${manifest.id}/export`, { method: 'POST', body: JSON.stringify({ runId, destinationDir: exportDir }) })
    expect(exported.response.status).toBe(200)
    expect(fs.readFileSync(exported.body.data.path, 'utf8')).toContain('# Illustrations')

    const run = await requestJson(app, `/skill-runs/${runId}`)
    expect(run.response.status).toBe(200)
    expect(run.body.data).toMatchObject({
      id: runId,
      surface: 'image',
      status: 'completed_with_errors',
      context: expect.objectContaining({ surface: 'article-illustration', jobId }),
      output: expect.objectContaining({ imageSessionId }),
    })
    const runs = await requestJson(app, `/skill-runs?skillVersionId=${fixture.versionId}`)
    expect(runs.body.data).toContainEqual(expect.objectContaining({ id: runId, surface: 'image' }))
    const events = await requestJson(app, `/skill-runs/${runId}/events?afterSeq=0`)
    expect(events.response.status).toBe(200)
    expect(events.body.data.map((event: any) => event.seq)).toEqual(events.body.data.map((_: any, index: number) => index + 1))
    expect(events.body.data.map((event: any) => event.type)).toEqual(expect.arrayContaining([
      'input.summarized',
      'approval.required',
      'run.status_changed',
      'capability.call',
      'run.completed_with_errors',
    ]))
    expect(events.body.data.filter((event: any) => event.type === 'capability.call')).toHaveLength(7)
  })
})



