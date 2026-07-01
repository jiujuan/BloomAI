import { LlmProviderError, LlmResponseParseError } from '../../errors'
import { getProviderApiKey, getProviderBaseUrl } from '../../settings'
import type { ImageGenerationResult, ResolvedImageGenerationRequest } from '../../types'
import type { ImageProviderAdapter } from '../image-adapter-registry'
import { saveGeneratedImage } from './openai.adapter'

type ImageApiResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string }
}

function getImageOutput(data: ImageApiResponse, providerId: string, model: string): ImageGenerationResult {
  if (data.error?.message) throw new LlmProviderError(data.error.message)
  const first = data.data?.[0]
  if (!first?.url && !first?.b64_json) {
    throw new LlmResponseParseError('Agnes image generation response did not include a URL or base64 image')
  }
  return {
    providerId,
    model,
    ...(first.url ? { url: first.url } : {}),
    ...(first.b64_json ? { b64_json: first.b64_json } : {}),
  }
}

async function readImageResponse(response: Response): Promise<ImageApiResponse> {
  const data = (await response.json()) as ImageApiResponse
  if (!response.ok) {
    throw new LlmProviderError(data.error?.message || `Agnes image generation failed with HTTP ${response.status}`)
  }
  return data
}

/** Adapter for the Agnes image API (supports extra_body.image for img2img). */
export const agnesImageAdapter: ImageProviderAdapter = {
  async generate(input) {
    const apiKey = getProviderApiKey(input.resolved.provider)
    const baseUrl = getProviderBaseUrl(input.resolved.provider)
    const model = input.resolved.model.modelId
    const extraBody: Record<string, unknown> = {}
    if (input.responseFormat) extraBody.response_format = input.responseFormat
    if (input.image) extraBody.image = Array.isArray(input.image) ? input.image : [input.image]

    const body: Record<string, unknown> = { model, prompt: input.prompt, n: 1 }
    if (input.size) body.size = input.size
    if (input.quality) body.quality = input.quality
    if (Object.keys(extraBody).length) body.extra_body = extraBody

    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = getImageOutput(await readImageResponse(response), input.resolved.provider.id, model)
    if (input.saveTo && result.url) result.localPath = await saveGeneratedImage(result.url, input.saveTo)
    return result
  },
}
