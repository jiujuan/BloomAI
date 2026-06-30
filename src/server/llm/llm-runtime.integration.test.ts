import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent } from './types'

const anthropicMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  stream: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: anthropicMock.constructor,
}))

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof globalThis.fetch

async function loadApp() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const { createApp } = await import('../app')
  const { sessionRepo } = await import('../db/repositories/session.repo')
  const { llmRepo } = await import('../db/repositories/llm.repo')
  const client = await import('../db/client')
  const app = await createApp()

  return { app, db: client.db, sessionRepo, llmRepo }
}

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const runtime = await import('./index')
  const { llmRepo } = await import('../db/repositories/llm.repo')

  return { db: client.db, runtime, llmRepo }
}

async function withServer<T>(
  app: Awaited<ReturnType<typeof loadApp>>['app'],
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening))
  })
  const address = server.address() as AddressInfo

  try {
    return await fn(`http://127.0.0.1:${address.port}/api/v1`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function requestJson(baseUrl: string, route: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  return { status: response.status, body: await response.json() }
}

function textStream(text: string): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text))
        controller.close()
      },
    }),
    { status: 200 }
  )
}

function sseResponse(text: string): Response {
  return textStream(`data: {"choices":[{"delta":{"content":"${text}"}}]}\n\ndata: [DONE]\n\n`)
}

function ollamaResponse(text: string): Response {
  return textStream(`${JSON.stringify({ message: { content: text } })}\n${JSON.stringify({ done: true })}\n`)
}

function anthropicStream(text: string) {
  const handlers: Record<string, (value: any) => void> = {}
  const sdkStream: { on: any; finalMessage: any } = {
    on: vi.fn((event: string, handler: (value: any) => void) => {
      handlers[event] = handler
      return sdkStream
    }),
    finalMessage: vi.fn(async () => {
      handlers.text?.(text)
      return { usage: { input_tokens: 1, output_tokens: 1 } }
    }),
  }
  return sdkStream
}

function installProviderFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://api.openai.com/v1/chat/completions') return sseResponse('openai-ok')
    if (url === 'https://apihub.agnes-ai.com/v1/chat/completions') return sseResponse('agnes-ok')
    if (url === 'https://api.deepseek.com/v1/chat/completions') return sseResponse('deepseek-ok')
    if (url === 'http://127.0.0.1:11434/api/chat') return ollamaResponse('ollama-ok')
    if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init)
    if (url === 'https://api.openai.com/v1/images/generations') return Response.json({ data: [{ url: 'https://cdn.example/openai.png' }] })
    if (url === 'https://apihub.agnes-ai.com/v1/images/generations') return Response.json({ data: [{ url: 'https://cdn.example/agnes.png' }] })
    if (url === 'https://apihub.agnes-ai.com/v1/videos') return Response.json({ task_id: 'provider-task-1', video_id: 'video-1', status: 'queued' })
    if (url === 'https://apihub.agnes-ai.com/agnesapi?video_id=video-1') {
      return Response.json({ status: 'completed', progress: 100, remixed_from_video_id: 'https://cdn.example/video.mp4' })
    }
    throw new Error(`Unexpected fetch URL: ${url}`)
  })
  globalThis.fetch = fetchMock as typeof fetch
  return fetchMock
}

async function collectText(generator: AsyncGenerator<ChatStreamEvent>): Promise<string> {
  let text = ''
  for await (const event of generator) {
    if (event.type === 'delta') text += event.text
  }
  return text
}

