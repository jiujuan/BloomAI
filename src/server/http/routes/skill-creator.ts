import { Hono } from 'hono'
import { z } from 'zod'
import { mapErrorToHttpResponse } from '../error-mapper'
import { ServiceError } from '../../services/errors'
import { createSkillDraftService } from '../../skills/creator/skill-draft.service'
import { createSkillDraftSchema, publishSkillDraftSchema, updateSkillDraftSchema } from '../../skills/creator/skill-draft.schema'
import { assertSkillRuntimeFeature } from '../../skills/config/skill-runtime.config'
import { getSkillActor } from '../skills-policy'
import { getRequestId } from '../request-context'

export const skillCreatorRoutes = new Hono()
const idSchema = z.string().min(1).max(200)
const draftListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['draft', 'published', 'discarded']).optional(),
}).strict()
const service = createSkillDraftService()

skillCreatorRoutes.post('/skill-drafts', async (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    const actor = requireActor(c)
    const body = createSkillDraftSchema.parse(await c.req.json())
    return c.json({ data: service.createDraft({ ownerId: actor, content: body.content, baseVersionId: body.baseVersionId }) }, 201)
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.get('/skill-drafts', (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    const actor = requireActor(c)
    const query = draftListQuerySchema.parse(c.req.query())
    const page = service.listDrafts(actor, query)
    return c.json({
      data: page.data,
      meta: {
        page: { limit: query.limit, offset: query.offset, total: page.total },
        limit: query.limit,
        offset: query.offset,
        total: page.total,
        hasMore: query.offset + page.data.length < page.total,
        nextOffset: query.offset + page.data.length < page.total ? query.offset + page.data.length : null,
      },
    })
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.get('/skill-drafts/:id', (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    return c.json({ data: service.getDraft(idSchema.parse(c.req.param('id')), requireActor(c)) })
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.patch('/skill-drafts/:id', async (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    const actor = requireActor(c)
    const body = updateSkillDraftSchema.parse(await c.req.json())
    return c.json({ data: service.updateDraft(idSchema.parse(c.req.param('id')), actor, body.patch, body.expectedRevision) })
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.delete('/skill-drafts/:id', (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    return c.json({ data: service.discardDraft(idSchema.parse(c.req.param('id')), requireActor(c)) })
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.post('/skill-drafts/:id/validate', (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    return c.json({ data: service.validateDraft(idSchema.parse(c.req.param('id')), requireActor(c)) })
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.post('/skill-drafts/:id/preview', (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    return c.json({ data: service.previewDraft(idSchema.parse(c.req.param('id')), requireActor(c)) })
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.post('/skill-drafts/:id/publish', async (c) => {
  try {
    assertSkillRuntimeFeature('creatorPublishEnabled')
    const actor = requireActor(c)
    const body = publishSkillDraftSchema.parse(await c.req.json())
    const result = service.publishDraft(idSchema.parse(c.req.param('id')), actor, {
      ...body,
      actor,
      requestId: getRequestId(c),
    })
    return c.json({ data: result }, result.idempotent ? 200 : 201)
  } catch (error) { return errorResponse(c, error) }
})

function requireActor(c: any): string {
  const actor = getSkillActor(c)
  if (!actor) throw new ServiceError('FORBIDDEN', 'Authenticated skill actor is required')
  return actor
}

function errorResponse(c: any, error: unknown) {
  if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request' } }, 400)
  if (error instanceof Error && (error as any).code === 'FEATURE_DISABLED') return c.json({ error: { code: 'FEATURE_DISABLED', message: error.message } }, 409)
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}
