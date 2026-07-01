import { LlmUnsupportedModelError } from '../errors'
import { resolveModel } from '../registry'
import type { ImageGenerationRequest, ImageGenerationResult } from '../types'
import { registerImageAdapter, getImageAdapter } from './image-adapter-registry'
import { openaiImageAdapter, saveGeneratedImage } from './adapters/openai.adapter'
import { agnesImageAdapter } from './adapters/agnes.adapter'
import { openaiCompatibleImageAdapter } from './adapters/openai-compatible-image.adapter'
import { ollamaImageAdapter } from './adapters/ollama-image.adapter'

// Register all image generation adapters.
// To support a new provider, create an adapter implementing ImageProviderAdapter
// and call registerImageAdapter(providerId, adapter) here.
registerImageAdapter('openai', openaiImageAdapter)
registerImageAdapter('agnes', agnesImageAdapter)
registerImageAdapter('together', openaiCompatibleImageAdapter)
registerImageAdapter('qwen', openaiCompatibleImageAdapter)
registerImageAdapter('google', openaiCompatibleImageAdapter)
registerImageAdapter('ollama', ollamaImageAdapter)

export async function generateImage(input: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const resolved = await resolveModel(input.model, 'image')
  let adapter = getImageAdapter(resolved.provider.id)
  // Kind-based fallback for dynamically added providers not in the registry.
  if (!adapter && resolved.provider.kind === 'openai-compatible') adapter = openaiCompatibleImageAdapter
  if (!adapter && resolved.provider.kind === 'ollama') adapter = ollamaImageAdapter
  if (!adapter) {
    throw new LlmUnsupportedModelError(
      `Image generation is not implemented for provider "${resolved.provider.id}" (model "${input.model}")`
    )
  }
  return adapter.generate({ ...input, resolved })
}

// Re-export for callers that still need saveGeneratedImage directly.
export { saveGeneratedImage }

// Legacy function exports kept for image.test.ts compatibility.
import type { ResolvedImageGenerationRequest } from '../types'
export const generateOpenAIImage = (input: ResolvedImageGenerationRequest) => openaiImageAdapter.generate(input)
export const generateAgnesImage = (input: ResolvedImageGenerationRequest) => agnesImageAdapter.generate(input)
