import { Hono } from 'hono'
import { llmRepo, type LlmModelRecord, type LlmProviderRecord } from '../../db/repositories/llm.repo'
import { createVideoTask, getVideoTask, listOllamaRemoteModels } from '../../llm'
import { getSettingValue } from '../../llm/settings'
import type { LlmModality } from '../../llm'
import { readJson } from '../util'

export const llmRoutes = new Hono()

const MODALITIES = new Set<LlmModality>(['text', 'image', 'video'])
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  agnes: 'AGNES_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
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
  return typeof value === 'string' && MODALITIES.has(value as LlmModality) ? (value as LlmModality) : 'invalid'
}

llmRoutes.get('/providers', (c) => c.json({ data: llmRepo.listProviders().map(providerSummary) }))

llmRoutes.patch('/providers/:id', async (c) => {
  const provider = llmRepo.getProvider(c.req.param('id'))
  if (!provider) return c.json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404)

  const body = await readJson<any>(c)
  const updates: Parameters<typeof llmRepo.updateProvider>[1] = {}
  if (typeof body.name === 'string') updates.name = body.name
  if (body.baseUrl === null || typeof body.baseUrl === 'string') updates.baseUrl = body.baseUrl
  if (typeof body.isEnabled === 'boolean') updates.isEnabled = body.isEnabled
  if (body.config && typeof body.config === 'object' && !Array.isArray(body.config)) updates.config = body.config

  return c.json({ data: providerSummary(llmRepo.updateProvider(c.req.param('id'), updates)!) })
})

llmRoutes.get('/models', (c) => {
  const modality = readModality(c.req.query('modality'))
  if (modality === 'invalid') return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid modality' } }, 400)
  return c.json({ data: llmRepo.listModels({ modality, enabledOnly: true }).map(modelSummary) })
})

llmRoutes.post('/models', async (c) => {
  const body = await readJson<any>(c)
  const modality = readModality(body.modality)
  if (!body.providerId || !body.modelId || !body.label || !body.modality) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'providerId, modelId, label, and modality are required' } }, 400)
  }
  if (modality === 'invalid' || modality === undefined) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid modality' } }, 400)
  }

  const model = llmRepo.createModel({
    id: typeof body.id === 'string' ? body.id : body.modelId,
    providerId: body.providerId,
    modelId: body.modelId,
    label: body.label,
    modality,
    capabilities: body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : {},
    isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : true,
    isBuiltin: typeof body.isBuiltin === 'boolean' ? body.isBuiltin : false,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 1000,
  })

  return c.json({ data: modelSummary(model) }, 201)
})

llmRoutes.patch('/models/:id', async (c) => {
  const existing = llmRepo.getModel(c.req.param('id'))
  if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: 'Model not found' } }, 404)

  const body = await readJson<any>(c)
  const updates: Parameters<typeof llmRepo.updateModel>[1] = {}
  if (typeof body.providerId === 'string') updates.providerId = body.providerId
  if (typeof body.modelId === 'string') updates.modelId = body.modelId
  if (typeof body.label === 'string') updates.label = body.label
  if (body.modality !== undefined) {
    const modality = readModality(body.modality)
    if (modality === 'invalid' || modality === undefined) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid modality' } }, 400)
    }
    updates.modality = modality
  }
  if (body.capabilities && typeof body.capabilities === 'object' && !Array.isArray(body.capabilities)) updates.capabilities = body.capabilities
  if (typeof body.isEnabled === 'boolean') updates.isEnabled = body.isEnabled
  if (typeof body.isBuiltin === 'boolean') updates.isBuiltin = body.isBuiltin
  if (typeof body.sortOrder === 'number') updates.sortOrder = body.sortOrder

  return c.json({ data: modelSummary(llmRepo.updateModel(c.req.param('id'), updates)!) })
})

llmRoutes.post('/videos', async (c) => {
  const body = await readJson<any>(c)
  if (!body.model || !body.prompt) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'model and prompt are required' } }, 400)
  }
  try {
    const result = await createVideoTask({
      model: body.model,
      prompt: body.prompt,
      image: body.image,
      width: body.width,
      height: body.height,
      numFrames: body.numFrames,
      frameRate: body.frameRate,
      seed: body.seed,
      negativePrompt: body.negativePrompt,
    })
    return c.json({ data: result }, 201)
  } catch (err: any) {
    return c.json({ error: { code: err.code || 'LLM_PROVIDER_ERROR', message: err.message || 'Video task creation failed' } }, 500)
  }
})

llmRoutes.get('/videos/:id', async (c) => {
  try {
    return c.json({ data: await getVideoTask(c.req.param('id')) })
  } catch (err: any) {
    const status = err.code === 'LLM_UNSUPPORTED_MODEL' ? 404 : 500
    return c.json({ error: { code: err.code || 'LLM_PROVIDER_ERROR', message: err.message || 'Video task lookup failed' } }, status)
  }
})

llmRoutes.get('/ollama/models', async (c) => {
  try {
    return c.json({ data: await listOllamaRemoteModels() })
  } catch (err: any) {
    return c.json({ error: { code: err.code || 'LLM_PROVIDER_ERROR', message: err.message || 'Ollama discovery failed' } }, 500)
  }
})
