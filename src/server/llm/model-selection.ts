import type { Persona } from '../db/repositories/persona.repo'
import { settingsRepo } from '../db/repositories/settings.repo'
import { resolveModel } from './registry'
import type { LlmModality, ResolvedLlmModel } from './types'

export type ModelConsumer = 'chat' | 'agent' | 'tool' | 'workflow'
export type RuntimeModelSource = 'requested' | 'persona' | 'session' | 'settings' | 'fallback'

export type ResolveRuntimeModelInput = {
  consumer: ModelConsumer
  modality: LlmModality
  requestedModel?: string
  persona?: Persona | null
  sessionModel?: string
  settingsModel?: string
  settingsKey?: string
}

export type ResolvedRuntimeModel = {
  selectedModelId: string
  source: RuntimeModelSource
  resolved: ResolvedLlmModel
}

export const FALLBACK_CHAT_MODEL = 'claude-3-5-sonnet-20241022'

const LEGACY_BUILTIN_PERSONA_MODELS = new Set([
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
])

export function getPersonaModelOverride(persona: Persona | null | undefined): string {
  const override = persona?.model_override || ''
  if (!override) return ''
  if (persona?.is_builtin && LEGACY_BUILTIN_PERSONA_MODELS.has(override)) return ''
  return override
}

export function getSessionModelOverride(sessionModel: string | null | undefined): string {
  if (!sessionModel) return ''
  if (sessionModel === FALLBACK_CHAT_MODEL) return ''
  return sessionModel
}

export function selectRuntimeModel(input: ResolveRuntimeModelInput): { selectedModelId: string; source: RuntimeModelSource } {
  const requestedModel = input.requestedModel || ''
  if (requestedModel) return { selectedModelId: requestedModel, source: 'requested' }

  const personaModel = getPersonaModelOverride(input.persona)
  if (personaModel) return { selectedModelId: personaModel, source: 'persona' }

  const sessionModel = getSessionModelOverride(input.sessionModel)
  if (sessionModel) return { selectedModelId: sessionModel, source: 'session' }

  const settingsModel = input.settingsModel ?? settingsRepo.getValue(input.settingsKey || 'model') ?? ''
  if (settingsModel) return { selectedModelId: settingsModel, source: 'settings' }

  return { selectedModelId: input.sessionModel || FALLBACK_CHAT_MODEL, source: 'fallback' }
}

export async function resolveRuntimeModel(input: ResolveRuntimeModelInput): Promise<ResolvedRuntimeModel> {
  const selection = selectRuntimeModel(input)
  return {
    ...selection,
    resolved: await resolveModel(selection.selectedModelId, input.modality),
  }
}

export function resolveChatModel(persona: Persona | null, sessionModel: string, settingsModel: string): string {
  return selectRuntimeModel({
    consumer: 'chat',
    modality: 'text',
    persona,
    sessionModel,
    settingsModel,
  }).selectedModelId
}

export function toMastraModelId(resolved: ResolvedLlmModel): string {
  const modelId = resolved.model.modelId
  if (modelId.includes('/')) return modelId
  return resolved.provider.id + '/' + modelId
}
