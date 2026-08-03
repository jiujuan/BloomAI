import fs from 'node:fs'
import path from 'node:path'
import { LlmProviderError, LlmResponseParseError } from '../../errors'
import { getProviderApiKey, getProviderBaseUrl } from '../../settings'
import type { ImageGenerationResult, ResolvedImageGenerationRequest } from '../../types'
import type { ImageProviderAdapter } from '../image-adapter-registry'
import { resolvePathWithinAllowedRoots } from '../../../tools/utils/path-policy'
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, normaliseMimeType, readBinaryResponseLimited } from '../../../tools/utils/binary-limit'

type ImageApiResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string }
}

function getImageOutput(data: ImageApiResponse, providerId: string, model: string): ImageGenerationResult {
  if (data.error?.message) throw new LlmProviderError(data.error.message)
  const first = data.data?.[0]
  if (!first?.url && !first?.b64_json) {
    throw new LlmResponseParseError('Image generation response did not include a URL or base64 image')
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
    throw new LlmProviderError(data.error?.message || `Image generation failed with HTTP ${response.status}`)
  }
  return data
}

export async function saveGeneratedImage(
  url: string,
  saveTo: string,
  options: { allowedRoots?: readonly string[]; signal?: AbortSignal } = {},
): Promise<string> {
  const filePath = options.allowedRoots?.length
    ? await resolvePathWithinAllowedRoots(saveTo, {
        allowedRoots: options.allowedRoots,
        access: 'write',
        createParents: true,
      })
    : path.resolve(saveTo)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const requestInit: RequestInit = {}
  if (options.signal) requestInit.signal = options.signal
  const response = await fetch(url, requestInit)
  if (!response.ok) throw new LlmProviderError(`Failed to download generated image: HTTP ${response.status}`)
  const contentType = normaliseMimeType(response.headers.get('content-type'))
  if (contentType && !IMAGE_MIME_TYPES.includes(contentType as typeof IMAGE_MIME_TYPES[number])) {
    throw new LlmProviderError(`Generated image returned unsupported content type: ${contentType}`)
  }
  const limited = await readBinaryResponseLimited(response, MAX_IMAGE_BYTES, options.signal)
  if (limited.truncated) throw new LlmProviderError(`Generated image exceeds the ${MAX_IMAGE_BYTES}-byte limit`)
  fs.writeFileSync(filePath, limited.bytes)
  return filePath
}

/** Adapter for the OpenAI images/generations endpoint (dall-e-3, dall-e-2, gpt-image-1). */
export const openaiImageAdapter: ImageProviderAdapter = {
  async generate(input) {
    const apiKey = getProviderApiKey(input.resolved.provider)
    const baseUrl = getProviderBaseUrl(input.resolved.provider)
    const model = input.resolved.model.modelId
    const isGptImage1 = model === 'gpt-image-1'

    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      n: 1,
      size: input.size || '1024x1024',
    }

    if (isGptImage1) {
      // gpt-image-1 only accepts 'low' | 'medium' | 'high' | 'auto'; no response_format support
      const q = input.quality
      body.quality = (q === 'hd' || q === 'standard' || !q) ? 'medium' : q
      // response_format is intentionally omitted — gpt-image-1 always returns b64_json
    } else {
      // dall-e-3 / dall-e-2
      body.quality = input.quality || 'standard'
      if (input.responseFormat) body.response_format = input.responseFormat
    }

    const requestInit: RequestInit = {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
    if (input.signal) requestInit.signal = input.signal
    const response = await fetch(`${baseUrl}/images/generations`, requestInit)
    const result = getImageOutput(await readImageResponse(response), input.resolved.provider.id, model)
    if (input.saveTo && result.url) {
      result.localPath = await saveGeneratedImage(result.url, input.saveTo, {
        allowedRoots: input.allowedRoots,
        signal: input.signal,
      })
    }
    return result
  },
}
