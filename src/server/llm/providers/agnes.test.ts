import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent, ResolvedLlmModel } from '../types'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof globalThis.fetch

function createResolved(): ResolvedLlmModel {
  return {
    provider: {
      id: 'agnes',
      name: 'Agnes',
      kind: 'openai-compatible',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      apiKeySettingKey: 'agnes_api_key',
      isEnabled: true,
      config: {},
    },
    model: {
      id: 'agnes-2.0-flash',
      providerId: 'agnes',
      modelId: 'agnes-2.0-flash',
      label: 'Agnes 2.0 Flash',
      modality: 'text',
      capabilities: {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: 60,
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

describe('Agnes text provider', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-agnes-provider-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
    process.env.AGNES_API_KEY = 'test-agnes-key'
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('uses the Agnes chat completions URL and model id', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}', 'data: [DONE]'])
    )
    globalThis.fetch = fetchMock as typeof fetch

    const { createAgnesTextProvider } = await loadRuntime()
    const provider = createAgnesTextProvider(createResolved())

    await collectEvents(
      provider.streamChat({
        model: 'agnes-2.0-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    )

    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-agnes-key',
        'Content-Type': 'application/json',
      },
      body: expect.stringContaining('"model":"agnes-2.0-flash"'),
    })
  })

  it('dispatches Agnes text through streamChatCompletion', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"Agnes"}}]}', 'data: [DONE]'])
    ) as typeof fetch

    const { streamChatCompletion } = await loadRuntime()

    await expect(
      collectEvents(
        streamChatCompletion({
          model: 'agnes-2.0-flash',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      )
    ).resolves.toEqual([
      { type: 'delta', text: 'Agnes' },
      { type: 'done' },
    ])
  })

  it('throws a provider-specific config error when the Agnes key is missing', async () => {
    delete process.env.AGNES_API_KEY

    const { LlmConfigError, createAgnesTextProvider } = await loadRuntime()
    const provider = createAgnesTextProvider(createResolved())

    await expect(
      collectEvents(
        provider.streamChat({
          model: 'agnes-2.0-flash',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      )
    ).rejects.toMatchObject({
      code: new LlmConfigError('unused').code,
      message: expect.stringContaining('Agnes'),
    })
  })
})
