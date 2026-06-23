import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string

async function loadRegistry() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const registry = await import('./registry')
  const { llmRepo } = await import('../db/repositories/llm.repo')
  const errors = await import('./errors')

  return { ...registry, llmRepo, ...errors }
}

describe('LLM registry', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-llm-registry-'))
  })

  afterEach(() => {
    vi.resetModules()
    delete process.env.DATA_DIR
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('resolves GPT text models to OpenAI', async () => {
    const { resolveModel } = await loadRegistry()

    const resolved = await resolveModel('gpt-4o', 'text')

    expect(resolved.provider.id).toBe('openai')
    expect(resolved.model.id).toBe('gpt-4o')
    expect(resolved.model.modelId).toBe('gpt-4o')
  })

  it('resolves Agnes image and video models to Agnes', async () => {
    const { resolveModel } = await loadRegistry()

    await expect(resolveModel('agnes-image-2.1-flash', 'image')).resolves.toMatchObject({
      provider: { id: 'agnes' },
      model: { modality: 'image' },
    })
    await expect(resolveModel('agnes-video-v2.0', 'video')).resolves.toMatchObject({
      provider: { id: 'agnes' },
      model: { modality: 'video' },
    })
  })

  it('throws a typed unsupported error for modality mismatch', async () => {
    const { LlmUnsupportedModelError, resolveModel } = await loadRegistry()

    await expect(resolveModel('agnes-video-v2.0', 'text')).rejects.toBeInstanceOf(LlmUnsupportedModelError)
  })

  it('throws a config error when the provider is disabled', async () => {
    const { LlmConfigError, llmRepo, resolveModel } = await loadRegistry()
    llmRepo.updateProvider('openai', { isEnabled: false })

    await expect(resolveModel('gpt-4o', 'text')).rejects.toBeInstanceOf(LlmConfigError)
  })

  it('throws a config error when the model is disabled', async () => {
    const { LlmConfigError, llmRepo, resolveModel } = await loadRegistry()
    llmRepo.updateModel('gpt-4o', { isEnabled: false })

    await expect(resolveModel('gpt-4o', 'text')).rejects.toBeInstanceOf(LlmConfigError)
  })
})
