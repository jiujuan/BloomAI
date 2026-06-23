import { LlmUnsupportedModelError } from './errors'
import { llmRepo } from '../db/repositories/llm.repo'
import type { LlmModality, LlmModelConfig, LlmProviderConfig, ResolvedLlmModel } from './types'

export async function listProviders(): Promise<LlmProviderConfig[]> {
  return llmRepo.listProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.base_url,
    apiKeySettingKey: provider.api_key_setting_key,
    isEnabled: provider.is_enabled === 1,
    config: JSON.parse(provider.config_json || '{}') as Record<string, unknown>,
  }))
}

export async function listModels(modality?: LlmModality): Promise<LlmModelConfig[]> {
  return llmRepo.listModels({ modality }).map((model) => ({
    id: model.id,
    providerId: model.provider_id,
    modelId: model.model_id,
    label: model.label,
    modality: model.modality,
    capabilities: JSON.parse(model.capabilities_json || '{}') as Record<string, unknown>,
    isEnabled: model.is_enabled === 1,
    isBuiltin: model.is_builtin === 1,
    sortOrder: model.sort_order,
  }))
}

export async function resolveModel(modelId: string, modality: LlmModality): Promise<ResolvedLlmModel> {
  throw new LlmUnsupportedModelError(`LLM model "${modelId}" does not support ${modality} or is not configured`)
}
