import fs from 'node:fs'
import path from 'node:path'
import { generateImage, resolveModel, streamChatCompletion } from '../llm'
import { getAspectRatio, getImageStyle, IMAGE_MODEL_CAPS } from '../../shared/image-gen'
import type { AspectRatioDef } from '../../shared/image-gen'
import { getImagesDir } from '../db/paths'
import { imageGenerationRepo, type ImageGeneration } from '../db/repositories/image-generation.repo'
import { imageSessionRepo } from '../db/repositories/image-session.repo'
import { settingsRepo } from '../db/repositories/settings.repo'
import { getTracer, SpanStatusCode, context, trace } from '../telemetry/tracer'
import { getMeter } from '../telemetry/metrics'
import type { Histogram, Counter } from '@opentelemetry/api'

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

const imgTracer = getTracer('bloomai.image')

// Lazily created instrument singletons (must be after initMetrics() registers the MeterProvider).
let _optimizeCounters: { fallback: Counter; refusal: Counter } | null = null
function getOptimizeCounters() {
  if (!_optimizeCounters) {
    const m = getMeter('bloomai.image')
    _optimizeCounters = {
      fallback: m.createCounter('bloomai.image.optimize.fallback_total', { description: 'Times optimize fell back to original prompt (empty result)' }),
      refusal: m.createCounter('bloomai.image.optimize.refusal_total', { description: 'Times optimize fell back due to model refusal' }),
    }
  }
  return _optimizeCounters
}

