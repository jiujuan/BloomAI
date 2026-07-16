import { describe, expect, it } from 'vitest'
import { sanitizeReferenceImages, looksLikeRefusal } from './image-studio.service'

describe('sanitizeReferenceImages', () => {
  it('keeps data: and http(s) URLs', () => {
    const out = sanitizeReferenceImages('agnes-image-2.1-flash', [
      'data:image/png;base64,AAA',
      'https://example.com/a.png',
      'http://example.com/b.jpg',
    ])
    expect(out).toHaveLength(3)
  })

  it('drops malformed / non-string entries', () => {
    const out = sanitizeReferenceImages('agnes-image-2.1-flash', ['ftp://x', 'not a url', 123, null, undefined])
    expect(out).toEqual([])
  })

  it('caps at 4 images', () => {
    const many = Array.from({ length: 7 }, (_, i) => `data:image/png;base64,${i}`)
    expect(sanitizeReferenceImages('agnes-image-2.1-flash', many)).toHaveLength(4)
  })

  it('returns [] for a model that cannot do img2img (dall-e-3)', () => {
    expect(sanitizeReferenceImages('dall-e-3', ['data:image/png;base64,AAA'])).toEqual([])
  })

  it('returns [] when images is not an array', () => {
    expect(sanitizeReferenceImages('agnes-image-2.1-flash', undefined)).toEqual([])
    expect(sanitizeReferenceImages('agnes-image-2.1-flash', 'data:image/png;base64,AAA')).toEqual([])
  })
})

describe('looksLikeRefusal', () => {
  it('flags the observed provider refusal string', () => {
    expect(looksLikeRefusal('Unable to generate this content. Please modify your prompt and try again.')).toBe(true)
  })

  it('flags common LLM refusal / apology phrasings', () => {
    expect(looksLikeRefusal("I'm sorry, but I can't help with that.")).toBe(true)
    expect(looksLikeRefusal('I cannot create this image as it violates the content policy.')).toBe(true)
    expect(looksLikeRefusal('As an AI, I am unable to assist with this request.')).toBe(true)
  })

  it('does not flag a normal optimized image prompt', () => {
    expect(
      looksLikeRefusal(
        'A Shenzhen street on a bright summer afternoon, lush green roadside trees, tall glass skyscrapers, warm golden sunlight, gentle sea breeze, natural lifelike scene'
      )
    ).toBe(false)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadImageStudioService() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const { imageGenerationRepo } = await import('../db/repositories/image-generation.repo')
  const service = await import('./image-studio.service') as any
  return { client, imageGenerationRepo, service }
}

describe('Image Studio service session, history, templates, and media use cases', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-image-studio-service-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates, updates, lists, and archives image sessions through the service', async () => {
    const { service } = await loadImageStudioService()
    const created = service.createSession({ title: 'Service session', default_model: 'agnes-image-2.1-flash' })

    expect(service.listSessions()).toEqual([expect.objectContaining({ id: created.id, title: 'Service session' })])
    expect(service.updateSession(created.id, { title: 'Renamed' })).toMatchObject({ id: created.id, title: 'Renamed' })

    service.deleteSession(created.id)
    expect(service.listSessions()).toEqual([])
  })

  it('returns session generation history and shared templates through the service', async () => {
    const { imageGenerationRepo, service } = await loadImageStudioService()
    const session = service.createSession({ title: 'History' })
    const generation = imageGenerationRepo.create({
      session_id: session.id,
      prompt: 'A flower',
      provider_id: 'agnes',
      model: 'agnes-image-2.1-flash',
      status: 'completed',
    })

    expect(service.listGenerations(session.id)).toEqual([expect.objectContaining({ id: generation.id, prompt: 'A flower' })])
    expect(service.listTemplates('\u56fd\u98ce')).toEqual([expect.objectContaining({ id: 'ink-landscape', category: '\u56fd\u98ce' })])
  })

  it('reads only safe generated image files with inferred content type and immutable cache metadata', async () => {
    const { imageGenerationRepo, service } = await loadImageStudioService()
    const session = service.createSession({ title: 'Media' })
    const root = path.join(dataDir, 'images')
    const localPath = path.join(root, session.id, 'image.webp')
    fs.mkdirSync(path.dirname(localPath), { recursive: true })
    fs.writeFileSync(localPath, Buffer.from('webp-data'))
    const generation = imageGenerationRepo.create({
      session_id: session.id,
      prompt: 'A flower',
      provider_id: 'agnes',
      model: 'agnes-image-2.1-flash',
      status: 'completed',
      local_path: localPath,
    })

    expect(service.openGeneratedImage(generation.id)).toEqual({
      buffer: Buffer.from('webp-data'),
      contentType: 'image/webp',
      cacheControl: 'private, max-age=31536000, immutable',
    })
  })

  it('does not expose missing or outside-root local image paths', async () => {
    const { imageGenerationRepo, service } = await loadImageStudioService()
    const session = service.createSession({ title: 'Safe paths' })
    const outsidePath = path.join(dataDir, 'outside.png')
    fs.writeFileSync(outsidePath, 'outside')
    const generation = imageGenerationRepo.create({
      session_id: session.id,
      prompt: 'A flower',
      provider_id: 'agnes',
      model: 'agnes-image-2.1-flash',
      status: 'completed',
      local_path: outsidePath,
    })

    expect(() => service.openGeneratedImage('missing')).toThrowError('Image not found')
    expect(() => service.openGeneratedImage(generation.id)).toThrowError('Image not found')
  })
})

  it('validates required generation fields before calling the LLM runtime', async () => {
    const { service } = await loadImageStudioService()

    await expect(service.generateForSession({})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'sessionId, prompt and model are required',
    })
  })

  it('propagates an unsupported image-model failure from the LLM runtime', async () => {
    const unsupported = Object.assign(new Error('Unsupported image model'), { code: 'LLM_UNSUPPORTED_MODEL' })
    vi.doMock('../llm', async () => {
      const actual = await vi.importActual<typeof import('../llm')>('../llm')
      return { ...actual, resolveModel: vi.fn().mockRejectedValue(unsupported) }
    })
    const { service } = await loadImageStudioService()

    await expect(service.generateForSession({ sessionId: 'session-1', prompt: 'A flower', model: 'unknown-image' })).rejects.toBe(unsupported)
  })
