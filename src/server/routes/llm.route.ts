import { Router, Request, Response } from 'express'
import { llmRepo, type LlmModelRecord, type LlmProviderRecord } from '../db/repositories/llm.repo'
import { listOllamaRemoteModels } from '../llm'
import { getSettingValue } from '../llm/settings'
import type { LlmModality } from '../llm'

export const llmRouter = Router()

const MODALITIES = new Set<LlmModality>(['text', 'image', 'video'])
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  agnes: 'AGNES_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}

function validationError(res: Response, message: string) {
  return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } })
}

function parseJsonObject(json: string): Record<string, unknown> {
  return JSON.parse(json || '{}') as Record<string, unknown>
}

function hasApiKey(provider: LlmProviderRecord): boolean {
  if (!provider.api_key_setting_key) return false
  if (getSettingValue(provider.api_key_setting_key).trim()) return true

  const envKey = PROVIDER_API_KEY_ENV[provider.id]
  return Boolean(envKey && process.env[envKey]?.trim())
}

function providerSummary(provider: LlmProviderRecord) {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.base_url,
    isEnabled: provider.is_enabled === 1,
    config: parseJsonObject(provider.config_json),
    hasApiKey: hasApiKey(provider),
  }
}

function modelSummary(model: LlmModelRecord) {
  return {
    id: model.id,
    providerId: model.provider_id,
    modelId: model.model_id,
    label: model.label,
    modality: model.modality,
    capabilities: parseJsonObject(model.capabilities_json),
    isEnabled: model.is_enabled === 1,
    isBuiltin: model.is_builtin === 1,
    sortOrder: model.sort_order,
  }
}

function readModality(value: unknown): LlmModality | undefined | 'invalid' {
  if (value === undefined) return undefined
  return typeof value === 'string' && MODALITIES.has(value as LlmModality) ? value as LlmModality : 'invalid'
}

llmRouter.get('/providers', (_req: Request, res: Response) => {
  res.json({ data: llmRepo.listProviders().map(providerSummary) })
})

llmRouter.patch('/providers/:id', (req: Request, res: Response) => {
  const provider = llmRepo.getProvider(req.params.id)
  if (!provider) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } })

  const updates: Parameters<typeof llmRepo.updateProvider>[1] = {}
  if (typeof req.body.name === 'string') updates.name = req.body.name
  if (req.body.baseUrl === null || typeof req.body.baseUrl === 'string') updates.baseUrl = req.body.baseUrl
  if (typeof req.body.isEnabled === 'boolean') updates.isEnabled = req.body.isEnabled
  if (req.body.config && typeof req.body.config === 'object' && !Array.isArray(req.body.config)) {
    updates.config = req.body.config
  }

  res.json({ data: providerSummary(llmRepo.updateProvider(req.params.id, updates)!) })
})

llmRouter.get('/models', (req: Request, res: Response) => {
  const modality = readModality(req.query.modality)
  if (modality === 'invalid') return validationError(res, 'Invalid modality')

  res.json({ data: llmRepo.listModels({ modality, enabledOnly: true }).map(modelSummary) })
})

llmRouter.post('/models', (req: Request, res: Response) => {
  const modality = readModality(req.body.modality)
  if (!req.body.providerId || !req.body.modelId || !req.body.label || !req.body.modality) {
    return validationError(res, 'providerId, modelId, label, and modality are required')
  }
  if (modality === 'invalid' || modality === undefined) return validationError(res, 'Invalid modality')

  const model = llmRepo.createModel({
    id: typeof req.body.id === 'string' ? req.body.id : req.body.modelId,
    providerId: req.body.providerId,
    modelId: req.body.modelId,
    label: req.body.label,
    modality,
    capabilities: req.body.capabilities && typeof req.body.capabilities === 'object' ? req.body.capabilities : {},
    isEnabled: typeof req.body.isEnabled === 'boolean' ? req.body.isEnabled : true,
    isBuiltin: typeof req.body.isBuiltin === 'boolean' ? req.body.isBuiltin : false,
    sortOrder: typeof req.body.sortOrder === 'number' ? req.body.sortOrder : 1000,
  })

  res.status(201).json({ data: modelSummary(model) })
})

llmRouter.patch('/models/:id', (req: Request, res: Response) => {
  const existing = llmRepo.getModel(req.params.id)
  if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Model not found' } })

  const updates: Parameters<typeof llmRepo.updateModel>[1] = {}
  if (typeof req.body.providerId === 'string') updates.providerId = req.body.providerId
  if (typeof req.body.modelId === 'string') updates.modelId = req.body.modelId
  if (typeof req.body.label === 'string') updates.label = req.body.label
  if (req.body.modality !== undefined) {
    const modality = readModality(req.body.modality)
    if (modality === 'invalid' || modality === undefined) return validationError(res, 'Invalid modality')
    updates.modality = modality
  }
  if (req.body.capabilities && typeof req.body.capabilities === 'object' && !Array.isArray(req.body.capabilities)) {
    updates.capabilities = req.body.capabilities
  }
  if (typeof req.body.isEnabled === 'boolean') updates.isEnabled = req.body.isEnabled
  if (typeof req.body.isBuiltin === 'boolean') updates.isBuiltin = req.body.isBuiltin
  if (typeof req.body.sortOrder === 'number') updates.sortOrder = req.body.sortOrder

  res.json({ data: modelSummary(llmRepo.updateModel(req.params.id, updates)!) })
})

llmRouter.get('/ollama/models', async (_req: Request, res: Response) => {
  try {
    res.json({ data: await listOllamaRemoteModels() })
  } catch (err: any) {
    res.status(500).json({ error: { code: err.code || 'LLM_PROVIDER_ERROR', message: err.message || 'Ollama discovery failed' } })
  }
})
