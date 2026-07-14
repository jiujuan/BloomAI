import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function createFixture() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const pkg = skillPackageRepo.createPackage({ name: 'Article Illustrator', description: '', sourceType: 'local-directory' })
  const version = skillPackageRepo.createVersion({
    packageId: pkg.id,
    version: '1.0.0',
    manifest: { runtime: 'instruction-agent' },
    manifestHash: 'image-adapter-fixture',
    packagePath: '/packages/image-adapter-fixture',
  })
  const run = skillPackageRepo.createRun({ skillVersionId: version.id, status: 'running', input: {}, context: {} })
  const { imageGenerationRepo } = await import('../../db/repositories/image-generation.repo')
  return { run, skillPackageRepo, imageGenerationRepo }
}

describe('ImageStudioCapabilityAdapter', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-image-skill-adapter-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates an Image Studio session, retains each generation, and links generation ids to Skill Artifacts', async () => {
    const { run, skillPackageRepo, imageGenerationRepo } = await createFixture()
    const { ImageStudioCapabilityAdapter } = await import('./image-studio-capability-adapter')
    const generateForSession = vi.fn(async (input: { sessionId: string; prompt: string; model: string }) => imageGenerationRepo.create({
      session_id: input.sessionId,
      prompt: input.prompt,
      provider_id: 'fixture',
      model: input.model,
      status: 'completed',
      resolved_prompt: input.prompt,
    }))
    const adapter = new ImageStudioCapabilityAdapter({ generateForSession })

    const result = await adapter.run({
      runId: run.id,
      items: [
        { id: 'cover', prompt: 'Dawn over a harbor', model: 'agnes-image-2.1-flash' },
        { id: 'detail', prompt: 'A handwritten navigation chart', model: 'agnes-image-2.1-flash' },
      ],
    })

    expect(result).toMatchObject({ status: 'completed', imageSessionId: expect.any(String) })
    expect(generateForSession).toHaveBeenCalledTimes(2)
    expect(skillPackageRepo.getRun(run.id)).toMatchObject({ image_session_id: result.imageSessionId })
    expect(generateForSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: result.imageSessionId, prompt: 'Dawn over a harbor', model: 'agnes-image-2.1-flash',
    }))
    expect(imageGenerationRepo.listBySession(result.imageSessionId)).toHaveLength(2)
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'cover', status: 'completed', generationId: expect.any(String) }),
      expect.objectContaining({ id: 'detail', status: 'completed', generationId: expect.any(String) }),
    ])

    const artifacts = skillPackageRepo.listArtifacts(run.id)
    expect(artifacts.filter((artifact) => artifact.kind === 'prompt')).toHaveLength(2)
    const imageArtifacts = artifacts.filter((artifact) => artifact.kind === 'image-reference')
    expect(imageArtifacts).toHaveLength(2)
    expect(imageArtifacts.map((artifact) => artifact.metadata_json)).toEqual(expect.arrayContaining([
      expect.stringContaining(result.items[0].generationId!),
      expect.stringContaining(result.items[1].generationId!),
    ]))
    expect(artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'markdown', path: 'illustrations.md' })]))
  })

  it('limits active generations to two and reports completed_with_errors for a partial batch', async () => {
    const { run, imageGenerationRepo } = await createFixture()
    const { ImageStudioCapabilityAdapter } = await import('./image-studio-capability-adapter')
    let active = 0
    let peak = 0
    const resolvers: Array<() => void> = []
    const generateForSession = vi.fn((input: { sessionId: string; prompt: string; model: string }) => new Promise<any>((resolve) => {
      active += 1
      peak = Math.max(peak, active)
      resolvers.push(() => {
        active -= 1
        resolve(input.prompt === 'fail' ? imageGenerationRepo.create({
          session_id: input.sessionId, prompt: input.prompt, provider_id: 'fixture', model: input.model, status: 'failed', error_msg: 'provider rejected request',
        }) : imageGenerationRepo.create({
          session_id: input.sessionId, prompt: input.prompt, provider_id: 'fixture', model: input.model, status: 'completed',
        }))
      })
    }))
    const adapter = new ImageStudioCapabilityAdapter({ generateForSession, concurrency: 2 })
    const batch = adapter.createBatch({
      runId: run.id,
      items: [
        { id: 'one', prompt: 'one', model: 'agnes-image-2.1-flash' },
        { id: 'two', prompt: 'fail', model: 'agnes-image-2.1-flash' },
        { id: 'three', prompt: 'three', model: 'agnes-image-2.1-flash' },
      ],
    })

    const resultPromise = batch.run()
    await vi.waitFor(() => expect(generateForSession).toHaveBeenCalledTimes(2))
    expect(peak).toBe(2)
    resolvers.shift()!()
    await vi.waitFor(() => expect(generateForSession).toHaveBeenCalledTimes(3))
    resolvers.shift()!()
    resolvers.shift()!()
    const result = await resultPromise

    expect(peak).toBe(2)
    expect(result.status).toBe('completed_with_errors')
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'one', status: 'completed' }),
      expect.objectContaining({ id: 'two', status: 'failed', error: 'provider rejected request' }),
      expect.objectContaining({ id: 'three', status: 'completed' }),
    ]))
  })

  it('retries failed images with an edited prompt and can skip a remaining failure', async () => {
    const { run, imageGenerationRepo } = await createFixture()
    const { ImageStudioCapabilityAdapter } = await import('./image-studio-capability-adapter')
    const generateForSession = vi.fn(async (input: { sessionId: string; prompt: string; model: string }) => imageGenerationRepo.create({
      session_id: input.sessionId,
      prompt: input.prompt,
      provider_id: 'fixture',
      model: input.model,
      status: input.prompt === 'original' ? 'failed' : 'completed',
      error_msg: input.prompt === 'original' ? 'provider rejected request' : null,
    }))
    const batch = new ImageStudioCapabilityAdapter({ generateForSession }).createBatch({
      runId: run.id,
      items: [
        { id: 'retry-edited', prompt: 'original', model: 'agnes-image-2.1-flash' },
        { id: 'skip-failure', prompt: 'original', model: 'agnes-image-2.1-flash' },
      ],
    })

    expect((await batch.run()).status).toBe('completed_with_errors')
    expect(await batch.retry('retry-edited', 'revised')).toMatchObject({
      status: 'completed_with_errors',
      items: expect.arrayContaining([expect.objectContaining({ id: 'retry-edited', prompt: 'revised', status: 'completed', attempts: 2 })]),
    })
    expect(await batch.retry('skip-failure')).toMatchObject({
      status: 'completed_with_errors',
      items: expect.arrayContaining([expect.objectContaining({ id: 'skip-failure', prompt: 'original', status: 'failed', attempts: 2 })]),
    })
    expect(batch.skip('skip-failure')).toMatchObject({
      status: 'completed_with_errors',
      items: expect.arrayContaining([expect.objectContaining({ id: 'skip-failure', status: 'skipped' })]),
    })
    expect(generateForSession).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'revised' }))
  })

  it('cancels pending work as a group without starting more than active items', async () => {
    const { run, imageGenerationRepo } = await createFixture()
    const { ImageStudioCapabilityAdapter } = await import('./image-studio-capability-adapter')
    const resolvers: Array<() => void> = []
    const generateForSession = vi.fn((input: { sessionId: string; prompt: string; model: string }) => new Promise<any>((resolve) => {
      resolvers.push(() => resolve(imageGenerationRepo.create({
        session_id: input.sessionId, prompt: input.prompt, provider_id: 'fixture', model: input.model, status: 'completed',
      })))
    }))
    const batch = new ImageStudioCapabilityAdapter({ generateForSession, concurrency: 2 }).createBatch({
      runId: run.id,
      items: [
        { id: 'one', prompt: 'one', model: 'agnes-image-2.1-flash' },
        { id: 'two', prompt: 'two', model: 'agnes-image-2.1-flash' },
        { id: 'three', prompt: 'three', model: 'agnes-image-2.1-flash' },
      ],
    })

    const resultPromise = batch.run()
    await vi.waitFor(() => expect(generateForSession).toHaveBeenCalledTimes(2))
    expect(batch.cancel()).toMatchObject({
      status: 'cancelled',
      items: expect.arrayContaining([expect.objectContaining({ id: 'three', status: 'cancelled' })]),
    })
    resolvers.shift()!()
    resolvers.shift()!()
    expect(await resultPromise).toMatchObject({ status: 'cancelled' })
    expect(generateForSession).toHaveBeenCalledTimes(2)
  })
})
