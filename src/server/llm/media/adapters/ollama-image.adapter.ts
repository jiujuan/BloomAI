import fs from 'node:fs'
import path from 'node:path'
import { LlmProviderError, LlmUnsupportedModelError } from '../../errors'
import { getProviderBaseUrl } from '../../settings'
import type { ImageGenerationResult, ResolvedImageGenerationRequest } from '../../types'
import type { ImageProviderAdapter } from '../image-adapter-registry'
import { resolvePathWithinAllowedRoots } from '../../../tools/utils/path-policy'
import { MAX_IMAGE_BYTES } from '../../../tools/utils/binary-limit'

type OllamaGenerateResponse = {
  response?: string
  images?: string[] // base64 strings, populated by image-generation capable models
  done?: boolean
  error?: string
}

async function saveBase64(
  b64: string,
  filePath: string,
  allowedRoots?: readonly string[],
): Promise<string> {
  const resolvedPath = allowedRoots?.length
    ? await resolvePathWithinAllowedRoots(filePath, {
        allowedRoots,
        access: 'write',
        createParents: true,
      })
    : path.resolve(filePath)
  const data = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
  const decoded = Buffer.from(data, 'base64')
  if (decoded.byteLength > MAX_IMAGE_BYTES) {
    throw new LlmProviderError(`Generated image exceeds the ${MAX_IMAGE_BYTES}-byte limit`)
  }
  const dir = path.dirname(resolvedPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(resolvedPath, decoded)
  return resolvedPath
}

/**
 * Ollama image-generation adapter.
 *
 * Calls POST /api/generate with { model, prompt, stream: false }.
 * Only image-generation capable Ollama models (e.g. sd3.5, sdxl) return `images[]`.
 * If the response contains no images, throws LlmUnsupportedModelError with a helpful message.
 */
export const ollamaImageAdapter: ImageProviderAdapter = {
  async generate(input: ResolvedImageGenerationRequest): Promise<ImageGenerationResult> {
    const baseUrl = getProviderBaseUrl(input.resolved.provider)
    const model = input.resolved.model.modelId

    const body: Record<string, unknown> = { model, prompt: input.prompt, stream: false }
    if (input.image) body.images = Array.isArray(input.image) ? input.image : [input.image]

    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
    if (input.signal) requestInit.signal = input.signal
    const response = await fetch(`${baseUrl}/api/generate`, requestInit)
    if (!response.ok) {
      const text = await response.text().catch(() => `HTTP ${response.status}`)
      throw new LlmProviderError(`Ollama image generation failed: ${text}`)
    }
    const data = (await response.json()) as OllamaGenerateResponse
    if (data.error) throw new LlmProviderError(`Ollama error: ${data.error}`)

    const b64 = data.images?.[0]
    if (!b64) {
      throw new LlmUnsupportedModelError(
        `Ollama model "${model}" did not return an image. Make sure you have pulled a text-to-image model (e.g. ollama pull sd3.5).`
      )
    }

    const result: ImageGenerationResult = {
      providerId: input.resolved.provider.id,
      model,
      b64_json: b64,
    }
    if (input.saveTo) {
      result.localPath = await saveBase64(b64, input.saveTo, input.allowedRoots)
    }
    return result
  },
}
