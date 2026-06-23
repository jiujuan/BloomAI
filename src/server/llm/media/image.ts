import fs from 'fs'
import os from 'os'
import path from 'path'
import { LlmProviderError, LlmResponseParseError, LlmUnsupportedModelError } from '../errors'
import { resolveModel } from '../registry'
import { getProviderApiKey, getProviderBaseUrl } from '../settings'
import type { ImageGenerationRequest, ImageGenerationResult, ResolvedImageGenerationRequest } from '../types'

export async function generateImage(input: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const resolved = await resolveModel(input.model, 'image')
  const request = { ...input, resolved }

  if (resolved.provider.id === 'openai') {
    return generateOpenAIImage(request)
  }
  if (resolved.provider.id === 'agnes') {
    return generateAgnesImage(request)
  }

  throw new LlmUnsupportedModelError(`Image generation is not implemented for model "${input.model}"`)
}

type ImageApiResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string }
}

function resolveSafePath(filePath: string): string {
  const expanded = filePath.startsWith('~') ? path.join(os.homedir(), filePath.slice(1)) : filePath
  return path.resolve(expanded)
}

function getImageOutput(data: ImageApiResponse, providerId: string, model: string): ImageGenerationResult {
  if (data.error?.message) {
    throw new LlmProviderError(data.error.message)
  }

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
  const data = await response.json() as ImageApiResponse
  if (!response.ok) {
    throw new LlmProviderError(data.error?.message || `Image generation failed with HTTP ${response.status}`)
  }
  return data
}

export async function generateOpenAIImage(input: ResolvedImageGenerationRequest): Promise<ImageGenerationResult> {
  const apiKey = getProviderApiKey(input.resolved.provider)
  const baseUrl = getProviderBaseUrl(input.resolved.provider)
  const model = input.resolved.model.modelId
  const body: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    n: 1,
    size: input.size || '1024x1024',
    quality: input.quality || 'standard',
  }
  if (input.responseFormat) body.response_format = input.responseFormat

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const result = getImageOutput(await readImageResponse(response), input.resolved.provider.id, model)

  if (input.saveTo && result.url) {
    result.localPath = await saveGeneratedImage(result.url, input.saveTo)
  }

  return result
}

export async function generateAgnesImage(input: ResolvedImageGenerationRequest): Promise<ImageGenerationResult> {
  const apiKey = getProviderApiKey(input.resolved.provider)
  const baseUrl = getProviderBaseUrl(input.resolved.provider)
  const model = input.resolved.model.modelId
  const extraBody: Record<string, unknown> = {}
  if (input.responseFormat) extraBody.response_format = input.responseFormat
  if (input.image) extraBody.image = Array.isArray(input.image) ? input.image : [input.image]

  const body: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    n: 1,
  }
  if (input.size) body.size = input.size
  if (input.quality) body.quality = input.quality
  if (Object.keys(extraBody).length) body.extra_body = extraBody

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const result = getImageOutput(await readImageResponse(response), input.resolved.provider.id, model)

  if (input.saveTo && result.url) {
    result.localPath = await saveGeneratedImage(result.url, input.saveTo)
  }

  return result
}

export async function saveGeneratedImage(url: string, saveTo: string): Promise<string> {
  const filePath = resolveSafePath(saveTo)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const response = await fetch(url)
  if (!response.ok) {
    throw new LlmProviderError(`Failed to download generated image: HTTP ${response.status}`)
  }

  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  return filePath
}
