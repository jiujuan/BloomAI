import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent, ResolvedLlmModel } from '../types'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof globalThis.fetch

function createResolved(modelId = 'gpt-4o'): ResolvedLlmModel {
  return {
    provider: {
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeySettingKey: 'openai_api_key',
      isEnabled: true,
      config: {},
    },
    model: {
      id: modelId,
      providerId: 'openai',
      modelId,
      label: modelId,
      modality: 'text',
      capabilities: {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: 40,
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

describe('OpenAI provider', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-openai-provider-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
    process.env.OPENAI_API_KEY = 'test-openai-key'
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates an OpenAI provider for GPT models', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}', 'data: [DONE]'])
    ) as typeof fetch

    const { createOpenAIProvider } = await loadRuntime()
    const provider = createOpenAIProvider(createResolved('gpt-4o-mini'))

    await expect(
      collectEvents(
        provider.streamChat({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      )
    ).resolves.toEqual([
      { type: 'delta', text: 'Hi' },
      { type: 'done' },
    ])
  })

  it('dispatches gpt-4o through streamChatCompletion', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}', 'data: [DONE]'])
    )
    globalThis.fetch = fetchMock as typeof fetch

    const { streamChatCompletion } = await loadRuntime()

    await expect(
      collectEvents(
        streamChatCompletion({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      )
    ).resolves.toEqual([
      { type: 'delta', text: 'Hi' },
      { type: 'done' },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
