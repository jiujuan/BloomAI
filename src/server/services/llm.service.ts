import {
  createVideoTask as createRuntimeVideoTask,
  getVideoTask as getRuntimeVideoTask,
  listOllamaRemoteModels as discoverOllamaRemoteModels,
} from '../llm'
import { getSettingValue as readSettingValue } from '../llm/settings'
import type { LlmModality, VideoGenerationRequest, VideoTaskResult } from '../llm/types'
import {
  llmRepo,
  type LlmModelRecord,
  type LlmProviderRecord,
} from '../db/repositories/llm.repo'
import { ServiceError } from './errors'

const MODALITIES = new Set<LlmModality>(['text', 'image', 'video'])
const PROVIDER_KINDS = new Set<LlmProviderRecord['kind']>(['anthropic', 'openai', 'openai-compatible', 'ollama'])
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  agnes: 'AGNES_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}

type LlmRepository = Pick<typeof llmRepo,
  'listProviders' | 'getProvider' | 'createProvider' | 'updateProvider'
  | 'listModels' | 'getModel' | 'createModel' | 'updateModel'
>

export type ProviderSummary = {
  id: string
  name: string
  kind: LlmProviderRecord['kind']
  baseUrl: string | null
  apiKeySettingKey: string | null
  isEnabled: boolean
  config: Record<string, unknown>
  hasApiKey: boolean
}

export type ModelSummary = {
  id: string
  providerId: string
  modelId: string
  label: string
  modality: LlmModality
  capabilities: Record<string, unknown>
  isEnabled: boolean
  isBuiltin: boolean
  sortOrder: number
}

export type CreateProviderInput = {
  id?: unknown
  name?: unknown
  kind?: unknown
  baseUrl?: unknown
  apiKeySettingKey?: unknown
}

export type UpdateProviderInput = {
  name?: unknown
  baseUrl?: unknown
  isEnabled?: unknown
  config?: unknown
}

export type ListModelsInput = { modality?: unknown }

export type CreateModelInput = {
  id?: unknown
  providerId?: unknown
  modelId?: unknown
  label?: unknown
  modality?: unknown
  capabilities?: unknown
  isEnabled?: unknown
  isBuiltin?: unknown
  sortOrder?: unknown
}

export type UpdateModelInput = {
  providerId?: unknown
  modelId?: unknown
  label?: unknown
  modality?: unknown
  capabilities?: unknown
  isEnabled?: unknown
  isBuiltin?: unknown
  sortOrder?: unknown
}

export type CreateVideoTaskInput = VideoGenerationRequest

export type LlmServiceDependencies = {
  repo: LlmRepository
  getSettingValue: (key: string) => string
  env: NodeJS.ProcessEnv
  listOllamaRemoteModels: typeof discoverOllamaRemoteModels
  createVideoTask: typeof createRuntimeVideoTask
  getVideoTask: typeof getRuntimeVideoTask
}

function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readModality(value: unknown): LlmModality | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && MODALITIES.has(value as LlmModality)) return value as LlmModality
  throw new ServiceError('VALIDATION_ERROR', 'Invalid modality')
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * Application boundary for provider, model and video-task management. Runtime
 * errors remain intact so the HTTP adapter can preserve the established LLM
 * error-code contract while this service owns the orchestration itself.
 */
