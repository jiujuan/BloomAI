import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedImageGenerationRequest, ResolvedLlmModel } from '../types'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof globalThis.fetch

function createResolved(providerId: 'openai' | 'agnes', modelId: string): ResolvedLlmModel {
  return {
    provider: {
      id: providerId,
      name: providerId === 'openai' ? 'OpenAI' : 'Agnes',
      kind: providerId === 'openai' ? 'openai' : 'openai-compatible',
      baseUrl: providerId === 'openai' ? 'https://api.openai.com/v1' : 'https://apihub.agnes-ai.com/v1',
      apiKeySettingKey: providerId === 'openai' ? 'openai_api_key' : 'agnes_api_key',
      isEnabled: true,
      config: {},
    },
    model: {
      id: modelId,
      providerId,
      modelId,
      label: modelId,
      modality: 'image',
      capabilities: {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: 10,
    },
  }
}

function resolvedImageInput(
  providerId: 'openai' | 'agnes',
  input: Omit<ResolvedImageGenerationRequest, 'resolved'>
): ResolvedImageGenerationRequest {
  return {
    ...input,
    resolved: createResolved(providerId, input.model),
  }
}

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  return import('./image')
}

describe('image generation runtime', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-image-runtime-'))
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

  it('preserves the OpenAI DALL-E image request shape', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ url: 'https://cdn.example/image.png' }] }))
    globalThis.fetch = fetchMock as typeof fetch

    const { generateOpenAIImage } = await loadRuntime()

    await expect(
      generateOpenAIImage(
        resolvedImageInput('openai', {
          model: 'dall-e-3',
          prompt: 'A glass flower',
          size: '1024x1024',
          quality: 'standard',
        })
      )
    ).resolves.toEqual({
      providerId: 'openai',
      model: 'dall-e-3',
      url: 'https://cdn.example/image.png',
    })

    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-openai-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: 'A glass flower',
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      }),
    })
  })

  it('puts Agnes response_format under extra_body', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ url: 'https://agnes.example/image.png' }] }))
    globalThis.fetch = fetchMock as typeof fetch

    const { generateAgnesImage } = await loadRuntime()

    await generateAgnesImage(
      resolvedImageInput('agnes', {
        model: 'agnes-image-2.1-flash',
        prompt: 'A bright studio portrait',
        responseFormat: 'url',
      })
    )

    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/v1/images/generations', expect.objectContaining({
      body: JSON.stringify({
        model: 'agnes-image-2.1-flash',
        prompt: 'A bright studio portrait',
        n: 1,
        extra_body: {
          response_format: 'url',
        },
      }),
    }))
  })

  it('puts Agnes image-to-image input under extra_body.image', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ b64_json: 'abc123' }] }))
    globalThis.fetch = fetchMock as typeof fetch

    const { generateAgnesImage } = await loadRuntime()

    const result = await generateAgnesImage(
      resolvedImageInput('agnes', {
        model: 'agnes-image-2.1-flash',
        prompt: 'Restyle this',
        image: ['https://example.com/input.png'],
        responseFormat: 'b64_json',
      })
    )

    expect(result).toEqual({
      providerId: 'agnes',
      model: 'agnes-image-2.1-flash',
      b64_json: 'abc123',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/v1/images/generations', expect.objectContaining({
      body: JSON.stringify({
        model: 'agnes-image-2.1-flash',
        prompt: 'Restyle this',
        n: 1,
        extra_body: {
          response_format: 'b64_json',
          image: ['https://example.com/input.png'],
        },
      }),
    }))
  })

  it('downloads URL output when saveTo is provided', async () => {
    const filePath = path.join(dataDir, 'images', 'generated.png')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [{ url: 'https://cdn.example/image.png' }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
    globalThis.fetch = fetchMock as typeof fetch

    const { generateOpenAIImage } = await loadRuntime()

    const result = await generateOpenAIImage(
      resolvedImageInput('openai', {
        model: 'dall-e-3',
        prompt: 'A saved image',
        saveTo: filePath,
      })
    )

    expect(result.localPath).toBe(filePath)
    expect(fs.readFileSync(filePath)).toEqual(Buffer.from([1, 2, 3]))
  })

  it('dispatches image generation by resolved provider', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ url: 'https://agnes.example/image.png' }] }))
    globalThis.fetch = fetchMock as typeof fetch

    const { generateImage } = await loadRuntime()

    await expect(
      generateImage({
        model: 'agnes-image-2.1-flash',
        prompt: 'A generated image',
      })
    ).resolves.toMatchObject({
      providerId: 'agnes',
      model: 'agnes-image-2.1-flash',
      url: 'https://agnes.example/image.png',
    })
  })
})
