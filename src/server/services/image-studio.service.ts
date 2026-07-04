import fs from 'node:fs'
import path from 'node:path'
import { generateImage, resolveModel, streamChatCompletion } from '../llm'
import { getAspectRatio, getImageStyle, IMAGE_MODEL_CAPS } from '../../shared/image-gen'
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
 * Keep only well-formed reference images (data: or http(s) URLs), cap at 4, and drop them
 * entirely when the model can't do img2img — so an unsupported model never gets an image[]
 * it would reject.
 */
export function sanitizeReferenceImages(model: string, images: unknown): string[] {
  if (IMAGE_MODEL_CAPS[model]?.supportsImg2Img === false) return []
  if (!Array.isArray(images)) return []
  return images
    .filter((x): x is string => typeof x === 'string' && /^(data:image\/|https?:\/\/)/.test(x))
    .slice(0, 4)
}

/**
 * Strip known content-filter-triggering photography/realism terms from LLM-optimized prompts.
 * These terms cause gpt-image-1, Agnes, and similar models to reject prompts for human subjects
 * even when the underlying request is benign.
 */
function sanitizeOptimizedPrompt(text: string): string {
  return text
    // photo/realistic variants → "lifelike"
    .replace(/\b(photorealistic|photo[-\s]realistic|photo[-\s]realism)\b/gi, 'lifelike')
    .replace(/\b(hyper[-\s]?realistic|hyper[-\s]?realism|ultra[-\s]?realistic)\b/gi, 'lifelike')
    .replace(/\b(realistic\s+photograph(?:y|ic)?|realistic\s+photo)\b/gi, 'lifelike scene')
    .replace(/\b(real\s+photograph(?:y|ic)?|real\s+photo)\b/gi, 'vivid scene')
    .replace(/\b(photograph(?:ic|y)?)\b/gi, 'image')
    // camera/equipment terms → strip
    .replace(/\b(RAW\s+photo|raw\s+photograph|shot\s+on\s+\w+|taken\s+with\s+\w+)\b/gi, '')
    .replace(/\b(DSLR|SLR|mirrorless)\s*(camera)?\b/gi, '')
    .replace(/\b\d+mm\s+lens\b/gi, '')
    // resolution / quality buzzwords → strip
    .replace(/\b(\d+[kK](\s*resolution)?|ultra[-\s]?detailed|hyper[-\s]?detailed|insanely\s+detailed)\b/gi, '')
    .replace(/\b(professional\s+photography|studio\s+photography|documentary\s+photography)\b/gi, 'professional lighting')
    // clean up leftover punctuation/whitespace from removed tokens
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Best-effort prompt optimization via the default text model. Expands the user's prompt into
 * a vivid English description, then sanitizes the output to remove terms that trigger content
 * filters in gpt-image-1, Agnes, and similar models. Falls back to the original on any error.
 */
async function optimizePrompt(prompt: string): Promise<string> {
  const model = settingsRepo.getValue('model') || 'claude-3-5-sonnet-20241022'
  const system =
    'You are an expert image-generation prompt engineer. Rewrite the user request into a single, ' +
    'vivid English prompt following: [subject] + [scene/environment] + [art style] + [lighting] + [composition]. ' +
    'When the user asks for a "realistic photo/photograph" or "真实摄影", express that intent using words ' +
    'like "lifelike", "natural", "vivid", "true-to-life" — never use the words: ' +
    'photo, photograph, photographic, photography, photorealistic, realistic photo, ' +
    'hyperrealistic, RAW photo, DSLR, 8k, 4k, ultra-detailed, high resolution, or any camera/lens terms. ' +
    'Keep the user intent. Output ONLY the prompt, no quotes, no preamble.'
  try {
    let text = ''
    for await (const ev of streamChatCompletion({ model, system, messages: [{ role: 'user', content: prompt }], temperature: 0.7 })) {
      if (ev.type === 'delta') text += ev.text
    }
    const trimmed = text.trim()
    return sanitizeOptimizedPrompt(trimmed || prompt)
  } catch (err) {
    console.warn('[optimizePrompt] failed, using original prompt:', err)
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

  const reference = sanitizeReferenceImages(input.model, input.referenceImages)

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
