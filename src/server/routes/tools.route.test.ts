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
  const client = await import('../db/client')
  const app = await createApp()

  return { app, db: client.db }
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

function mockProviderFetch(providerResponse: object) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    if (url.startsWith('http://127.0.0.1:')) {
      return originalFetch(input, init)
    }

    return Response.json(providerResponse)
  })
  globalThis.fetch = fetchMock as typeof fetch
  return fetchMock
}

describe('tools route image_gen', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-tools-route-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.AGNES_API_KEY = 'test-agnes-key'
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('exposes optional image_gen model fields in the tool schema', async () => {
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/tools/image_gen`)
      const body = await response.json()
      const paramsSchema = JSON.parse(body.data.params_schema)

      expect(paramsSchema).toMatchObject({
        prompt: { type: 'string' },
        model: { type: 'string' },
        image: { type: 'array' },
        responseFormat: { type: 'string', enum: ['url', 'b64_json'] },
      })
    })
  })

  it('runs image_gen through OpenAI by default and records tool output', async () => {
    const fetchMock = mockProviderFetch({ data: [{ url: 'https://cdn.example/openai.png' }] })
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/tools/image_gen/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { prompt: 'A paper lantern' } }),
      })
      const body = await response.json()

      expect(body.data).toEqual({
        providerId: 'openai',
        model: 'dall-e-3',
        url: 'https://cdn.example/openai.png',
      })

      const runsResponse = await fetch(`${baseUrl}/tools/image_gen/runs`)
      const runsBody = await runsResponse.json()
      expect(runsBody.data[0]).toMatchObject({ status: 'success' })
      expect(JSON.parse(runsBody.data[0].output_json)).toMatchObject({ providerId: 'openai', model: 'dall-e-3' })
    })

    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.objectContaining({
      body: expect.stringContaining('"model":"dall-e-3"'),
    }))
  })

  it('runs image_gen through Agnes when the Agnes image model is selected', async () => {
    const fetchMock = mockProviderFetch({ data: [{ url: 'https://cdn.example/agnes.png' }] })
    const { app } = await loadApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/tools/image_gen/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            model: 'agnes-image-2.1-flash',
            prompt: 'A neon orchid',
            responseFormat: 'url',
          },
        }),
      })
      const body = await response.json()

      expect(body.data).toEqual({
        providerId: 'agnes',
        model: 'agnes-image-2.1-flash',
        url: 'https://cdn.example/agnes.png',
      })
    })

    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/v1/images/generations', expect.objectContaining({
      body: JSON.stringify({
        model: 'agnes-image-2.1-flash',
        prompt: 'A neon orchid',
        n: 1,
        extra_body: {
          response_format: 'url',
        },
      }),
    }))
  })
})