export function createLlmService(overrides: Partial<LlmServiceDependencies> = {}) {
  const dependencies: LlmServiceDependencies = {
    repo: llmRepo,
    getSettingValue: readSettingValue,
    env: process.env,
    listOllamaRemoteModels: discoverOllamaRemoteModels,
    createVideoTask: createRuntimeVideoTask,
    getVideoTask: getRuntimeVideoTask,
    ...overrides,
  }

  const hasApiKey = (provider: LlmProviderRecord): boolean => {
    if (!provider.api_key_setting_key) return false
    if (dependencies.getSettingValue(provider.api_key_setting_key).trim()) return true
    const envKey = PROVIDER_API_KEY_ENV[provider.id]
    return Boolean(envKey && dependencies.env[envKey]?.trim())
  }

  const providerSummary = (provider: LlmProviderRecord): ProviderSummary => ({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.base_url,
    apiKeySettingKey: provider.api_key_setting_key,
    isEnabled: provider.is_enabled === 1,
    config: parseJsonObject(provider.config_json),
    hasApiKey: hasApiKey(provider),
  })

  const modelSummary = (model: LlmModelRecord): ModelSummary => ({
    id: model.id,
    providerId: model.provider_id,
    modelId: model.model_id,
    label: model.label,
    modality: model.modality,
    capabilities: parseJsonObject(model.capabilities_json),
    isEnabled: model.is_enabled === 1,
    isBuiltin: model.is_builtin === 1,
    sortOrder: model.sort_order,
  })

  return {
    listProviders(): ProviderSummary[] {
      return dependencies.repo.listProviders().map(providerSummary)
    },

    createProvider(input: CreateProviderInput): ProviderSummary {
      if (typeof input.id !== 'string' || !input.id || typeof input.name !== 'string' || !input.name || typeof input.kind !== 'string' || !input.kind) {
        throw new ServiceError('VALIDATION_ERROR', 'id, name, and kind are required')
      }
      if (dependencies.repo.getProvider(input.id)) {
        throw new ServiceError('CONFLICT', `Provider "${input.id}" already exists`)
      }
      if (!PROVIDER_KINDS.has(input.kind as LlmProviderRecord['kind'])) {
        throw new ServiceError('VALIDATION_ERROR', 'Invalid kind')
      }

      return providerSummary(dependencies.repo.createProvider({
        id: input.id,
        name: input.name,
        kind: input.kind as LlmProviderRecord['kind'],
        baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : null,
        apiKeySettingKey: typeof input.apiKeySettingKey === 'string' ? input.apiKeySettingKey : null,
      }))
    },

    updateProvider(id: string, input: UpdateProviderInput): ProviderSummary {
      if (!dependencies.repo.getProvider(id)) throw new ServiceError('NOT_FOUND', 'Provider not found')
      const updates: Parameters<LlmRepository['updateProvider']>[1] = {}
      if (typeof input.name === 'string') updates.name = input.name
      if (input.baseUrl === null || typeof input.baseUrl === 'string') updates.baseUrl = input.baseUrl
      if (typeof input.isEnabled === 'boolean') updates.isEnabled = input.isEnabled
      const config = readObject(input.config)
      if (config) updates.config = config
      return providerSummary(dependencies.repo.updateProvider(id, updates)!)
    },

    listModels(input: ListModelsInput = {}): ModelSummary[] {
      const modality = readModality(input.modality)
      return dependencies.repo.listModels({ modality }).map(modelSummary)
    },

    createModel(input: CreateModelInput): ModelSummary {
      if (typeof input.providerId !== 'string' || !input.providerId || typeof input.modelId !== 'string' || !input.modelId || typeof input.label !== 'string' || !input.label || input.modality === undefined || !input.modality) {
        throw new ServiceError('VALIDATION_ERROR', 'providerId, modelId, label, and modality are required')
      }
      const modality = readModality(input.modality)
      if (!modality) throw new ServiceError('VALIDATION_ERROR', 'Invalid modality')

      return modelSummary(dependencies.repo.createModel({
        id: typeof input.id === 'string' ? input.id : input.modelId,
        providerId: input.providerId,
        modelId: input.modelId,
        label: input.label,
        modality,
        capabilities: readObject(input.capabilities) ?? {},
        isEnabled: typeof input.isEnabled === 'boolean' ? input.isEnabled : true,
        isBuiltin: typeof input.isBuiltin === 'boolean' ? input.isBuiltin : false,
        sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : 1000,
      }))
    },

    updateModel(id: string, input: UpdateModelInput): ModelSummary {
      if (!dependencies.repo.getModel(id)) throw new ServiceError('NOT_FOUND', 'Model not found')
      const updates: Parameters<LlmRepository['updateModel']>[1] = {}
      if (typeof input.providerId === 'string') updates.providerId = input.providerId
      if (typeof input.modelId === 'string') updates.modelId = input.modelId
      if (typeof input.label === 'string') updates.label = input.label
      if (input.modality !== undefined) {
        const modality = readModality(input.modality)
        if (!modality) throw new ServiceError('VALIDATION_ERROR', 'Invalid modality')
        updates.modality = modality
      }
      const capabilities = readObject(input.capabilities)
      if (capabilities) updates.capabilities = capabilities
      if (typeof input.isEnabled === 'boolean') updates.isEnabled = input.isEnabled
      if (typeof input.isBuiltin === 'boolean') updates.isBuiltin = input.isBuiltin
      if (typeof input.sortOrder === 'number') updates.sortOrder = input.sortOrder
      return modelSummary(dependencies.repo.updateModel(id, updates)!)
    },

    async listRemoteOllamaModels() {
      return dependencies.listOllamaRemoteModels()
    },

    async createVideoTask(input: CreateVideoTaskInput): Promise<VideoTaskResult> {
      if (typeof input?.model !== 'string' || !input.model || typeof input?.prompt !== 'string' || !input.prompt) {
        throw new ServiceError('VALIDATION_ERROR', 'model and prompt are required')
      }
      return dependencies.createVideoTask(input)
    },

    async getVideoTask(id: string): Promise<VideoTaskResult> {
      return dependencies.getVideoTask(id)
    },
  }
}

export const llmService = createLlmService()