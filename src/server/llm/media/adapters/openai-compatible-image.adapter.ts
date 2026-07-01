import { LlmProviderError, LlmResponseParseError } from '../../errors'
import { getProviderApiKey, getProviderBaseUrl } from '../../settings'
import type { ImageGenerationResult, ResolvedImageGenerationRequest } from '../../types'
import type { ImageProviderAdapter } from '../image-adapter-registry'
import { saveGeneratedImage } from './openai.adapter'

type ImageApiResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string; code?: string }
}

async function readResponse(response: Response): Promise<ImageApiResponse> {
  const data = (await response.json()) as ImageApiResponse
  if (!response.ok) {
    throw new LlmProviderError(data.error?.message || `Image generation failed with HTTP ${response.status}`)
  }
  return data
}

/**
 * Generic adapter for any OpenAI-compatible images/generations endpoint.
 * Used by Together.ai (Flux), DashScope (Qwen), Google Generative AI (Imagen).
 *
 * Maps the standardized `ImageGenerationRequest` to the OpenAI images API body.
 * Providers that require additional params can extend this via capabilities_json.
 */
export const openaiCompatibleImageAdapter: ImageProviderAdapter = {
  async generate(input: ResolvedImageGenerationRequest): Promise<ImageGenerationResult> {
    const apiKey = getProviderApiKey(input.resolved.provider)
    const baseUrl = getProviderBaseUrl(input.resolved.provider)
    const model = input.resolved.model.modelId

    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      n: 1,
    }
    if (input.size) body.size = input.size
    if (input.quality) body.quality = input.quality
    if (input.responseFormat) body.response_format = input.responseFormat
    if (input.seed != null) body.seed = input.seed

    // Some providers accept negative_prompt as a top-level field
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt

    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await readResponse(response)
    const first = data.data?.[0]
    if (!first?.url && !first?.b64_json) {
      throw new LlmResponseParseError('Image generation response did not include a URL or base64 image')
    }
    const result: ImageGenerationResult = {
      providerId: input.resolved.provider.id,
      model,
      ...(first.url ? { url: first.url } : {}),
      ...(first.b64_json ? { b64_json: first.b64_json } : {}),
    }
    if (input.saveTo && result.url) result.localPath = await saveGeneratedImage(result.url, input.saveTo)
    return result
  },
}
