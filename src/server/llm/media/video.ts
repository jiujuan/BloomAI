import { LlmConfigError, LlmProviderError, LlmResponseParseError, LlmUnsupportedModelError } from '../errors'
import { llmRepo, type LlmProviderRecord, type LlmVideoTaskRecord } from '../../db/repositories/llm.repo'
import { resolveModel } from '../registry'
import { getProviderApiKey, getProviderBaseUrl } from '../settings'
import type { LlmProviderConfig, ResolvedVideoGenerationRequest, VideoGenerationRequest, VideoTaskResult } from '../types'

export async function createVideoTask(input: VideoGenerationRequest): Promise<VideoTaskResult> {
  const resolved = await resolveModel(input.model, 'video')
  const request = { ...input, resolved }

  if (resolved.provider.id === 'agnes') {
    return createAgnesVideoTask(request)
  }

  throw new LlmUnsupportedModelError(`Video generation is not implemented for model "${input.model}"`)
}

export async function getVideoTask(taskId: string): Promise<VideoTaskResult> {
  const task = llmRepo.getVideoTask(taskId)
  if (!task) {
    throw new LlmUnsupportedModelError(`Video task "${taskId}" is not available in the LLM runtime yet`)
  }
  if (task.status === 'completed' || task.status === 'failed') {
    return videoTaskResult(task)
  }
  if (task.provider_id === 'agnes') {
    return getAgnesVideoTask(task)
  }

  throw new LlmUnsupportedModelError(`Video task "${taskId}" is not supported by the LLM runtime yet`)
}

type AgnesVideoResponse = {
  task_id?: string
  taskId?: string
  id?: string
  video_id?: string
  videoId?: string
  status?: string
  progress?: number
  remixed_from_video_id?: string
  url?: string
  video_url?: string
  error?: string
  error_msg?: string
  message?: string
  data?: AgnesVideoResponse
}

function toProviderConfig(provider: LlmProviderRecord): LlmProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.base_url,
    apiKeySettingKey: provider.api_key_setting_key,
    isEnabled: provider.is_enabled === 1,
    config: JSON.parse(provider.config_json || '{}') as Record<string, unknown>,
  }
}

function getAgnesProvider(): LlmProviderConfig {
  const provider = llmRepo.getProvider('agnes')
  if (!provider) throw new LlmConfigError('Agnes provider is not configured')
  if (provider.is_enabled !== 1) throw new LlmConfigError('Agnes provider is disabled')
  return toProviderConfig(provider)
}

function agnesRootUrl(provider: LlmProviderConfig): string {
  return getProviderBaseUrl(provider).replace(/\/v1\/?$/, '')
}

function agnesStatus(status: unknown): VideoTaskResult['status'] {
  if (status === 'queued' || status === 'pending') return 'queued'
  if (status === 'processing' || status === 'running' || status === 'in_progress') return 'in_progress'
  if (status === 'completed' || status === 'complete' || status === 'succeeded' || status === 'success') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  return 'in_progress'
}

function agnesData(response: AgnesVideoResponse): AgnesVideoResponse {
  return response.data || response
}

async function readAgnesResponse(response: Response): Promise<AgnesVideoResponse> {
  const body = await response.json() as AgnesVideoResponse
  if (!response.ok) {
    const data = agnesData(body)
    throw new LlmProviderError(data.error || data.error_msg || data.message || `Agnes video request failed with HTTP ${response.status}`)
  }
  return agnesData(body)
}

function videoTaskResult(task: LlmVideoTaskRecord): VideoTaskResult {
  const output = task.output_json ? JSON.parse(task.output_json) as { url?: string } : {}
  return {
    taskId: task.id,
    ...(task.provider_video_id ? { videoId: task.provider_video_id } : {}),
    providerId: task.provider_id,
    model: task.model,
    status: task.status,
    ...(task.progress !== null ? { progress: task.progress } : {}),
    ...(output.url ? { url: output.url } : {}),
    ...(task.error_msg ? { error: task.error_msg } : {}),
  }
}

function agnesVideoUrl(data: AgnesVideoResponse): string | undefined {
  return data.remixed_from_video_id || data.video_url || data.url
}

function createAgnesBody(input: ResolvedVideoGenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.resolved.model.modelId,
    prompt: input.prompt,
  }
  if (input.image) body.image = Array.isArray(input.image) ? input.image : [input.image]
  if (input.width !== undefined) body.width = input.width
  if (input.height !== undefined) body.height = input.height
  if (input.numFrames !== undefined) body.num_frames = input.numFrames
  if (input.frameRate !== undefined) body.frame_rate = input.frameRate
  if (input.seed !== undefined) body.seed = input.seed
  if (input.negativePrompt !== undefined) body.negative_prompt = input.negativePrompt
  return body
}

export async function createAgnesVideoTask(input: ResolvedVideoGenerationRequest): Promise<VideoTaskResult> {
  const provider = input.resolved.provider
  const response = await fetch(`${getProviderBaseUrl(provider)}/videos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getProviderApiKey(provider)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createAgnesBody(input)),
  })
  const data = await readAgnesResponse(response)
  const providerTaskId = data.task_id || data.taskId || data.id
  const providerVideoId = data.video_id || data.videoId

  if (!providerTaskId && !providerVideoId) {
    throw new LlmResponseParseError('Agnes video create response did not include task_id or video_id')
  }

  const task = llmRepo.createVideoTask({
    providerId: provider.id,
    model: input.resolved.model.modelId,
    providerTaskId: providerTaskId || null,
    providerVideoId: providerVideoId || null,
    input,
    status: agnesStatus(data.status || 'queued'),
    progress: typeof data.progress === 'number' ? data.progress : 0,
    output: null,
  })

  return videoTaskResult(task)
}

export async function getAgnesVideoTask(task: LlmVideoTaskRecord): Promise<VideoTaskResult> {
  if (task.status === 'completed' || task.status === 'failed') {
    return videoTaskResult(task)
  }
  if (!task.provider_video_id) {
    throw new LlmResponseParseError(`Video task "${task.id}" does not have an Agnes video id`)
  }

  const provider = getAgnesProvider()
  const response = await fetch(`${agnesRootUrl(provider)}/agnesapi?video_id=${encodeURIComponent(task.provider_video_id)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getProviderApiKey(provider)}`,
    },
  })
  const data = await readAgnesResponse(response)
  const status = agnesStatus(data.status)
  const progress = typeof data.progress === 'number'
    ? data.progress
    : status === 'completed' || status === 'failed'
      ? 100
      : null
  const url = status === 'completed' ? agnesVideoUrl(data) : undefined
  const error = status === 'failed' ? (data.error || data.error_msg || data.message || 'Agnes video task failed') : null

  const updated = llmRepo.updateVideoTask(task.id, {
    providerTaskId: data.task_id || data.taskId || task.provider_task_id,
    providerVideoId: data.video_id || data.videoId || task.provider_video_id,
    output: url ? { url, raw: data as Record<string, unknown> } : { raw: data as Record<string, unknown> },
    status,
    progress,
    error,
  })

  if (!updated) {
    throw new LlmUnsupportedModelError(`Video task "${task.id}" is not available in the LLM runtime yet`)
  }

  return videoTaskResult(updated)
}
