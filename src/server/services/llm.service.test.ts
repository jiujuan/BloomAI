import { describe, expect, it, vi } from 'vitest'
import type { LlmModelRecord, LlmProviderRecord } from '../db/repositories/llm.repo'
import { ServiceError } from './errors'
import { createLlmService } from './llm.service'

function makeProvider(overrides: Partial<LlmProviderRecord> = {}): LlmProviderRecord {
  return {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key_setting_key: 'openai_api_key',
    is_enabled: 1,
    config_json: '{}',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function makeModel(overrides: Partial<LlmModelRecord> = {}): LlmModelRecord {
  return {
    id: 'gpt-4o',
    provider_id: 'openai',
    model_id: 'gpt-4o',
    label: 'GPT-4o',
    modality: 'text',
    capabilities_json: '{}',
    is_enabled: 1,
    is_builtin: 0,
    sort_order: 1000,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function createRepository(providers: LlmProviderRecord[] = [], models: LlmModelRecord[] = []) {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const modelById = new Map(models.map((model) => [model.id, model]))

  return {
    listProviders: vi.fn(() => [...providerById.values()]),
    getProvider: vi.fn((id: string) => providerById.get(id)),
    createProvider: vi.fn((input: any) => {
      const provider = makeProvider({
        id: input.id,
        name: input.name,
        kind: input.kind,
        base_url: input.baseUrl ?? null,
        api_key_setting_key: input.apiKeySettingKey ?? null,
      })
      providerById.set(provider.id, provider)
      return provider
    }),
    updateProvider: vi.fn((id: string, updates: any) => {
      const current = providerById.get(id)
      if (!current) return undefined
      const updated = makeProvider({
        ...current,
        name: updates.name ?? current.name,
        base_url: updates.baseUrl === undefined ? current.base_url : updates.baseUrl,
        is_enabled: updates.isEnabled === undefined ? current.is_enabled : Number(updates.isEnabled),
        config_json: updates.config === undefined ? current.config_json : JSON.stringify(updates.config),
      })
      providerById.set(id, updated)
      return updated
    }),
    listModels: vi.fn((filter: any = {}) => [...modelById.values()].filter((model) => !filter.modality || model.modality === filter.modality)),
    getModel: vi.fn((id: string) => modelById.get(id)),
    createModel: vi.fn((input: any) => {
      const model = makeModel({
        id: input.id,
        provider_id: input.providerId,
        model_id: input.modelId,
        label: input.label,
        modality: input.modality,
        capabilities_json: JSON.stringify(input.capabilities ?? {}),
        is_enabled: Number(input.isEnabled),
        is_builtin: Number(input.isBuiltin),
        sort_order: input.sortOrder,
      })
      modelById.set(model.id, model)
      return model
    }),
    updateModel: vi.fn((id: string, updates: any) => {
      const current = modelById.get(id)
      if (!current) return undefined
      const updated = makeModel({
        ...current,
        provider_id: updates.providerId ?? current.provider_id,
        model_id: updates.modelId ?? current.model_id,
        label: updates.label ?? current.label,
        modality: updates.modality ?? current.modality,
        capabilities_json: updates.capabilities === undefined ? current.capabilities_json : JSON.stringify(updates.capabilities),
        is_enabled: updates.isEnabled === undefined ? current.is_enabled : Number(updates.isEnabled),
        is_builtin: updates.isBuiltin === undefined ? current.is_builtin : Number(updates.isBuiltin),
        sort_order: updates.sortOrder ?? current.sort_order,
      })
      modelById.set(id, updated)
      return updated
    }),
  }
}

describe('llmService', () => {
  it('rejects duplicate provider ids and unsupported provider kinds', () => {
    const service = createLlmService({ repo: createRepository([makeProvider()]) as any })

    expect(() => service.createProvider({ id: 'openai', name: 'Duplicate', kind: 'openai' })).toThrowError('Provider "openai" already exists')
    expect(() => service.createProvider({ id: 'custom', name: 'Custom', kind: 'invalid' as any })).toThrowError('Invalid kind')

    for (const input of [
      { id: 'openai', name: 'Duplicate', kind: 'openai' },
      { id: 'custom', name: 'Custom', kind: 'invalid' as any },
    ]) {
      try {
        service.createProvider(input)
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError)
        expect(error).toMatchObject({ code: input.id === 'openai' ? 'CONFLICT' : 'VALIDATION_ERROR' })
      }
    }
  })

  it('maps malformed persisted JSON and resolves API-key availability from settings before environment fallback', () => {
    const providers = [
      makeProvider({ id: 'openai', config_json: '{invalid json' }),
      makeProvider({ id: 'anthropic', api_key_setting_key: 'anthropic_api_key' }),
    ]
    const service = createLlmService({
      repo: createRepository(providers) as any,
      getSettingValue: (key) => key === 'openai_api_key' ? 'settings-key' : '',
      env: { ANTHROPIC_API_KEY: 'environment-key' },
    })

    expect(service.listProviders()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai', config: {}, hasApiKey: true }),
      expect.objectContaining({ id: 'anthropic', hasApiKey: true }),
    ]))
  })

  it('validates modalities and reports absent resources with domain errors', () => {
    const service = createLlmService({ repo: createRepository([], [makeModel()]) as any })

    expect(() => service.listModels({ modality: 'audio' as any })).toThrowError('Invalid modality')
    expect(() => service.createModel({ providerId: 'openai', modelId: 'm', label: 'M', modality: 'audio' as any })).toThrowError('Invalid modality')
    expect(() => service.updateProvider('missing', {})).toThrowError('Provider not found')
    expect(() => service.updateModel('missing', {})).toThrowError('Model not found')
  })

  it('delegates Ollama discovery and video task operations while preserving runtime failures', async () => {
    const discoveryFailure = Object.assign(new Error('Ollama is unavailable'), { code: 'LLM_PROVIDER_ERROR' })
    const createVideoTask = vi.fn().mockResolvedValue({ taskId: 'task-1', status: 'queued', providerId: 'agnes', model: 'video-model' })
    const getVideoTask = vi.fn().mockResolvedValue({ taskId: 'task-1', status: 'completed', providerId: 'agnes', model: 'video-model', url: 'https://example.com/video.mp4' })
    const service = createLlmService({
      repo: createRepository() as any,
      listOllamaRemoteModels: vi.fn().mockRejectedValue(discoveryFailure),
      createVideoTask,
      getVideoTask,
    })

    await expect(service.listRemoteOllamaModels()).rejects.toBe(discoveryFailure)
    await expect(service.createVideoTask({} as any)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'model and prompt are required' })
    await expect(service.createVideoTask({ model: 'video-model', prompt: 'make a video' })).resolves.toMatchObject({ taskId: 'task-1', status: 'queued' })
    await expect(service.getVideoTask('task-1')).resolves.toMatchObject({ status: 'completed' })
    expect(createVideoTask).toHaveBeenCalledWith({ model: 'video-model', prompt: 'make a video' })
    expect(getVideoTask).toHaveBeenCalledWith('task-1')
  })
})