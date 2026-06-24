import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof globalThis.fetch

async function loadApp() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const { createApp } = await import('../app')
  const { llmRepo } = await import('../db/repositories/llm.repo')
  const { settingsRepo } = await import('../db/repositories/settings.repo')
  const app = await createApp()

  return { app, llmRepo, settingsRepo }
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

async function requestJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  return {
    status: response.status,
    body: await response.json(),
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockProviderFetch(body: unknown) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('http://127.0.0.1:')) {
      return originalFetch(url, init)
    }
    return jsonResponse(body)
  })
  globalThis.fetch = fetchMock as typeof fetch
  return fetchMock
}

describe('LLM route', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-llm-route-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('lists providers with hasApiKey and without secret values', async () => {
    const { app, settingsRepo } = await loadApp()
    settingsRepo.setMany({ openai_api_key: 'secret-openai-key' })

    await withServer(app, async (baseUrl) => {
      const { status, body } = await requestJson(baseUrl, '/llm/providers')
      const openai = body.data.find((provider: any) => provider.id === 'openai')

      expect(status).toBe(200)
      expect(openai).toMatchObject({
        id: 'openai',
        name: 'OpenAI',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        hasApiKey: true,
      })
      expect(JSON.stringify(openai)).not.toContain('secret-openai-key')
    })
  })

  it('patches only allowed provider fields', async () => {
    const { app, llmRepo } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const { status, body } = await requestJson(baseUrl, '/llm/providers/openai', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'OpenAI Custom',
          baseUrl: 'https://proxy.example/v1',
          isEnabled: false,
          config: { organization: 'team-a' },
          kind: 'ollama',
          apiKeySettingKey: 'leaked_key',
        }),
      })

      expect(status).toBe(200)
      expect(body.data).toMatchObject({
        id: 'openai',
        name: 'OpenAI Custom',
        kind: 'openai',
        baseUrl: 'https://proxy.example/v1',
        isEnabled: false,
        config: { organization: 'team-a' },
      })
      expect(llmRepo.getProvider('openai')).toMatchObject({
        kind: 'openai',
        api_key_setting_key: 'openai_api_key',
      })
    })
  })

  it('lists models by modality and rejects invalid modality', async () => {
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const text = await requestJson(baseUrl, '/llm/models?modality=text')
      const invalid = await requestJson(baseUrl, '/llm/models?modality=audio')

      expect(text.status).toBe(200)
      expect(text.body.data.map((model: any) => model.id)).toEqual(expect.arrayContaining(['gpt-4o', 'deepseek-chat']))
      expect(text.body.data.every((model: any) => model.modality === 'text')).toBe(true)
      expect(invalid.status).toBe(400)
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  it('creates and updates models', async () => {
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const created = await requestJson(baseUrl, '/llm/models', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'openai',
          modelId: 'gpt-test',
          label: 'GPT Test',
          modality: 'text',
        }),
      })
      const updated = await requestJson(baseUrl, '/llm/models/gpt-test', {
        method: 'PATCH',
        body: JSON.stringify({
          label: 'GPT Test Updated',
          isEnabled: false,
          capabilities: { streaming: true },
        }),
      })

      expect(created.status).toBe(201)
      expect(created.body.data).toMatchObject({
        id: 'gpt-test',
        providerId: 'openai',
        modelId: 'gpt-test',
        label: 'GPT Test',
        modality: 'text',
      })
      expect(updated.status).toBe(200)
      expect(updated.body.data).toMatchObject({
        id: 'gpt-test',
        label: 'GPT Test Updated',
        isEnabled: false,
        capabilities: { streaming: true },
      })
    })
  })

  it('requires providerId, modelId, label, and modality to create a model', async () => {
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const { status, body } = await requestJson(baseUrl, '/llm/models', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'openai', modelId: 'missing-label' }),
      })

      expect(status).toBe(400)
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  it('lists remote Ollama models', async () => {
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const serverFetch = globalThis.fetch
      globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith('/api/tags')) {
          return jsonResponse({ models: [{ name: 'llama3.1:latest', size: 123 }] })
        }
        return serverFetch(url, init)
      }) as typeof fetch

      const { status, body } = await requestJson(baseUrl, '/llm/ollama/models')

      expect(status).toBe(200)
      expect(body.data).toEqual([{ name: 'llama3.1:latest', size: 123 }])
    })
  })

  it('creates an Agnes video task through the LLM API', async () => {
    process.env.AGNES_API_KEY = 'test-agnes-key'
    const fetchMock = mockProviderFetch({ task_id: 'provider-task-1', video_id: 'video-1', status: 'queued' })
    const { app, llmRepo } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const { status, body } = await requestJson(baseUrl, '/llm/videos', {
        method: 'POST',
        body: JSON.stringify({
          model: 'agnes-video-v2.0',
          prompt: 'A city blooming at sunrise',
          width: 1280,
          height: 720,
          numFrames: 96,
          frameRate: 24,
          image: ['https://example.com/input.png'],
        }),
      })

      expect(status).toBe(201)
      expect(body.data).toMatchObject({
        providerId: 'agnes',
        model: 'agnes-video-v2.0',
        videoId: 'video-1',
        status: 'queued',
      })
      expect(llmRepo.getVideoTask(body.data.taskId)).toMatchObject({
        provider_task_id: 'provider-task-1',
        provider_video_id: 'video-1',
      })
    })

    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/v1/videos', expect.objectContaining({
      body: expect.stringContaining('"num_frames":96'),
    }))
  })

  it('queries an Agnes video task through the LLM API and updates local status', async () => {
    process.env.AGNES_API_KEY = 'test-agnes-key'
    const { app, llmRepo } = await loadApp()
    const task = llmRepo.createVideoTask({
      providerId: 'agnes',
      model: 'agnes-video-v2.0',
      providerTaskId: 'provider-task-1',
      providerVideoId: 'video-1',
      input: { prompt: 'A finished video' },
      status: 'in_progress',
    })
    const fetchMock = mockProviderFetch({
      status: 'completed',
      progress: 100,
      remixed_from_video_id: 'https://cdn.example/video.mp4',
    })

    await withServer(app, async (baseUrl) => {
      const { status, body } = await requestJson(baseUrl, `/llm/videos/${task.id}`)

      expect(status).toBe(200)
      expect(body.data).toEqual({
        taskId: task.id,
        videoId: 'video-1',
        providerId: 'agnes',
        model: 'agnes-video-v2.0',
        status: 'completed',
        progress: 100,
        url: 'https://cdn.example/video.mp4',
      })
      expect(llmRepo.getVideoTask(task.id)?.status).toBe('completed')
    })

    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/agnesapi?video_id=video-1', expect.any(Object))
  })
})

