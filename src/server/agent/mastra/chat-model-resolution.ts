import type { Persona } from '../../db/repositories/persona.repo'

const FALLBACK_CHAT_MODEL = 'claude-3-5-sonnet-20241022'
const LEGACY_BUILTIN_PERSONA_MODELS = new Set([
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
])

export function getPersonaModelOverride(persona: Persona | null): string {
  const override = persona?.model_override || ''
  if (!override) return ''
  if (persona?.is_builtin && LEGACY_BUILTIN_PERSONA_MODELS.has(override)) return ''
  return override
}

export function getSessionModelOverride(sessionModel: string): string {
  if (!sessionModel) return ''
  if (sessionModel === FALLBACK_CHAT_MODEL) return ''
  return sessionModel
}

export function resolveChatModel(persona: Persona | null, sessionModel: string, settingsModel: string): string {
  return getPersonaModelOverride(persona) || getSessionModelOverride(sessionModel) || settingsModel || sessionModel || FALLBACK_CHAT_MODEL
}
