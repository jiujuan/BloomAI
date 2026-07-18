import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { MastraModelConfig } from '@mastra/core/llm'
import { resolveRuntimeModel } from '../llm/model-selection'
import { resolveResearchModelSnapshot } from '../deepresearch/domain/model-selection'
import { getProviderApiKey, getProviderBaseUrl } from '../llm/settings'
import { getTracer, SpanStatusCode } from '../telemetry/tracer'
import { getMeter } from '../telemetry/metrics'
import type { Histogram } from '@opentelemetry/api'
import type { ResolvedLlmModel } from '../llm/types'
import type { ResearchModelSelectionSnapshot } from '@shared/deepresearch/contracts'

const tracer = getTracer('bloomai.llm')

let _resolveDuration: Histogram | null = null
function getResolveDuration() {
  if (!_resolveDuration) {
    _resolveDuration = getMeter('bloomai.llm').createHistogram('bloomai.llm.model_resolve.duration_ms', {
      unit: 'ms',
      description: 'Model resolution duration',
    })
  }
  return _resolveDuration
}

/**
 * Bridges BloomAI's provider/model registry to a concrete AI SDK v6 model.
 *
 * We build the AI SDK provider directly per kind instead of passing a bare
 * `provider/model` string, because Mastra's default model gateway treats
 * unknown providers as OpenAI-compatible (it posts to `/chat/completions`),
 * which 404s against Anthropic's `/v1/messages`. Resolving the real provider
 * here keeps anthropic/openai/openai-compatible/ollama all working.
 *
 * Used as the Agent's dynamic `model` so the request-selected model wins per turn.
 */
export async function resolveMastraModel(requestedModel?: string): Promise<MastraModelConfig> {
  const start = Date.now()
  const span = tracer.startSpan('llm.model_resolve', {
    attributes: { 'llm.requested_model': requestedModel ?? 'default' },
  })
  try {
    const { resolved } = await resolveRuntimeModel({
      consumer: 'agent',
      modality: 'text',
      requestedModel,
    })
    span.setAttributes({
      'llm.provider': resolved.provider.id,
      'llm.provider_kind': resolved.provider.kind,
      'llm.model': resolved.model.modelId,
    })
    getResolveDuration().record(Date.now() - start, {
      provider: resolved.provider.id,
      model: resolved.model.modelId,
      status: 'success',
    })
    return toAiSdkModel(resolved)
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
    span.recordException(err)
    getResolveDuration().record(Date.now() - start, {
      provider: 'unknown',
      model: requestedModel ?? 'default',
      status: 'error',
    })
    throw err
  } finally {
    span.end()
  }
}

/**
 * Builds a Mastra model exclusively from a Deep Research Run's persisted
 * snapshot. This prevents resumed runs from being affected by later changes to
 * the configured default model.
 */
export async function resolveResearchMastraModel(
  snapshot: ResearchModelSelectionSnapshot,
): Promise<MastraModelConfig> {
  const { resolved } = await resolveResearchModelSnapshot(snapshot)
  return toAiSdkModel(resolved)
}

function toAiSdkModel(resolved: ResolvedLlmModel): MastraModelConfig {
  const modelId = resolved.model.modelId
  const apiKey = getProviderApiKey(resolved.provider)
  const baseURL = getProviderBaseUrl(resolved.provider) || undefined

  switch (resolved.provider.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId)
    case 'openai':
      return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId)
    case 'openai-compatible':
    case 'ollama':
      return createOpenAICompatible({
        name: resolved.provider.id,
        apiKey: apiKey || 'not-needed',
        baseURL: baseURL ?? 'http://localhost:11434/v1',
      })(modelId)
    default:
      throw new Error(`Unsupported provider kind: ${resolved.provider.kind}`)
  }
}
