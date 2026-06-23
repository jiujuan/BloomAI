import { db } from '../client'
import { v4 as uuidv4 } from 'uuid'
import type { LlmModality } from '../../llm/types'

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

export const llmRepo = {
  listProviders(): LlmProviderRecord[] {
    return db.prepare('SELECT * FROM llm_providers ORDER BY name').all() as LlmProviderRecord[]
  },

  getProvider(id: string): LlmProviderRecord | undefined {
    return db.prepare('SELECT * FROM llm_providers WHERE id=?').get(id) as LlmProviderRecord | undefined
  },

  updateProvider(id: string, data: Partial<LlmProviderUpdate>): LlmProviderRecord | undefined {
    const fields: string[] = []
    const values: any[] = []

    if (data.name !== undefined) { fields.push('name=?'); values.push(data.name) }
    if (data.kind !== undefined) { fields.push('kind=?'); values.push(data.kind) }
    if (data.baseUrl !== undefined) { fields.push('base_url=?'); values.push(data.baseUrl) }
    if (data.apiKeySettingKey !== undefined) { fields.push('api_key_setting_key=?'); values.push(data.apiKeySettingKey) }
    if (data.isEnabled !== undefined) { fields.push('is_enabled=?'); values.push(data.isEnabled ? 1 : 0) }
    if (data.config !== undefined) { fields.push('config_json=?'); values.push(JSON.stringify(data.config)) }

    if (!fields.length) return this.getProvider(id)
    values.push(Date.now(), id)
    db.prepare(`UPDATE llm_providers SET ${fields.join(',')},updated_at=? WHERE id=?`).run(...values)
    return this.getProvider(id)
  },

  listModels(filter: { modality?: LlmModality; providerId?: string; enabledOnly?: boolean } = {}): LlmModelRecord[] {
    const where: string[] = []
    const values: any[] = []

    if (filter.modality) { where.push('modality=?'); values.push(filter.modality) }
    if (filter.providerId) { where.push('provider_id=?'); values.push(filter.providerId) }
    if (filter.enabledOnly) { where.push('is_enabled=1') }

    const sql = `SELECT * FROM llm_models${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY sort_order, label`
    return db.prepare(sql).all(...values) as LlmModelRecord[]
  },

  getModel(id: string): LlmModelRecord | undefined {
    return db.prepare('SELECT * FROM llm_models WHERE id=?').get(id) as LlmModelRecord | undefined
  },

  createModel(input: CreateLlmModelInput): LlmModelRecord {
    const id = input.id || input.modelId
    const now = Date.now()
    db.prepare(`INSERT INTO llm_models
      (id,provider_id,model_id,label,modality,capabilities_json,is_enabled,is_builtin,sort_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        input.providerId,
        input.modelId,
        input.label,
        input.modality,
        JSON.stringify(input.capabilities || {}),
        input.isEnabled === false ? 0 : 1,
        input.isBuiltin === false ? 0 : 1,
        input.sortOrder || 0,
        now,
        now
      )
    return this.getModel(id)!
  },

  updateModel(id: string, data: Partial<UpdateLlmModelInput>): LlmModelRecord | undefined {
    const fields: string[] = []
    const values: any[] = []

    if (data.providerId !== undefined) { fields.push('provider_id=?'); values.push(data.providerId) }
    if (data.modelId !== undefined) { fields.push('model_id=?'); values.push(data.modelId) }
    if (data.label !== undefined) { fields.push('label=?'); values.push(data.label) }
    if (data.modality !== undefined) { fields.push('modality=?'); values.push(data.modality) }
    if (data.capabilities !== undefined) { fields.push('capabilities_json=?'); values.push(JSON.stringify(data.capabilities)) }
    if (data.isEnabled !== undefined) { fields.push('is_enabled=?'); values.push(data.isEnabled ? 1 : 0) }
    if (data.isBuiltin !== undefined) { fields.push('is_builtin=?'); values.push(data.isBuiltin ? 1 : 0) }
    if (data.sortOrder !== undefined) { fields.push('sort_order=?'); values.push(data.sortOrder) }

    if (!fields.length) return this.getModel(id)
    values.push(Date.now(), id)
    db.prepare(`UPDATE llm_models SET ${fields.join(',')},updated_at=? WHERE id=?`).run(...values)
    return this.getModel(id)
  },

  createVideoTask(input: CreateVideoTaskInput): LlmVideoTaskRecord {
    const id = uuidv4()
    const now = Date.now()
    db.prepare(`INSERT INTO llm_video_tasks
      (id,provider_id,model,provider_task_id,provider_video_id,input_json,output_json,status,progress,error_msg,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        input.providerId,
        input.model,
        input.providerTaskId || null,
        input.providerVideoId || null,
        JSON.stringify(input.input),
        encodeJson(input.output),
        input.status,
        input.progress ?? null,
        input.error || null,
        now,
        now
      )
    return this.getVideoTask(id)!
  },

  updateVideoTask(id: string, data: Partial<UpdateVideoTaskInput>): LlmVideoTaskRecord | undefined {
    const fields: string[] = []
    const values: any[] = []

    if (data.providerTaskId !== undefined) { fields.push('provider_task_id=?'); values.push(data.providerTaskId) }
    if (data.providerVideoId !== undefined) { fields.push('provider_video_id=?'); values.push(data.providerVideoId) }
    if (data.output !== undefined) { fields.push('output_json=?'); values.push(encodeJson(data.output)) }
    if (data.status !== undefined) { fields.push('status=?'); values.push(data.status) }
    if (data.progress !== undefined) { fields.push('progress=?'); values.push(data.progress) }
    if (data.error !== undefined) { fields.push('error_msg=?'); values.push(data.error) }

    if (!fields.length) return this.getVideoTask(id)
    values.push(Date.now(), id)
    db.prepare(`UPDATE llm_video_tasks SET ${fields.join(',')},updated_at=? WHERE id=?`).run(...values)
    return this.getVideoTask(id)
  },

  getVideoTask(id: string): LlmVideoTaskRecord | undefined {
    return db.prepare('SELECT * FROM llm_video_tasks WHERE id=?').get(id) as LlmVideoTaskRecord | undefined
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
