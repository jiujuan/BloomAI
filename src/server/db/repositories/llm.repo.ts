import { and, asc, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { LlmModality } from '../../llm/types'
import { getOrmDb } from '../client'
import { llm_models, llm_providers, llm_video_tasks } from '../schema'

export interface LlmProviderRecord {
  id: string
  name: string
  kind: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama'
  base_url: string | null
  api_key_setting_key: string | null
  is_enabled: number
  config_json: string
  created_at: number
  updated_at: number
}

export interface LlmModelRecord {
  id: string
  provider_id: string
  model_id: string
  label: string
  modality: LlmModality
  capabilities_json: string
  is_enabled: number
  is_builtin: number
  sort_order: number
  created_at: number
  updated_at: number
}

export interface LlmVideoTaskRecord {
  id: string
  provider_id: string
  model: string
  provider_task_id: string | null
  provider_video_id: string | null
  input_json: string
  output_json: string | null
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  progress: number | null
  error_msg: string | null
  created_at: number
  updated_at: number
}

export interface LlmProviderUpdate {
  name: string
  kind: LlmProviderRecord['kind']
  baseUrl: string | null
  apiKeySettingKey: string | null
  isEnabled: boolean
  config: Record<string, unknown>
}

export interface CreateLlmModelInput {
  id?: string
  providerId: string
  modelId: string
  label: string
  modality: LlmModality
  capabilities?: Record<string, unknown>
  isEnabled?: boolean
  isBuiltin?: boolean
  sortOrder?: number
}

export interface UpdateLlmModelInput {
  providerId: string
  modelId: string
  label: string
  modality: LlmModality
  capabilities: Record<string, unknown>
  isEnabled: boolean
  isBuiltin: boolean
  sortOrder: number
}

export interface CreateVideoTaskInput {
  providerId: string
  model: string
  providerTaskId?: string | null
  providerVideoId?: string | null
  input: Record<string, unknown>
  status: LlmVideoTaskRecord['status']
  progress?: number | null
  output?: Record<string, unknown> | null
  error?: string | null
}

export interface UpdateVideoTaskInput {
  providerTaskId: string | null
  providerVideoId: string | null
  output: Record<string, unknown> | null
  status: LlmVideoTaskRecord['status']
  progress: number | null
  error: string | null
}


function encodeJson(value: Record<string, unknown> | null | undefined): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

function modelWhere(filter: { modality?: LlmModality; providerId?: string; enabledOnly?: boolean }) {
  const conditions = []
  if (filter.modality) conditions.push(eq(llm_models.modality, filter.modality))
  if (filter.providerId) conditions.push(eq(llm_models.provider_id, filter.providerId))
  if (filter.enabledOnly) conditions.push(eq(llm_models.is_enabled, 1))
  return conditions.length ? and(...conditions) : undefined
}

export const llmRepo = {
  listProviders(): LlmProviderRecord[] {
    return getOrmDb().select().from(llm_providers).orderBy(asc(llm_providers.name)).all() as LlmProviderRecord[]
  },

  getProvider(id: string): LlmProviderRecord | undefined {
    return getOrmDb().select().from(llm_providers).where(eq(llm_providers.id, id)).get() as LlmProviderRecord | undefined
  },

  updateProvider(id: string, data: Partial<LlmProviderUpdate>): LlmProviderRecord | undefined {
    const updates: Partial<typeof llm_providers.$inferInsert> = { updated_at: Date.now() }
    if (data.name !== undefined) updates.name = data.name
    if (data.kind !== undefined) updates.kind = data.kind
    if (data.baseUrl !== undefined) updates.base_url = data.baseUrl
    if (data.apiKeySettingKey !== undefined) updates.api_key_setting_key = data.apiKeySettingKey
    if (data.isEnabled !== undefined) updates.is_enabled = data.isEnabled ? 1 : 0
    if (data.config !== undefined) updates.config_json = JSON.stringify(data.config)

    if (Object.keys(updates).length === 1) return this.getProvider(id)
    getOrmDb().update(llm_providers).set(updates).where(eq(llm_providers.id, id)).run()
    return this.getProvider(id)
  },

  listModels(filter: { modality?: LlmModality; providerId?: string; enabledOnly?: boolean } = {}): LlmModelRecord[] {
    const where = modelWhere(filter)
    const query = getOrmDb().select().from(llm_models)
    return (where ? query.where(where) : query).orderBy(asc(llm_models.sort_order), asc(llm_models.label)).all() as LlmModelRecord[]
  },

  getModel(id: string): LlmModelRecord | undefined {
    return getOrmDb().select().from(llm_models).where(eq(llm_models.id, id)).get() as LlmModelRecord | undefined
  },

  createModel(input: CreateLlmModelInput): LlmModelRecord {
    const id = input.id || input.modelId
    const now = Date.now()
    getOrmDb().insert(llm_models).values({
      id,
      provider_id: input.providerId,
      model_id: input.modelId,
      label: input.label,
      modality: input.modality,
      capabilities_json: JSON.stringify(input.capabilities || {}),
      is_enabled: input.isEnabled === false ? 0 : 1,
      is_builtin: input.isBuiltin === false ? 0 : 1,
      sort_order: input.sortOrder || 0,
      created_at: now,
      updated_at: now,
    }).run()
    return this.getModel(id)!
  },

  updateModel(id: string, data: Partial<UpdateLlmModelInput>): LlmModelRecord | undefined {
    const updates: Partial<typeof llm_models.$inferInsert> = { updated_at: Date.now() }
    if (data.providerId !== undefined) updates.provider_id = data.providerId
    if (data.modelId !== undefined) updates.model_id = data.modelId
    if (data.label !== undefined) updates.label = data.label
    if (data.modality !== undefined) updates.modality = data.modality
    if (data.capabilities !== undefined) updates.capabilities_json = JSON.stringify(data.capabilities)
    if (data.isEnabled !== undefined) updates.is_enabled = data.isEnabled ? 1 : 0
    if (data.isBuiltin !== undefined) updates.is_builtin = data.isBuiltin ? 1 : 0
    if (data.sortOrder !== undefined) updates.sort_order = data.sortOrder

    if (Object.keys(updates).length === 1) return this.getModel(id)
    getOrmDb().update(llm_models).set(updates).where(eq(llm_models.id, id)).run()
    return this.getModel(id)
  },

  createVideoTask(input: CreateVideoTaskInput): LlmVideoTaskRecord {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(llm_video_tasks).values({
      id,
      provider_id: input.providerId,
      model: input.model,
      provider_task_id: input.providerTaskId || null,
      provider_video_id: input.providerVideoId || null,
      input_json: JSON.stringify(input.input),
      output_json: encodeJson(input.output),
      status: input.status,
      progress: input.progress ?? null,
      error_msg: input.error || null,
      created_at: now,
      updated_at: now,
    }).run()
    return this.getVideoTask(id)!
  },

  updateVideoTask(id: string, data: Partial<UpdateVideoTaskInput>): LlmVideoTaskRecord | undefined {
    const updates: Partial<typeof llm_video_tasks.$inferInsert> = { updated_at: Date.now() }
    if (data.providerTaskId !== undefined) updates.provider_task_id = data.providerTaskId
    if (data.providerVideoId !== undefined) updates.provider_video_id = data.providerVideoId
    if (data.output !== undefined) updates.output_json = encodeJson(data.output)
    if (data.status !== undefined) updates.status = data.status
    if (data.progress !== undefined) updates.progress = data.progress
    if (data.error !== undefined) updates.error_msg = data.error

    if (Object.keys(updates).length === 1) return this.getVideoTask(id)
    getOrmDb().update(llm_video_tasks).set(updates).where(eq(llm_video_tasks.id, id)).run()
    return this.getVideoTask(id)
  },

  getVideoTask(id: string): LlmVideoTaskRecord | undefined {
    return getOrmDb().select().from(llm_video_tasks).where(eq(llm_video_tasks.id, id)).get() as LlmVideoTaskRecord | undefined
  },

  listSettingKeys(): string[] {
    const rows = getOrmDb().all<{ key: string }>(sql`SELECT key FROM settings ORDER BY key`)
    return rows.map((row) => row.key)
  },

  importOllamaModel(modelName: string): LlmModelRecord {
    const existing = this.getModel(modelName)
    if (existing) {
      return this.updateModel(modelName, {
        providerId: 'ollama',
        modelId: modelName,
        label: modelName,
        modality: 'text',
        capabilities: {},
        isEnabled: true,
        isBuiltin: false,
        sortOrder: existing.sort_order,
      })!
    }

    return this.createModel({
      id: modelName,
      providerId: 'ollama',
      modelId: modelName,
      label: modelName,
      modality: 'text',
      capabilities: {},
      isEnabled: true,
      isBuiltin: false,
      sortOrder: 1000,
    })
  },
}

export function importOllamaModel(modelName: string): LlmModelRecord {
  return llmRepo.importOllamaModel(modelName)
}
