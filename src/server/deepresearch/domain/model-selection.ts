import { getProviderApiKey, getProviderBaseUrl, getSettingValue } from '../../llm/settings'
import { resolveRuntimeModel } from '../../llm/model-selection'
import type { ResolvedLlmModel } from '../../llm/types'
import type { ResearchModelSelectionSnapshot } from '@shared/deepresearch/contracts'
import { ResearchDomainError } from './errors'

export const RESEARCH_MODEL_CONTRACT_VERSION = 'research-model-selection/v1'

export interface ResolveResearchRuntimeModelInput {
  requestedModelId?: string | null
}

export interface ResolvedResearchRuntimeModel {
  snapshot: ResearchModelSelectionSnapshot
  resolved: ResolvedLlmModel
}

type ResearchModelConfigurationAction = 'configure_model' | 'enable_model' | 'configure_credentials' | 'test_model' | 'restore_model'

function normalizeModelId(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function unavailable(action: ResearchModelConfigurationAction, cause?: unknown): never {
  const message = cause instanceof Error ? cause.message : cause ? String(cause) : 'No enabled text model is configured for Deep Research.'
  throw new ResearchDomainError(
    'RESEARCH_MODEL_UNAVAILABLE',
    'Deep Research requires an enabled, configured text model. ' + message,
    false,
    { action },
  )
}

function repairAction(cause: unknown): ResearchModelConfigurationAction {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/disabled/i.test(message)) return 'enable_model'
  if (/API key/i.test(message) || /Base URL/i.test(message)) return 'configure_credentials'
  if (/not configured|does not support/i.test(message)) return 'configure_model'
  return 'test_model'
}

async function resolveSelectedResearchModel(
  selectedModelId: string,
  snapshot: ResearchModelSelectionSnapshot,
): Promise<ResolvedResearchRuntimeModel> {
  try {
    const { resolved } = await resolveRuntimeModel({
      consumer: 'workflow',
      modality: 'text',
      requestedModel: selectedModelId,
    })
    // Validate the existing provider setting pipeline without storing or exposing secrets.
    getProviderApiKey(resolved.provider)
    getProviderBaseUrl(resolved.provider)
    return { snapshot, resolved }
  } catch (cause) {
    return unavailable(repairAction(cause), cause)
  }
}

export async function resolveResearchRuntimeModel(
  input: ResolveResearchRuntimeModelInput = {},
): Promise<ResolvedResearchRuntimeModel> {
  const requestedModelId = normalizeModelId(input.requestedModelId)
  const dedicatedModelId = normalizeModelId(getSettingValue('deep_research_model'))
  const generalModelId = normalizeModelId(getSettingValue('model'))

  const selection = requestedModelId
    ? { selectedModelId: requestedModelId, selectionSource: 'requested' as const, settingsKey: 'model' as const }
    : dedicatedModelId
      ? { selectedModelId: dedicatedModelId, selectionSource: 'deep_research_setting' as const, settingsKey: 'deep_research_model' as const }
      : generalModelId
        ? { selectedModelId: generalModelId, selectionSource: 'general_setting' as const, settingsKey: 'model' as const }
        : null

  if (!selection) unavailable('configure_model')

  const snapshot: ResearchModelSelectionSnapshot = {
    requestedModelId: requestedModelId || null,
    selectedModelId: selection.selectedModelId,
    providerId: '',
    providerKind: 'openai-compatible',
    selectionSource: selection.selectionSource,
    settingsKey: selection.settingsKey,
    modelContractVersion: RESEARCH_MODEL_CONTRACT_VERSION,
    resolvedAt: Date.now(),
  }
  const resolved = await resolveSelectedResearchModel(selection.selectedModelId, snapshot)
  return {
    ...resolved,
    snapshot: {
      ...snapshot,
      providerId: resolved.resolved.provider.id,
      providerKind: resolved.resolved.provider.kind,
    },
  }
}

/**
 * Reuses only the durable Run snapshot. Current settings are intentionally ignored
 * so a resumed Run cannot silently switch its provider or model.
 */
export async function resolveResearchModelSnapshot(
  snapshot: ResearchModelSelectionSnapshot,
): Promise<ResolvedResearchRuntimeModel> {
  const resolved = await resolveSelectedResearchModel(snapshot.selectedModelId, snapshot)
  if (resolved.resolved.provider.id !== snapshot.providerId || resolved.resolved.provider.kind !== snapshot.providerKind) {
    unavailable('restore_model', new Error('The configured provider no longer matches this Run\'s model snapshot.'))
  }
  return resolved
}
