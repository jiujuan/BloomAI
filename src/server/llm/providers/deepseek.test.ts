import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent, ResolvedLlmModel } from '../types'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof globalThis.fetch

function createResolved(modelId = 'deepseek-chat'): ResolvedLlmModel {
  return {
    provider: {
      id: 'deepseek',
      name: 'DeepSeek',
      kind: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKeySettingKey: 'deepseek_api_key',
      isEnabled: true,
      config: {},
    },
    model: {
      id: modelId,
      providerId: 'deepseek',
      modelId,
      label: modelId,
      modality: 'text',
      capabilities: {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: 70,
    },
  }
}

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  return import('../index')
}

function streamResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines.join('\n')))
        controller.close()
      },
    }),
    { status: 200 }
  )
}

async function collectEvents(generator: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const event of generator) {
    events.push(event)
  }
  return events
}

describe('DeepSeek provider', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepseek-provider-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('uses the DeepSeek chat completions URL and model id', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}', 'data: [DONE]'])
    )
    globalThis.fetch = fetchMock as typeof fetch

    const { createDeepSeekProvider } = await loadRuntime()
    const provider = createDeepSeekProvider(createResolved('deepseek-reasoner'))

    await collectEvents(
      provider.streamChat({
        model: 'deepseek-reasoner',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    )

    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-deepseek-key',
        'Content-Type': 'application/json',
      },
      body: expect.stringContaining('"model":"deepseek-reasoner"'),
    })
  })

  it('dispatches DeepSeek text through streamChatCompletion', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"DeepSeek"}}]}', 'data: [DONE]'])
    ) as typeof fetch

    const { streamChatCompletion } = await loadRuntime()

    await expect(
      collectEvents(
        streamChatCompletion({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      )
    ).resolves.toEqual([
      { type: 'delta', text: 'DeepSeek' },
      { type: 'done' },
    ])
  })

  it('throws a provider-specific config error when the DeepSeek key is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY

    const { LlmConfigError, createDeepSeekProvider } = await loadRuntime()
    const provider = createDeepSeekProvider(createResolved())

    await expect(
      collectEvents(
        provider.streamChat({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      )
    ).rejects.toMatchObject({
      code: new LlmConfigError('unused').code,
      message: expect.stringContaining('DeepSeek'),
    })
  })
})
