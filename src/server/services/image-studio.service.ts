import fs from 'node:fs'
import path from 'node:path'
import { generateImage, resolveModel, streamChatCompletion } from '../llm'
import { getAspectRatio, getImageStyle } from '../../shared/image-gen'
import type { AspectRatioDef } from '../../shared/image-gen'
import { getImagesDir } from '../db/paths'
import { imageGenerationRepo, type ImageGeneration } from '../db/repositories/image-generation.repo'
import { imageSessionRepo } from '../db/repositories/image-session.repo'
import { settingsRepo } from '../db/repositories/settings.repo'

export interface GenerateForSessionInput {
  sessionId: string
  prompt: string
  model: string
  aspectRatioId?: string
  styleId?: string | null
  referenceImages?: string[]
  negativePrompt?: string
  seed?: number
  optimize?: boolean // default true
}

/** DALL·E 3 only accepts a fixed size set; Agnes-style providers accept arbitrary WxH. */
function resolveSize(providerId: string, ratio: AspectRatioDef | undefined): string | undefined {
  if (!ratio) return undefined
  if (providerId === 'openai') {
    if (ratio.orientation === 'portrait') return '1024x1792'
    if (ratio.orientation === 'landscape') return '1792x1024'
    return '1024x1024'
  }
  return ratio.size
}

/**
 * Best-effort prompt optimization via the default text model. Expands the user's prompt into
 * the recommended [subject]+[scene]+[style]+[light]+[composition]+[quality] structure. Falls
 * back to the original prompt on any error so it never blocks image generation.
 */
async function optimizePrompt(prompt: string): Promise<string> {
  const model = settingsRepo.getValue('model') || 'claude-3-5-sonnet-20241022'
  const system =
    'You are an expert image-generation prompt engineer. Rewrite the user request into a single, ' +
    'vivid English prompt following: [subject] + [scene/environment] + [style] + [lighting] + ' +
    '[composition] + [quality]. Keep the user intent. Output ONLY the prompt, no quotes, no preamble.'
  try {
    let text = ''
    for await (const ev of streamChatCompletion({ model, system, messages: [{ role: 'user', content: prompt }], temperature: 0.7 })) {
      if (ev.type === 'delta') text += ev.text
    }
    const trimmed = text.trim()
    return trimmed || prompt
  } catch {
    return prompt
  }
}

function autoTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  return clean.length > 16 ? clean.slice(0, 16) + '…' : clean || '新画图'
}

function saveBase64(b64: string, filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const data = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
  fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
}

/**
 * Full generate flow: resolve params → (optional) optimize prompt → call provider → persist
 * the image locally and the generation record. Returns the final record (status completed or
 * failed) so the caller can render an inline result/error card.
 */
export async function generateForSession(input: GenerateForSessionInput): Promise<ImageGeneration> {
  // Validate model/modality up front (throws on unknown/disabled model).
  const resolved = await resolveModel(input.model, 'image')
  const providerId = resolved.provider.id

  const ratio = getAspectRatio(input.aspectRatioId)
  const style = getImageStyle(input.styleId)
  const size = resolveSize(providerId, ratio)

  const optimize = input.optimize !== false
  const basePrompt = optimize ? await optimizePrompt(input.prompt) : input.prompt
  const resolvedPrompt = style ? `${basePrompt}${style.promptSuffix}` : basePrompt

  const reference = (input.referenceImages || []).filter(Boolean)

  const record = imageGenerationRepo.create({
    session_id: input.sessionId,
    prompt: input.prompt,
    resolved_prompt: resolvedPrompt,
    provider_id: providerId,
    model: input.model,
    aspect_ratio: input.aspectRatioId ?? null,
    style: input.styleId ?? null,
    size: size ?? null,
    seed: input.seed ?? null,
    reference_images: reference.length ? JSON.stringify(reference) : null,
    status: 'in_progress',
  })

  const startedAt = Date.now()
  const saveTo = path.join(getImagesDir(settingsRepo.getValue('image_output_dir')), input.sessionId, `${record.id}.png`)

  try {
    const result = await generateImage({
      model: input.model,
      prompt: resolvedPrompt,
      size,
      image: reference.length ? reference : undefined,
      responseFormat: 'url',
      saveTo,
      seed: input.seed,
      negativePrompt: input.negativePrompt,
    })

    let localPath = result.localPath
    if (!localPath && result.b64_json) {
      saveBase64(result.b64_json, saveTo)
      localPath = saveTo
    }

    const updated = imageGenerationRepo.update(record.id, {
      status: 'completed',
      url: result.url ?? null,
      local_path: localPath ?? null,
      duration_ms: Date.now() - startedAt,
    })!

    // First successful generation names the session.
    const session = imageSessionRepo.get(input.sessionId)
    if (session && (session.title === '新画图' || !session.title)) {
      imageSessionRepo.update(input.sessionId, { title: autoTitle(input.prompt) })
    } else {
      imageSessionRepo.touch(input.sessionId)
    }

    return updated
  } catch (err: any) {
    return imageGenerationRepo.update(record.id, {
      status: 'failed',
      error_msg: err?.message || 'Image generation failed',
      duration_ms: Date.now() - startedAt,
    })!
  }
}
