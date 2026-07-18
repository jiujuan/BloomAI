import { settingsRepo } from '../db/repositories/settings.repo'
import { ServiceError } from './errors'

export const MASKED_SETTING_VALUE = '***masked***'

export type SettingCategory = 'public' | 'secret'

type SettingFieldDefinition = {
  category: SettingCategory
  writable: boolean
}

const PUBLIC_WRITABLE: SettingFieldDefinition = { category: 'public', writable: true }
const SECRET_WRITABLE: SettingFieldDefinition = { category: 'secret', writable: true }

/**
 * The single client-facing classification for configuration fields. It replaces
 * Route-local masked-key lists and limits writes to settings that BloomAI owns.
 */
const SETTING_FIELDS: Readonly<Record<string, SettingFieldDefinition>> = {
  model: PUBLIC_WRITABLE,
  deep_research_model: PUBLIC_WRITABLE,
  theme: PUBLIC_WRITABLE,
  shortcut_overlay: PUBLIC_WRITABLE,
  ollama_base_url: PUBLIC_WRITABLE,
  default_image_model: PUBLIC_WRITABLE,
  default_video_model: PUBLIC_WRITABLE,
  image_output_dir: PUBLIC_WRITABLE,
  clipboard_monitoring: PUBLIC_WRITABLE,
  context_awareness: PUBLIC_WRITABLE,
  onboarding_done: PUBLIC_WRITABLE,
  font_family: PUBLIC_WRITABLE,
  font_size: PUBLIC_WRITABLE,
  anthropic_api_key: SECRET_WRITABLE,
  openai_api_key: SECRET_WRITABLE,
  agnes_api_key: SECRET_WRITABLE,
  deepseek_api_key: SECRET_WRITABLE,
  google_api_key: SECRET_WRITABLE,
  together_api_key: SECRET_WRITABLE,
  qwen_api_key: SECRET_WRITABLE,
}

const CUSTOM_API_KEY_SETTING_PATTERN = /^[a-z][a-z0-9_-]{0,63}_api_key$/

export type ClientSettingsDto = Record<string, string>
export interface ClientSettingDto {
  key: string
  value: string
}
export type UpdateSettingsInput = Record<string, string>
export interface UpdateSettingsResult {
  updated: number
}

function getFieldDefinition(key: string): SettingFieldDefinition | undefined {
  return SETTING_FIELDS[key]
    ?? (CUSTOM_API_KEY_SETTING_PATTERN.test(key) ? SECRET_WRITABLE : undefined)
}

function toClientValue(key: string, value: string): string {
  return getFieldDefinition(key)?.category === 'secret' ? MASKED_SETTING_VALUE : value
}

function requireWritableUpdate(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ServiceError('VALIDATION_ERROR', 'Settings update must be an object')
  }

  const updates: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!getFieldDefinition(key)?.writable) {
      throw new ServiceError('VALIDATION_ERROR', `Setting key is not writable: ${key}`)
    }
    if (typeof value !== 'string') {
      throw new ServiceError('VALIDATION_ERROR', `Setting value must be a string: ${key}`)
    }
    updates[key] = value
  }

  return updates
}

/** Application boundary for safe client settings reads and controlled writes. */
export const settingsService = {
  listForClient(): ClientSettingsDto {
    return Object.fromEntries(
      Object.entries(settingsRepo.list()).map(([key, value]) => [key, toClientValue(key, value)]),
    )
  },

  getForClient(key: string): ClientSettingDto {
    const value = settingsRepo.getValue(key)
    if (value === undefined) throw new ServiceError('NOT_FOUND', 'Setting not found')
    return { key, value: toClientValue(key, value) }
  },

  update(input: UpdateSettingsInput): UpdateSettingsResult {
    const updates = requireWritableUpdate(input)
    return { updated: settingsRepo.setMany(updates) }
  },
}