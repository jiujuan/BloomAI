import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ResolvedImageGenerationRequest, ResolvedLlmModel } from '../../types'

// Mock the settings module to avoid needing a real DB in unit tests.
vi.mock('../../settings', () => ({
  getProviderApiKey: (_p: unknown) => 'test-api-key',
  getProviderBaseUrl: (p: { kind: string; baseUrl: string | null }) =>
    p.kind === 'ollama' ? 'http://127.0.0.1:11434' : (p.baseUrl ?? 'https://example.com'),
  getSettingValue: (_k: string) => '',
}))

function makeTogetherInput(overrides: Partial<ResolvedImageGenerationRequest> = {}): ResolvedImageGenerationRequest {
  const resolved: ResolvedLlmModel = {
    provider: {
      id: 'together',
      name: 'Together.ai',
      kind: 'openai-compatible',
      baseUrl: 'https://api.together.xyz/v1',
      apiKeySettingKey: 'together_api_key',
      isEnabled: true,
      config: {},
    },
    model: {
      id: 'flux-schnell',
      providerId: 'together',
      modelId: 'black-forest-labs/FLUX.1-schnell',
      label: 'FLUX.1 Schnell',
      modality: 'image',
      capabilities: {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: 10,
    },
  }
  return { model: 'black-forest-labs/FLUX.1-schnell', prompt: 'A futuristic city at dusk', resolved, ...overrides }
}

function makeOllamaInput(): ResolvedImageGenerationRequest {
  return {
    model: 'sd3.5',
    prompt: 'A mountain at sunset',
    resolved: {
      provider: {
        id: 'ollama', name: 'Ollama', kind: 'ollama',
        baseUrl: 'http://127.0.0.1:11434', apiKeySettingKey: null, isEnabled: true, config: {},
      },
      model: {
        id: 'ollama-sd35', providerId: 'ollama', modelId: 'sd3.5', label: 'Ollama SD3.5 (local)',
        modality: 'image', capabilities: {}, isEnabled: true, isBuiltin: false, sortOrder: 30,
      },
    },
  }
}

let originalFetch: typeof globalThis.fetch

beforeEach(() => { originalFetch = globalThis.fetch })
afterEach(() => { globalThis.fetch = originalFetch })

describe('openai-compatible image adapter', () => {
  it('calls /images/generations with model + prompt', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({ data: [{ url: 'https://cdn.together.xyz/img.png' }] })
    )
    globalThis.fetch = mockFetch as typeof fetch

    const { openaiCompatibleImageAdapter } = await import('./openai-compatible-image.adapter')
    const result = await openaiCompatibleImageAdapter.generate(makeTogetherInput())

    expect(result.url).toBe('https://cdn.together.xyz/img.png')
    expect(result.providerId).toBe('together')
    expect(mockFetch).toHaveBeenCalledOnce()
    const calls = (mockFetch.mock.calls as unknown) as Array<[string, RequestInit?]>
    const [url, opts] = calls[0]
    expect(url).toBe('https://api.together.xyz/v1/images/generations')
    const body = JSON.parse(opts?.body as string)
    expect(body.model).toBe('black-forest-labs/FLUX.1-schnell')
    expect(body.prompt).toBe('A futuristic city at dusk')
  })

  it('accepts b64_json response', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({ data: [{ b64_json: 'base64imagedata' }] })
    )
    globalThis.fetch = mockFetch as typeof fetch

    const { openaiCompatibleImageAdapter } = await import('./openai-compatible-image.adapter')
    const result = await openaiCompatibleImageAdapter.generate(makeTogetherInput())

    expect(result.b64_json).toBe('base64imagedata')
    expect(result.url).toBeUndefined()
  })

  it('throws when response contains no image data', async () => {
    const mockFetch = vi.fn(async () => Response.json({ data: [{}] }))
    globalThis.fetch = mockFetch as typeof fetch

    const { openaiCompatibleImageAdapter } = await import('./openai-compatible-image.adapter')
    await expect(openaiCompatibleImageAdapter.generate(makeTogetherInput())).rejects.toThrow(
      'did not include a URL or base64 image'
    )
  })

  it('throws LlmProviderError on HTTP error', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({ error: { message: 'model not found' } }, { status: 400 })
    )
    globalThis.fetch = mockFetch as typeof fetch

    const { openaiCompatibleImageAdapter } = await import('./openai-compatible-image.adapter')
    await expect(openaiCompatibleImageAdapter.generate(makeTogetherInput())).rejects.toThrow('model not found')
  })

  it('passes seed and negative_prompt when provided', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({ data: [{ url: 'https://img.example/x.png' }] })
    )
    globalThis.fetch = mockFetch as typeof fetch

    const { openaiCompatibleImageAdapter } = await import('./openai-compatible-image.adapter')
    await openaiCompatibleImageAdapter.generate(
      makeTogetherInput({ seed: 42, negativePrompt: 'blurry', size: '1024x1024' })
    )

    const calls2 = (mockFetch.mock.calls as unknown) as Array<[string, RequestInit?]>
    const body = JSON.parse((calls2[0][1] as RequestInit).body as string)
    expect(body.seed).toBe(42)
    expect(body.negative_prompt).toBe('blurry')
    expect(body.size).toBe('1024x1024')
  })
})

describe('ollama image adapter', () => {
  it('returns image from images[] in Ollama response', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({ response: '', images: ['aGVsbG8='], done: true })
    )
    globalThis.fetch = mockFetch as typeof fetch

    const { ollamaImageAdapter } = await import('./ollama-image.adapter')
    const result = await ollamaImageAdapter.generate(makeOllamaInput())

    expect(result.b64_json).toBe('aGVsbG8=')
    expect(result.providerId).toBe('ollama')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/generate',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws LlmUnsupportedModelError when images[] is empty', async () => {
    const mockFetch = vi.fn(async () =>
      Response.json({ response: '', images: [], done: true })
    )
    globalThis.fetch = mockFetch as typeof fetch

    const { ollamaImageAdapter } = await import('./ollama-image.adapter')
    await expect(ollamaImageAdapter.generate(makeOllamaInput())).rejects.toThrow('did not return an image')
  })
})
