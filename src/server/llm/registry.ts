import { LlmConfigError, LlmUnsupportedModelError } from './errors'
import { llmRepo, type LlmModelRecord, type LlmProviderRecord } from '../db/repositories/llm.repo'
import type { LlmModality, LlmModelConfig, LlmProviderConfig, ResolvedLlmModel } from './types'

function parseConfigJson(json: string): Record<string, unknown> {
  return JSON.parse(json || '{}') as Record<string, unknown>
}

function toProviderConfig(provider: LlmProviderRecord): LlmProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.base_url,
    apiKeySettingKey: provider.api_key_setting_key,
    isEnabled: provider.is_enabled === 1,
    config: parseConfigJson(provider.config_json),
  }
}

function toModelConfig(model: LlmModelRecord): LlmModelConfig {
  return {
    id: model.id,
    providerId: model.provider_id,
    modelId: model.model_id,
    label: model.label,
    modality: model.modality,
    capabilities: parseConfigJson(model.capabilities_json),
    isEnabled: model.is_enabled === 1,
    isBuiltin: model.is_builtin === 1,
    sortOrder: model.sort_order,
  }
}

export async function listProviders(): Promise<LlmProviderConfig[]> {
  return llmRepo.listProviders().map(toProviderConfig)
}

export async function listModels(modality?: LlmModality): Promise<LlmModelConfig[]> {
  return llmRepo.listModels({ modality }).map(toModelConfig)
}

export async function resolveModel(modelId: string, modality: LlmModality): Promise<ResolvedLlmModel> {
  const model = llmRepo.getModel(modelId) || llmRepo.listModels().find((candidate) => candidate.model_id === modelId)
  if (!model) {
    throw new LlmUnsupportedModelError(`LLM model "${modelId}" is not configured`)
  }
  if (model.modality !== modality) {
    throw new LlmUnsupportedModelError(`LLM model "${modelId}" does not support ${modality}`)
  }
  if (model.is_enabled !== 1) {
    throw new LlmConfigError(`LLM model "${modelId}" is disabled`)
  }

  const provider = llmRepo.getProvider(model.provider_id)
  if (!provider) {
    throw new LlmConfigError(`LLM provider "${model.provider_id}" is not configured`)
  }
  if (provider.is_enabled !== 1) {
    throw new LlmConfigError(`LLM provider "${provider.name}" is disabled`)
  }

  return {
    provider: toProviderConfig(provider),
    model: toModelConfig(model),
  }
}