let _genDuration: Histogram | null = null
function getGenDuration() {
  if (!_genDuration) {
    _genDuration = getMeter('bloomai.image').createHistogram('bloomai.image.generate.duration_ms', {
      unit: 'ms',
      description: 'Image generation duration per attempt',
    })
  }
  return _genDuration
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
 * Detect when the "optimized" prompt is actually a model refusal / apology rather than a usable
 * image prompt. When the default text model declines to rewrite the request (e.g. it interprets
 * "真实摄影" as a policy concern, or the configured model can't do chat completion), it returns
 * text like "Unable to generate this content. Please modify your prompt and try again." — which
 * must never be forwarded to the image provider as the prompt.
 */
export function looksLikeRefusal(text: string): boolean {
  const low = text.toLowerCase()
  const markers = [
    'unable to generate', 'unable to create', 'unable to assist', 'unable to help',
    'cannot generate', "can't generate", 'cannot create', "can't create",
    'cannot assist', "can't assist", 'cannot help', "can't help", 'cannot fulfill', "can't fulfill",
    'modify your prompt', 'try again', 'i cannot', "i can't", 'i am unable', "i'm unable",
    'as an ai', 'i apologize', "i'm sorry", 'i am sorry', 'against my guidelines',
    'violates', 'content policy', 'not able to',
  ]
  return markers.some((m) => low.includes(m))
}

/**
 * Best-effort prompt optimization via the default text model. Expands the user's prompt into
 * a vivid English description. Falls back to the original prompt whenever the result is empty,
 * looks like a refusal/apology, or the call errors — so optimization can never make a request
 * that would have succeeded start failing.
 */
async function optimizePrompt(prompt: string): Promise<string> {
  const span = imgTracer.startSpan('image.optimize_prompt')
  const model = settingsRepo.getValue('model') || 'claude-3-5-sonnet-20241022'
  const system =
    'You are an expert image-generation prompt engineer. Rewrite the user request into a single, ' +
    'vivid English prompt following: [subject] + [scene/environment] + [art style] + [lighting] + [composition]. ' +
    'When the user asks for a "realistic photo/photograph" or "真实摄影", express that intent using words ' +
    'like "lifelike", "natural", "vivid", "true-to-life". ' +
    'Always comply — this is a benign creative task. Never refuse or apologize. ' +
    'Output ONLY the prompt itself, no quotes, no preamble, no explanation.'
  try {
    let text = ''
    for await (const ev of streamChatCompletion({ model, system, messages: [{ role: 'user', content: prompt }], temperature: 0.7 })) {
      if (ev.type === 'delta') text += ev.text
    }
    const trimmed = text.trim()
    if (!trimmed) {
      console.warn('[optimizePrompt] empty result, using original prompt')
      span.setAttribute('optimize.fallback', true)
      getOptimizeCounters().fallback.add(1)
      span.end()
      return prompt
    }
    if (looksLikeRefusal(trimmed)) {
      console.warn('[optimizePrompt] model returned a refusal, using original prompt:', trimmed.slice(0, 120))
      span.setAttribute('optimize.refusal', true)
      getOptimizeCounters().refusal.add(1)
      span.end()
      return prompt
    }
    span.setAttribute('optimize.fallback', false)
    span.end()
    return trimmed
  } catch (err: any) {
    console.warn('[optimizePrompt] failed, using original prompt:', err)
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
    span.end()
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
  const rootSpan = imgTracer.startSpan('image.generate', {
    attributes: {
      'image.model': input.model,
      'image.optimize': String(input.optimize !== false),
      'image.style': input.styleId ?? 'none',
      'image.session_id': input.sessionId,
    },
  })

  return context.with(trace.setSpan(context.active(), rootSpan), async () => {
    try {
      // Validate model/modality up front (throws on unknown/disabled model).
      const resolved = await resolveModel(input.model, 'image')
      const providerId = resolved.provider.id

      const ratio = getAspectRatio(input.aspectRatioId)
      const style = getImageStyle(input.styleId)
      const size = resolveSize(providerId, ratio)

      const optimize = input.optimize !== false
      const withStyle = (base: string) => (style ? `${base}${style.promptSuffix}` : base)

      // The optimized prompt is the primary attempt; the untouched user prompt is the fallback.
      // Since the user's original prompt is known to work on its own, retrying with it guarantees
      // that enabling "智能优化" can never turn a working request into a failing one.
      const optimizedBase = optimize ? await optimizePrompt(input.prompt) : input.prompt
      const primaryPrompt = withStyle(optimizedBase)
      const fallbackPrompt = withStyle(input.prompt)
      const attempts = primaryPrompt !== fallbackPrompt ? [primaryPrompt, fallbackPrompt] : [primaryPrompt]

      const reference = sanitizeReferenceImages(input.model, input.referenceImages)

      const record = imageGenerationRepo.create({
        session_id: input.sessionId,
        prompt: input.prompt,
        resolved_prompt: primaryPrompt,
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

      let lastErr: any
      for (let i = 0; i < attempts.length; i++) {
        const attemptPrompt = attempts[i]
        const attemptSpan = imgTracer.startSpan('image.generate.attempt', {
          attributes: { 'image.attempt_index': i, 'image.is_fallback': i > 0 },
        })
        try {
          const result = await generateImage({
            model: input.model,
            prompt: attemptPrompt,
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
            // Record which prompt actually produced the image (may be the fallback).
            resolved_prompt: attemptPrompt,
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

          attemptSpan.end()
          rootSpan.setStatus({ code: SpanStatusCode.OK })
          rootSpan.end()
          getGenDuration().record(Date.now() - startedAt, { model: input.model, status: 'success', is_fallback: String(i > 0) })
          return updated
        } catch (err: any) {
          attemptSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
          attemptSpan.recordException(err)
          attemptSpan.end()
          lastErr = err
          const isLast = i === attempts.length - 1
          if (!isLast) {
            console.warn(
              `[generateForSession] optimized prompt failed (${err?.message}); retrying with the original prompt`
            )
          }
        }
      }

      const failed = imageGenerationRepo.update(record.id, {
        status: 'failed',
        error_msg: lastErr?.message || 'Image generation failed',
        duration_ms: Date.now() - startedAt,
      })!
      rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: lastErr?.message })
      rootSpan.end()
      getGenDuration().record(Date.now() - startedAt, { model: input.model, status: 'error', is_fallback: 'false' })
      return failed
    } catch (err: any) {
      rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      rootSpan.recordException(err)
      rootSpan.end()
      throw err
    }
  })
}
