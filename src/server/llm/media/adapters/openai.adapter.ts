import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { LlmProviderError, LlmResponseParseError } from '../../errors'
import { getProviderApiKey, getProviderBaseUrl } from '../../settings'
import type { ImageGenerationResult, ResolvedImageGenerationRequest } from '../../types'
import type { ImageProviderAdapter } from '../image-adapter-registry'

type ImageApiResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string }
}

function resolveSafePath(filePath: string): string {
  const expanded = filePath.startsWith('~') ? path.join(os.homedir(), filePath.slice(1)) : filePath
  return path.resolve(expanded)
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

export async function saveGeneratedImage(url: string, saveTo: string): Promise<string> {
  const filePath = resolveSafePath(saveTo)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const response = await fetch(url)
  if (!response.ok) throw new LlmProviderError(`Failed to download generated image: HTTP ${response.status}`)
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  return filePath
}

/** Adapter for the OpenAI images/generations endpoint (dall-e-3, dall-e-2). */
export const openaiImageAdapter: ImageProviderAdapter = {
  async generate(input) {
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
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = getImageOutput(await readImageResponse(response), input.resolved.provider.id, model)
    if (input.saveTo && result.url) result.localPath = await saveGeneratedImage(result.url, input.saveTo)
    return result
  },
}
