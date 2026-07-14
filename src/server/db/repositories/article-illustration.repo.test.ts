import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRepo() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../client')
  await client.runMigrations()
  const { articleIllustrationRepo } = await import('./article-illustration.repo')
  return { articleIllustrationRepo }
}

describe('articleIllustrationRepo', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-article-illustration-repo-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('persists ordered editable scenes and finds recoverable approval jobs', async () => {
    const { articleIllustrationRepo } = await loadRepo()
    const job = articleIllustrationRepo.createJob({
      sourceType: 'text',
      sourceLabel: 'Example article',
      articleText: 'Article body',
      mode: 'fallback',
      config: { model: 'agnes-image-2.1-flash', count: 3 },
    })

    const scenes = articleIllustrationRepo.replaceScenes(job.id, [
      { ordinal: 1, title: 'Opening', excerpt: 'Opening paragraph', prompt: 'A sunrise over a city' },
      { ordinal: 2, title: 'Middle', excerpt: 'Middle paragraph', prompt: 'A team discussing a plan' },
      { ordinal: 3, title: 'Closing', excerpt: 'Closing paragraph', prompt: 'A calm night skyline' },
    ])
    articleIllustrationRepo.updateScene(job.id, scenes[1].id, { prompt: 'An edited middle-scene prompt' })
    articleIllustrationRepo.incrementSceneRetry(job.id, scenes[1].id)

    expect(articleIllustrationRepo.listScenes(job.id).map((scene) => scene.ordinal)).toEqual([1, 2, 3])
    expect(articleIllustrationRepo.listScenes(job.id)[1]).toMatchObject({
      prompt: 'An edited middle-scene prompt',
      retry_count: 1,
    })
    expect(articleIllustrationRepo.listRecoverable()).toContainEqual(expect.objectContaining({
      id: job.id,
      status: 'waiting_approval',
      config: { model: 'agnes-image-2.1-flash', count: 3 },
    }))
  })
})