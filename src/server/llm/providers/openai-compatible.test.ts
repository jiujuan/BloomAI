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
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeySettingKey: 'openai_api_key',
      isEnabled: true,
      config: {},
    },
    model: {
      id: 'gpt-4o',
      providerId: 'openai',
      modelId: 'gpt-4o',
      label: 'GPT-4o',
      modality: 'text',
      capabilities: {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: 40,
    },
  }
}

async function loadProvider() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  return import('./openai-compatible')
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

describe('OpenAI-compatible provider', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-openai-compatible-'))
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

  it('sends OpenAI-compatible chat completions requests', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}', 'data: [DONE]'])
    )
    globalThis.fetch = fetchMock as typeof fetch

    const { createOpenAICompatibleProvider } = await loadProvider()
    const provider = createOpenAICompatibleProvider(createResolved())

    await collectEvents(
      provider.streamChat({
        model: 'gpt-4o',
        system: 'System prompt',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 123,
      })
    )

    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-openai-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'Hello' },
        ],
        stream: true,
        max_tokens: 123,
      }),
    })
  })

  it('emits delta and done events without requiring usage', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}', 'data: [DONE]'])
    ) as typeof fetch

    const { createOpenAICompatibleProvider } = await loadProvider()
    const provider = createOpenAICompatibleProvider(createResolved())

    await expect(
      collectEvents(
        provider.streamChat({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      )
    ).resolves.toEqual([
      { type: 'delta', text: 'Hi' },
      { type: 'done' },
    ])
  })
})
