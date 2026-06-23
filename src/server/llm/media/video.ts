import { LlmUnsupportedModelError } from '../errors'
import type { VideoGenerationRequest, VideoTaskResult } from '../types'

export async function createVideoTask(input: VideoGenerationRequest): Promise<VideoTaskResult> {
  throw new LlmUnsupportedModelError(`Video generation is not implemented for model "${input.model}"`)
}

export async function getVideoTask(taskId: string): Promise<VideoTaskResult> {
  throw new LlmUnsupportedModelError(`Video task "${taskId}" is not available in the LLM runtime yet`)
}
