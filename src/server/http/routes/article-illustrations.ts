import { Hono } from 'hono'
import { z } from 'zod'
import { articleIllustrationService } from '../../services/article-illustration.service'
import { ServiceError } from '../../services/errors'
import { mapErrorToHttpResponse } from '../error-mapper'
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
articleIllustrationRoutes.get('/article-illustrations/eligible-skills', (c) => {
  try { return c.json({ data: articleIllustrationService.listEligibleSkills() }) } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.get('/article-illustrations/recoverable', (c) => {
  try { return c.json({ data: articleIllustrationService.listRecoverable() }) } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.get('/article-illustrations/:id/export', (c) => {
  try { return c.json({ data: { markdown: articleIllustrationService.exportMarkdown(c.req.param('id')) } }) } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.get('/article-illustrations/:id', (c) => {
  try { return c.json({ data: articleIllustrationService.getJob(c.req.param('id')) }) } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.post('/article-illustrations/plans', async (c) => {
  try {
    const body = planSchema.parse(await readJson(c))
    return c.json({ data: await articleIllustrationService.createPlan(body) }, 201)
  } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.put('/article-illustrations/:id/scenes', async (c) => {
  try {
    const scenes = z.array(sceneSchema).max(12).parse((await readJson<any>(c)).scenes)
    return c.json({ data: articleIllustrationService.replacePlan(c.req.param('id'), scenes) })
  } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.patch('/article-illustrations/:id/scenes/:sceneId', async (c) => {
  try {
    const patch = sceneSchema.partial().parse(await readJson(c))
    return c.json({ data: articleIllustrationService.updateScene(c.req.param('id'), c.req.param('sceneId'), patch) })
  } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.post('/article-illustrations/:id/confirm', async (c) => {
  try { return c.json({ data: await articleIllustrationService.confirmPlan(c.req.param('id')) }) } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.post('/article-illustrations/:id/scenes/:sceneId/retry', async (c) => {
  try { return c.json({ data: await articleIllustrationService.retryScene(c.req.param('id'), c.req.param('sceneId')) }) } catch (error) { return articleError(c, error) }
})
articleIllustrationRoutes.post('/article-illustrations/:id/resume', (c) => {
  try { return c.json({ data: articleIllustrationService.resume(c.req.param('id')) }) } catch (error) { return articleError(c, error) }
})

function articleError(c: any, error: unknown) {
  const normalized = error instanceof z.ZodError
    ? new ServiceError('VALIDATION_ERROR', error.errors[0]?.message || 'Invalid request body')
    : error
  const response = mapErrorToHttpResponse(normalized)
  return c.json(response.body, response.status)
}
