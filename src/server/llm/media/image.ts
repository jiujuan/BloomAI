import { LlmUnsupportedModelError } from '../errors'
import type { ImageGenerationRequest, ImageGenerationResult } from '../types'

export async function generateImage(input: ImageGenerationRequest): Promise<ImageGenerationResult> {
  throw new LlmUnsupportedModelError(`Image generation is not implemented for model "${input.model}"`)
}