describe('LLM runtime end-to-end regression', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-llm-runtime-integration-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
    anthropicMock.constructor.mockReset()
    anthropicMock.stream.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.AGNES_API_KEY = 'test-agnes-key'
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('wires registry, settings masking, and default session model creation', async () => {
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const providers = await requestJson(baseUrl, '/llm/providers')
      const models = await requestJson(baseUrl, '/llm/models?modality=text')

      expect(providers.status).toBe(200)
      expect(providers.body.data.map((provider: any) => provider.id)).toEqual(expect.arrayContaining([
        'anthropic',
        'openai',
        'agnes',
        'deepseek',
        'ollama',
      ]))
      expect(models.status).toBe(200)
      expect(models.body.data.map((model: any) => model.id)).toEqual(expect.arrayContaining([
        'claude-3-5-sonnet-20241022',
        'gpt-4o',
        'agnes-2.0-flash',
        'deepseek-chat',
      ]))

      await requestJson(baseUrl, '/settings', {
        method: 'PATCH',
        body: JSON.stringify({ model: 'gpt-4o', openai_api_key: 'saved-openai-key' }),
      })
      const settings = await requestJson(baseUrl, '/settings')
      const session = await requestJson(baseUrl, '/sessions', { method: 'POST', body: JSON.stringify({}) })

      expect(settings.body.data.openai_api_key).toBe('***masked***')
      expect(JSON.stringify(settings.body.data)).not.toContain('saved-openai-key')
      expect(session.status).toBe(201)
      expect(session.body.data.model).toBe('gpt-4o')
    })
  })

  it('dispatches chat streams through every configured text provider', async () => {
    anthropicMock.stream.mockReturnValue(anthropicStream('anthropic-ok'))
    anthropicMock.constructor.mockImplementation(() => ({ messages: { stream: anthropicMock.stream } }))
    const fetchMock = installProviderFetchMock()
    const { runtime } = await loadRuntime()
    runtime.importOllamaModel('llama3.1:latest')

    await expect(collectText(runtime.streamChatCompletion({ model: 'claude-3-5-sonnet-20241022', messages: [{ role: 'user', content: 'Hi' }] }))).resolves.toBe('anthropic-ok')
    await expect(collectText(runtime.streamChatCompletion({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }))).resolves.toBe('openai-ok')
    await expect(collectText(runtime.streamChatCompletion({ model: 'agnes-2.0-flash', messages: [{ role: 'user', content: 'Hi' }] }))).resolves.toBe('agnes-ok')
    await expect(collectText(runtime.streamChatCompletion({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'Hi' }] }))).resolves.toBe('deepseek-ok')
    await expect(collectText(runtime.streamChatCompletion({ model: 'llama3.1:latest', messages: [{ role: 'user', content: 'Hi' }] }))).resolves.toBe('ollama-ok')

    expect(anthropicMock.stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-3-5-sonnet-20241022' }))
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({ body: expect.stringContaining('"model":"gpt-4o"') }))
    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/v1/chat/completions', expect.objectContaining({ body: expect.stringContaining('"model":"agnes-2.0-flash"') }))
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/v1/chat/completions', expect.objectContaining({ body: expect.stringContaining('"model":"deepseek-chat"') }))
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11434/api/chat', expect.objectContaining({ body: expect.stringContaining('"model":"llama3.1:latest"') }))
  })

  it('dispatches image_gen and Agnes video routes through the LLM runtime', async () => {
    installProviderFetchMock()
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const openaiImage = await requestJson(baseUrl, '/tools/image_gen/run', {
        method: 'POST',
        body: JSON.stringify({ input: { prompt: 'OpenAI image' } }),
      })
      const agnesImage = await requestJson(baseUrl, '/tools/image_gen/run', {
        method: 'POST',
        body: JSON.stringify({ input: { model: 'agnes-image-2.1-flash', prompt: 'Agnes image' } }),
      })
      const videoCreate = await requestJson(baseUrl, '/llm/videos', {
        method: 'POST',
        body: JSON.stringify({ model: 'agnes-video-v2.0', prompt: 'Agnes video' }),
      })
      const videoQuery = await requestJson(baseUrl, `/llm/videos/${videoCreate.body.data.taskId}`)

      expect(openaiImage.body.data).toMatchObject({ providerId: 'openai', model: 'dall-e-3', url: 'https://cdn.example/openai.png' })
      expect(agnesImage.body.data).toMatchObject({ providerId: 'agnes', model: 'agnes-image-2.1-flash', url: 'https://cdn.example/agnes.png' })
      expect(videoCreate.status).toBe(201)
      expect(videoCreate.body.data).toMatchObject({ providerId: 'agnes', model: 'agnes-video-v2.0', status: 'queued' })
      expect(videoQuery.body.data).toMatchObject({ status: 'completed', url: 'https://cdn.example/video.mp4' })
    })
  })
})
