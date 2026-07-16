import { Hono } from 'hono'
import {
  createSession,
  deleteSession,
  generateForSession,
  listGenerations,
  listSessions,
  listTemplates,
  openGeneratedImage,
  updateSession,
} from '../../services/image-studio.service'
import { isServiceError } from '../../services/errors'
import { readJson } from '../util'

/**
 * AI Image Studio HTTP adapter. Business data access, generation orchestration,
 * and local-file validation live in image-studio.service.
 */
export const imageStudioRoutes = new Hono()

function legacyImageGenerationError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown }
  return {
    code: typeof value?.code === 'string' ? value.code : 'IMAGE_GEN_ERROR',
    message: typeof value?.message === 'string' ? value.message : 'Image generation failed',
  }
}

imageStudioRoutes.get('/image-sessions', (c) => c.json({ data: listSessions() }))

imageStudioRoutes.post('/image-sessions', async (c) => {
  return c.json({ data: createSession((await readJson(c)) || {}) }, 201)
})

imageStudioRoutes.patch('/image-sessions/:id', async (c) => {
  return c.json({ data: updateSession(c.req.param('id'), (await readJson(c)) || {}) })
})

imageStudioRoutes.delete('/image-sessions/:id', (c) => {
  deleteSession(c.req.param('id'))
  return c.body(null, 204)
})

imageStudioRoutes.get('/image-sessions/:id/generations', (c) => {
  return c.json({ data: listGenerations(c.req.param('id')) })
})

imageStudioRoutes.get('/image-templates', (c) => {
  return c.json({ data: listTemplates(c.req.query('category')) })
})

imageStudioRoutes.post('/images', async (c) => {
  try {
    return c.json({ data: await generateForSession((await readJson<any>(c)) || {}) }, 201)
  } catch (error) {
    if (isServiceError(error)) throw error
    const { code, message } = legacyImageGenerationError(error)
    return c.json({ error: { code, message } }, code === 'LLM_UNSUPPORTED_MODEL' ? 400 : 500)
  }
})

imageStudioRoutes.get('/media/image/:id', (c) => {
  const image = openGeneratedImage(c.req.param('id'))
  c.header('Content-Type', image.contentType)
  c.header('Cache-Control', image.cacheControl)
  return c.body(Uint8Array.from(image.buffer))
})