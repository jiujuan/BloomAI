import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  return import('./index')
}

describe('LLM runtime skeleton', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-llm-skeleton-'))
  })

  afterEach(() => {
    vi.resetModules()
    delete process.env.DATA_DIR
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('exports streamChatCompletion and throws a typed error for an unknown model', async () => {
    const { LlmUnsupportedModelError, streamChatCompletion } = await loadRuntime()

    await expect(async () => {
      for await (const _event of streamChatCompletion({
        model: 'unknown-model',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        // Exhaust the async generator so thrown errors are observable.
      }
    }).rejects.toBeInstanceOf(LlmUnsupportedModelError)
  })

  it('parses OpenAI-compatible done SSE lines', async () => {
    const { parseOpenAICompatibleSseLine } = await loadRuntime()

    expect(parseOpenAICompatibleSseLine('data: [DONE]')).toEqual({ type: 'done' })
  })

  it('preserves LLM error code and message', async () => {
    const { LlmUnsupportedModelError } = await loadRuntime()
    const error = new LlmUnsupportedModelError('Model is not configured')

    expect(error.code).toBe('LLM_UNSUPPORTED_MODEL')
    expect(error.message).toBe('Model is not configured')
  })
})
