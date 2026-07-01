import fs from 'node:fs'
import { Hono } from 'hono'
import { imageSessionRepo } from '../../db/repositories/image-session.repo'
import { imageGenerationRepo } from '../../db/repositories/image-generation.repo'
import { generateForSession } from '../../services/image-studio.service'
import { listTemplatesByCategory } from '../../../shared/image-templates'
import { readJson } from '../util'

/**
 * AI 画图 (Image Studio) routes. Mounted at /api/v1 so it owns /images, /image-sessions,
 * /image-templates and /media/image/:id together.
 */
export const imageStudioRoutes = new Hono()

// --- Sessions ---

imageStudioRoutes.get('/image-sessions', (c) => c.json({ data: imageSessionRepo.list() }))

imageStudioRoutes.post('/image-sessions', async (c) => {
  const body = await readJson<{ title?: string; default_model?: string }>(c)
  return c.json({ data: imageSessionRepo.create(body || {}) }, 201)
})

imageStudioRoutes.patch('/image-sessions/:id', async (c) => {
  const session = imageSessionRepo.update(c.req.param('id'), await readJson(c))
  if (!session) return c.json({ error: { code: 'NOT_FOUND', message: 'Image session not found' } }, 404)
  return c.json({ data: session })
})

imageStudioRoutes.delete('/image-sessions/:id', (c) => {
  imageSessionRepo.delete(c.req.param('id'))
  return c.body(null, 204)
})

imageStudioRoutes.get('/image-sessions/:id/generations', (c) => {
  return c.json({ data: imageGenerationRepo.listBySession(c.req.param('id')) })
})

// --- Templates ---

imageStudioRoutes.get('/image-templates', (c) => {
  return c.json({ data: listTemplatesByCategory(c.req.query('category')) })
})

// --- Generation ---

imageStudioRoutes.post('/images', async (c) => {
  const body = await readJson<any>(c)
  if (!body.sessionId || !body.prompt || !body.model) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'sessionId, prompt and model are required' } }, 400)
  }
  try {
    const record = await generateForSession({
      sessionId: body.sessionId,
      prompt: body.prompt,
      model: body.model,
      aspectRatioId: body.aspectRatioId,
      styleId: body.styleId,
      referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages : undefined,
      negativePrompt: body.negativePrompt,
      seed: typeof body.seed === 'number' ? body.seed : undefined,
      optimize: body.optimize,
    })
    return c.json({ data: record }, 201)
  } catch (err: any) {
    const status = err?.code === 'LLM_UNSUPPORTED_MODEL' ? 400 : 500
    return c.json({ error: { code: err?.code || 'IMAGE_GEN_ERROR', message: err?.message || 'Image generation failed' } }, status)
  }
})

// --- Media (serve locally saved image files) ---

imageStudioRoutes.get('/media/image/:id', (c) => {
  const gen = imageGenerationRepo.get(c.req.param('id'))
  if (!gen?.local_path || !fs.existsSync(gen.local_path)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Image not found' } }, 404)
  }
  const buffer = fs.readFileSync(gen.local_path)
  c.header('Content-Type', 'image/png')
  c.header('Cache-Control', 'private, max-age=31536000, immutable')
  return c.body(buffer)
})
