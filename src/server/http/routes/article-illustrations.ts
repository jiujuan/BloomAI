import { Hono } from 'hono'
import { z } from 'zod'
import { ArticleSourceError } from '../../skills/article-illustrations/article-source'
import { articleIllustrationService } from '../../skills/article-illustrations/article-illustration.service'
import { readJson } from '../util'

const sourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string(), title: z.string().optional() }),
  z.object({ type: z.literal('url'), url: z.string().url(), consent: z.boolean(), title: z.string().optional() }),
  z.object({ type: z.literal('file'), filePath: z.string(), fileName: z.string() }),
])
const configSchema = z.record(z.unknown()).default({})
const planSchema = z.object({ source: sourceSchema, mode: z.enum(['skill', 'fallback']), skillVersionId: z.string().optional(), config: configSchema })
const sceneSchema = z.object({ ordinal: z.number().int().min(1), title: z.string().min(1).max(300), excerpt: z.string().max(2000), prompt: z.string().min(1).max(6000) })

export const articleIllustrationRoutes = new Hono()
articleIllustrationRoutes.get('/article-illustrations/eligible-skills', (c) => c.json({ data: articleIllustrationService.listEligibleSkills() }))
articleIllustrationRoutes.get('/article-illustrations/recoverable', (c) => c.json({ data: articleIllustrationService.listRecoverable() }))
articleIllustrationRoutes.get('/article-illustrations/:id/export', (c) => {
  const markdown = articleIllustrationService.exportMarkdown(c.req.param('id'))
  return markdown === undefined ? c.json({ error: { code: 'NOT_FOUND', message: 'Article illustration job not found' } }, 404) : c.json({ data: { markdown } })
})
articleIllustrationRoutes.get('/article-illustrations/:id', (c) => {
  const job = articleIllustrationService.getJob(c.req.param('id'))
  return job ? c.json({ data: job }) : c.json({ error: { code: 'NOT_FOUND', message: 'Article illustration job not found' } }, 404)
})
articleIllustrationRoutes.post('/article-illustrations/plans', async (c) => {
  try {
    const body = planSchema.parse(await readJson(c))
    const job = await articleIllustrationService.createPlan(body)
    return c.json({ data: job }, 201)
  } catch (error) { return sourceOrValidationError(c, error) }
})
articleIllustrationRoutes.put('/article-illustrations/:id/scenes', async (c) => {
  try {
    const scenes = z.array(sceneSchema).max(12).parse((await readJson<any>(c)).scenes)
    const data = articleIllustrationService.replacePlan(c.req.param('id'), scenes)
    return data ? c.json({ data }) : c.json({ error: { code: 'NOT_FOUND', message: 'Article illustration job not found' } }, 404)
  } catch (error) { return sourceOrValidationError(c, error) }
})
articleIllustrationRoutes.patch('/article-illustrations/:id/scenes/:sceneId', async (c) => {
  try {
    const patch = sceneSchema.partial().parse(await readJson(c))
    const data = articleIllustrationService.updateScene(c.req.param('id'), c.req.param('sceneId'), patch)
    return data ? c.json({ data }) : c.json({ error: { code: 'NOT_FOUND', message: 'Article illustration scene not found' } }, 404)
  } catch (error) { return sourceOrValidationError(c, error) }
})
articleIllustrationRoutes.post('/article-illustrations/:id/confirm', async (c) => {
  try {
    const data = await articleIllustrationService.confirmPlan(c.req.param('id'))
    return data ? c.json({ data }) : c.json({ error: { code: 'NOT_FOUND', message: 'Article illustration job not found' } }, 404)
  } catch (error) { return sourceOrValidationError(c, error) }
})
articleIllustrationRoutes.post('/article-illustrations/:id/scenes/:sceneId/retry', async (c) => {
  const data = await articleIllustrationService.retryScene(c.req.param('id'), c.req.param('sceneId'))
  return data ? c.json({ data }) : c.json({ error: { code: 'NOT_FOUND', message: 'Article illustration scene not found' } }, 404)
})
articleIllustrationRoutes.post('/article-illustrations/:id/resume', (c) => {
  const data = articleIllustrationService.resume(c.req.param('id'))
  return data ? c.json({ data }) : c.json({ error: { code: 'NOT_FOUND', message: 'Article illustration job not found' } }, 404)
})

function sourceOrValidationError(c: any, error: unknown) {
  if (error instanceof ArticleSourceError) return c.json({ error: { code: error.code, message: error.message, canPasteText: error.code === 'ARTICLE_FETCH_FAILED' || error.code === 'URL_NOT_ALLOWED' } }, 400)
  if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: error.errors[0]?.message || 'Invalid request body' } }, 400)
  const typed = error as { code?: string; message?: string }
  return c.json({ error: { code: typed.code || 'ARTICLE_ILLUSTRATION_ERROR', message: typed.message || 'Article illustration operation failed' } }, 400)
}