import { LlmUnsupportedModelError } from './errors'
import type { LlmModality, LlmModelConfig, LlmProviderConfig, ResolvedLlmModel } from './types'

export async function listProviders(): Promise<LlmProviderConfig[]> {
  return []
}

export async function listModels(modality?: LlmModality): Promise<LlmModelConfig[]> {
  const models: LlmModelConfig[] = []
  return modality ? models.filter((model) => model.modality === modality) : models
}

export async function resolveModel(modelId: string, modality: LlmModality): Promise<ResolvedLlmModel> {
  throw new LlmUnsupportedModelError(`LLM model "${modelId}" does not support ${modality} or is not configured`)
}
