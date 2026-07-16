import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpErrorHandler } from '../error-mapper'
import { ServiceError } from '../../services/errors'

const imageStudioServiceMock = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  listGenerations: vi.fn(),
  listTemplates: vi.fn(),
  generateForSession: vi.fn(),
  openGeneratedImage: vi.fn(),
}))

vi.mock('../../services/image-studio.service', () => imageStudioServiceMock)

import { imageStudioRoutes } from './images'

function createApp() {
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  return app.route('/api/v1', imageStudioRoutes)
}

describe('Image Studio route contract', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    imageStudioServiceMock.generateForSession.mockImplementation((input: any) => {
      if (!input.sessionId || !input.prompt || !input.model) {
        throw new ServiceError('VALIDATION_ERROR', 'sessionId, prompt and model are required')
      }
    })
  })

  it('delegates session CRUD and generation history to the service', async () => {
    imageStudioServiceMock.createSession.mockReturnValue({ id: 'session-1', title: 'New image', default_model: 'model', status: 'active' })
    imageStudioServiceMock.listGenerations.mockReturnValue([{ id: 'generation-1', session_id: 'session-1', status: 'completed' }])

    const created = await createApp().request('/api/v1/image-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New image' }),
    })
    const generations = await createApp().request('/api/v1/image-sessions/session-1/generations')

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual({ data: expect.objectContaining({ id: 'session-1' }) })
    expect(imageStudioServiceMock.createSession).toHaveBeenCalledWith({ title: 'New image' })
    await expect(generations.json()).resolves.toEqual({ data: [expect.objectContaining({ id: 'generation-1' })] })
    expect(imageStudioServiceMock.listGenerations).toHaveBeenCalledWith('session-1')
  })

  it('delegates templates and preserves the data envelope', async () => {
    imageStudioServiceMock.listTemplates.mockReturnValue([{ id: 'ink-landscape', category: '\u56fd\u98ce' }])

    const response = await createApp().request('/api/v1/image-templates?category=\u56fd\u98ce')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: [{ id: 'ink-landscape', category: '\u56fd\u98ce' }] })
    expect(imageStudioServiceMock.listTemplates).toHaveBeenCalledWith('\u56fd\u98ce')
  })

  it('keeps validation and unsupported-model image generation error contracts', async () => {
    const validation = await createApp().request('/api/v1/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a flower', model: 'agnes-image-2.1-flash' }),
    })

    imageStudioServiceMock.generateForSession.mockRejectedValueOnce(Object.assign(new Error('Unsupported image model'), { code: 'LLM_UNSUPPORTED_MODEL' }))
    const unsupported = await createApp().request('/api/v1/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', prompt: 'a flower', model: 'unknown-image' }),
    })

    expect(validation.status).toBe(400)
    await expect(validation.json()).resolves.toEqual({ error: { code: 'VALIDATION_ERROR', message: 'sessionId, prompt and model are required' } })
    expect(unsupported.status).toBe(400)
    await expect(unsupported.json()).resolves.toEqual({ error: { code: 'LLM_UNSUPPORTED_MODEL', message: 'Unsupported image model' } })
  })

  it('writes only the service-provided safe image buffer with content and cache headers', async () => {
    imageStudioServiceMock.openGeneratedImage.mockReturnValue({
      buffer: Buffer.from('png-data'),
      contentType: 'image/png',
      cacheControl: 'private, max-age=31536000, immutable',
    })

    const response = await createApp().request('/api/v1/media/image/generation-1')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
    await expect(response.text()).resolves.toBe('png-data')
    expect(imageStudioServiceMock.openGeneratedImage).toHaveBeenCalledWith('generation-1')
  })
})