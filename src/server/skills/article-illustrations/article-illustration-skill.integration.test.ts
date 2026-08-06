import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const { articleIllustrationRepo } = await import('../../db/repositories/article-illustration.repo')
  const { imageGenerationRepo } = await import('../../db/repositories/image-generation.repo')
  const { imageSessionRepo } = await import('../../db/repositories/image-session.repo')
  const imageStudio = await import('../../services/image-studio.service')
  const broker = await import('../policy/capability-broker')
  const { articleIllustrationService } = await import('./article-illustration.service')
  return { client, skillPackageRepo, articleIllustrationRepo, imageGenerationRepo, imageSessionRepo, imageStudio, broker, articleIllustrationService }
}

async function createSkillJob(runtime: Awaited<ReturnType<typeof loadRuntime>>, mode: 'skill' | 'fallback') {
  const pkg = runtime.skillPackageRepo.createPackage({ name: 'Article Illustration Skill', description: '', sourceType: 'local-directory' })
  const version = runtime.skillPackageRepo.createVersion({
    packageId: pkg.id,
    version: '1.0.0',
    manifest: { capabilities: ['image.generate'] },
    manifestHash: 'article-illustration-hash',
    packagePath: '/packages/article-illustration-hash',
  })
  const run = mode === 'skill'
    ? runtime.skillPackageRepo.createRun({ skillVersionId: version.id, status: 'running', input: {}, context: {} })
    : undefined
  const session = runtime.imageSessionRepo.create({ title: 'Article illustration' })
  const job = runtime.articleIllustrationRepo.createJob({
    sourceType: 'text',
    sourceLabel: 'Article',
    articleText: 'Article text',
    mode,
    skillVersionId: mode === 'skill' ? version.id : null,
    runId: run?.id ?? null,
    imageSessionId: session.id,
    config: { model: 'agnes-image-2.1-flash' },
    status: 'running',
  })
  runtime.articleIllustrationRepo.replaceScenes(job.id, [{ ordinal: 1, title: 'Scene', excerpt: 'Excerpt', prompt: 'A lighthouse' }])
  if (mode === 'skill') runtime.skillPackageRepo.createCapabilityGrant({ skillVersionId: version.id, capability: 'image.generate', grantMode: 'persistent', scope: { allowedModels: ['agnes-image-2.1-flash'], maxCalls: 1 } })
  return { pkg, version, run, session, job }
}

function mockGeneration(runtime: Awaited<ReturnType<typeof loadRuntime>>) {
  return vi.spyOn(runtime.imageStudio, 'generateForSession').mockImplementation(async (input) => runtime.imageGenerationRepo.create({
    session_id: input.sessionId,
    prompt: input.prompt,
    provider_id: 'fixture',
    model: input.model,
    status: 'completed',
    url: 'https://example.test/article.png',
    duration_ms: 1,
    skill_run_id: input.skillRunId,
    skill_version_id: input.skillVersionId,
    grant_id: input.grantId,
  }))
}

describe('ArticleIllustrationService Package Skill integration', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-article-skill-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('routes skill mode through the broker and keeps Image Studio records traceable to the Package Run', async () => {
    const runtime = await loadRuntime()
    const { version, run, session, job } = await createSkillJob(runtime, 'skill')
    const generation = mockGeneration(runtime)

    await runtime.articleIllustrationService.generateSkillScene(job.id, session.id, runtime.articleIllustrationRepo.listScenes(job.id)[0].id)

    expect(generation).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      skillRunId: run!.id,
      skillVersionId: version.id,
      grantId: expect.any(String),
    }))
    expect(runtime.imageSessionRepo.listBySkillRun(run!.id)).toEqual([
      expect.objectContaining({ id: session.id, skill_run_id: run!.id, skill_version_id: version.id, grant_id: expect.any(String) }),
    ])
    expect(runtime.imageGenerationRepo.listBySkillRun(run!.id)).toEqual([
      expect.objectContaining({ skill_run_id: run!.id, skill_version_id: version.id, grant_id: expect.any(String) }),
    ])
    expect(runtime.skillPackageRepo.listArtifacts(run!.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ run_id: run!.id, kind: 'image-reference' }),
    ]))
    expect(runtime.articleIllustrationRepo.listScenes(job.id)[0]).toMatchObject({ status: 'completed' })
  })

  it('keeps fallback mode on the legacy Image Studio path and never falls back after a Package Skill denial', async () => {
    const runtime = await loadRuntime()
    const fallback = await createSkillJob(runtime, 'fallback')
    const fallbackGeneration = mockGeneration(runtime)
    await runtime.articleIllustrationService.generateFallbackScene(fallback.job.id, fallback.session.id, runtime.articleIllustrationRepo.listScenes(fallback.job.id)[0].id)
    expect(fallbackGeneration).toHaveBeenCalledWith(expect.objectContaining({ sessionId: fallback.session.id }))
    expect(fallbackGeneration.mock.calls[0][0]).not.toHaveProperty('skillRunId')

    const skill = await createSkillJob(runtime, 'skill')
    const skillGeneration = mockGeneration(runtime)
    const execute = vi.spyOn(runtime.broker, 'executeCapability').mockRejectedValue(new runtime.broker.CapabilityDeniedError('grant denied'))
    await runtime.articleIllustrationService.generateSkillScene(skill.job.id, skill.session.id, runtime.articleIllustrationRepo.listScenes(skill.job.id)[0].id)

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ caller: 'package-runtime', capability: 'image.generate', runId: skill.run!.id }))
    expect(skillGeneration).not.toHaveBeenCalled()
    expect(runtime.articleIllustrationRepo.listScenes(skill.job.id)[0]).toMatchObject({ status: 'failed', error_message: 'grant denied' })
  })
})
