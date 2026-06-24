import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string

async function loadDb() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../client')
  await client.runMigrations()
  const repoModule = await import('./llm.repo')

  return { llmRepo: repoModule.llmRepo }
}

describe('llmRepo', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-llm-repo-'))
  })

  afterEach(() => {
    vi.resetModules()
    delete process.env.DATA_DIR
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('seeds built-in providers exactly once', async () => {
    const { llmRepo } = await loadDb()
    const firstProviders = llmRepo.listProviders()

    const client = await import('../client')
    await client.runMigrations()
    const secondProviders = llmRepo.listProviders()

    expect(firstProviders.map((provider) => provider.id).sort()).toEqual([
      'agnes',
      'anthropic',
      'deepseek',
      'ollama',
      'openai',
    ])
    expect(secondProviders).toHaveLength(firstProviders.length)
  })

  it('seeds text, image, and video models by modality', async () => {
    const { llmRepo } = await loadDb()

    expect(llmRepo.listModels({ modality: 'text' }).map((model) => model.id)).toEqual(
      expect.arrayContaining([
        'claude-3-5-sonnet-20241022',
        'claude-3-opus-20240229',
        'claude-3-haiku-20240307',
        'gpt-4o',
        'gpt-4o-mini',
        'agnes-2.0-flash',
        'deepseek-chat',
        'deepseek-reasoner',
      ])
    )
    expect(llmRepo.listModels({ modality: 'image' }).map((model) => model.id)).toEqual([
      'agnes-image-2.1-flash',
      'dall-e-3',
    ])
    expect(llmRepo.listModels({ modality: 'video' }).map((model) => model.id)).toEqual([
      'agnes-video-v2.0',
    ])
  })

  it('persists provider updates', async () => {
    const { llmRepo } = await loadDb()

    const updated = llmRepo.updateProvider('openai', { isEnabled: false })

    expect(updated?.is_enabled).toBe(0)
    expect(llmRepo.getProvider('openai')?.is_enabled).toBe(0)
  })

  it('seeds LLM settings keys', async () => {
    const { llmRepo } = await loadDb()

    const keys = llmRepo.listSettingKeys()

    expect(keys).toEqual(
      expect.arrayContaining([
        'agnes_api_key',
        'deepseek_api_key',
        'ollama_base_url',
        'default_image_model',
        'default_video_model',
      ])
    )
  })

  it('creates and updates video tasks', async () => {
    const { llmRepo } = await loadDb()

    const created = llmRepo.createVideoTask({
      providerId: 'agnes',
      model: 'agnes-video-v2.0',
      providerTaskId: 'provider-task-1',
      providerVideoId: 'provider-video-1',
      input: { prompt: 'A blooming garden' },
      status: 'queued',
    })
    const updated = llmRepo.updateVideoTask(created.id, {
      status: 'completed',
      progress: 100,
      output: { url: 'https://example.test/video.mp4' },
    })

    expect(updated?.status).toBe('completed')
    expect(updated?.progress).toBe(100)
    expect(llmRepo.getVideoTask(created.id)?.output_json).toBe('{"url":"https://example.test/video.mp4"}')
  })
})


