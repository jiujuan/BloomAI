import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpErrorHandler } from '../error-mapper'
import { ServiceError } from '../../services/errors'

const llmServiceMock = vi.hoisted(() => ({
  listProviders: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  listModels: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  listRemoteOllamaModels: vi.fn(),
  createVideoTask: vi.fn(),
  getVideoTask: vi.fn(),
}))

vi.mock('../../services/llm.service', () => ({ llmService: llmServiceMock }))

import { llmRoutes } from './llm'

function createApp() {
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  return app.route('/llm', llmRoutes)
}

describe('LLM route contract', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    llmServiceMock.createProvider.mockImplementation((input: any) => {
      if (!input.id || !input.name || !input.kind) throw new ServiceError('VALIDATION_ERROR', 'id, name, and kind are required')
      return input
    })
    llmServiceMock.listModels.mockImplementation((input: any) => {
      if (input.modality === 'audio') throw new ServiceError('VALIDATION_ERROR', 'Invalid modality')
      return []
    })
  })

  it('delegates provider creation and keeps the 201 data envelope', async () => {
    llmServiceMock.createProvider.mockReturnValue({
      id: 'custom',
      name: 'Custom',
      kind: 'openai-compatible',
      baseUrl: null,
      apiKeySettingKey: null,
      isEnabled: true,
      config: {},
      hasApiKey: false,
    })

    const response = await createApp().request('/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'custom', name: 'Custom', kind: 'openai-compatible' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({ id: 'custom', kind: 'openai-compatible', hasApiKey: false }),
    })
    expect(llmServiceMock.createProvider).toHaveBeenCalledWith({ id: 'custom', name: 'Custom', kind: 'openai-compatible' })
  })

  it('keeps validation error envelopes for service validation failures', async () => {
    const modality = await createApp().request('/llm/models?modality=audio')
    const provider = await createApp().request('/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'missing-fields' }),
    })

    expect(modality.status).toBe(400)
    await expect(modality.json()).resolves.toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid modality' } })
    expect(provider.status).toBe(400)
    await expect(provider.json()).resolves.toEqual({ error: { code: 'VALIDATION_ERROR', message: 'id, name, and kind are required' } })
  })

  it('delegates video creation while preserving its response contract', async () => {
    llmServiceMock.createVideoTask.mockResolvedValue({ taskId: 'task-1', status: 'queued', providerId: 'agnes', model: 'video-model' })

    const response = await createApp().request('/llm/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'video-model', prompt: 'make a video' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ data: expect.objectContaining({ taskId: 'task-1', status: 'queued' }) })
    expect(llmServiceMock.createVideoTask).toHaveBeenCalledWith({ model: 'video-model', prompt: 'make a video' })
  })
})