import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent, ResolvedLlmModel } from '../types'
import { parseOllamaNdjsonLine } from '../stream'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof globalThis.fetch

function createResolved(modelId = 'llama3.1:latest'): ResolvedLlmModel {
  return {
    provider: {
      id: 'ollama',
      name: 'Ollama',
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      apiKeySettingKey: null,
      isEnabled: true,
      config: {},
    },
    model: {
      id: modelId,
      providerId: 'ollama',
      modelId,
      label: modelId,
      modality: 'text',
      capabilities: {},
      isEnabled: true,
      isBuiltin: false,
      sortOrder: 1000,
    },
  }
}

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  return {
    db: client.db,
    ...(await import('../index')),
    ...(await import('../../db/repositories/llm.repo')),
  }
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function collectEvents(generator: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const event of generator) {
    events.push(event)
  }
  return events
}

describe('Ollama provider', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-ollama-provider-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('parses Ollama NDJSON delta and done lines', () => {
    expect(parseOllamaNdjsonLine('{"message":{"content":"Hi"},"done":false}')).toEqual({
      type: 'delta',
      text: 'Hi',
    })
    expect(parseOllamaNdjsonLine('{"done":true}')).toEqual({ type: 'done' })
  })

  it('sends Ollama chat requests without an API key', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(['{"message":{"content":"Hi"},"done":false}', '{"done":true}'])
    )
    globalThis.fetch = fetchMock as typeof fetch

    const { createOllamaProvider } = await loadRuntime()
    const provider = createOllamaProvider(createResolved())

    await collectEvents(
      provider.streamChat({
        model: 'llama3.1:latest',
        system: 'System prompt',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    )

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1:latest',
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'Hello' },
        ],
        stream: true,
      }),
    })
  })

  it('dispatches imported Ollama models through streamChatCompletion', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamResponse(['{"message":{"content":"Local"},"done":false}', '{"done":true}'])
    ) as typeof fetch

    const { importOllamaModel, streamChatCompletion } = await loadRuntime()
    importOllamaModel('llama3.1:latest')

    await expect(
      collectEvents(
        streamChatCompletion({
          model: 'llama3.1:latest',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      )
    ).resolves.toEqual([
      { type: 'delta', text: 'Local' },
      { type: 'done' },
    ])
  })

  it('lists remote Ollama models from /api/tags', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        models: [
          {
            name: 'llama3.1:latest',
            modified_at: '2026-01-01T00:00:00Z',
            size: 123,
            digest: 'abc',
            details: { family: 'llama' },
          },
        ],
      })
    ) as typeof fetch

    const { listOllamaRemoteModels } = await loadRuntime()

    await expect(listOllamaRemoteModels()).resolves.toEqual([
      {
        name: 'llama3.1:latest',
        modifiedAt: '2026-01-01T00:00:00Z',
        size: 123,
        digest: 'abc',
        details: { family: 'llama' },
      },
    ])
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags')
  })

  it('imports remote model names as Ollama text models', async () => {
    const { importOllamaModel, llmRepo } = await loadRuntime()

    const imported = importOllamaModel('llama3.1:latest')
    const importedAgain = importOllamaModel('llama3.1:latest')

    expect(imported).toMatchObject({
      id: 'llama3.1:latest',
      provider_id: 'ollama',
      model_id: 'llama3.1:latest',
      modality: 'text',
      is_builtin: 0,
    })
    expect(importedAgain.id).toBe(imported.id)
    expect(llmRepo.listModels({ providerId: 'ollama', modality: 'text' })).toHaveLength(1)
  })
})
