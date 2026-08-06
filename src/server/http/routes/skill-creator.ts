import { Hono } from 'hono'
import { z } from 'zod'
import { mapErrorToHttpResponse } from '../error-mapper'
import { ServiceError } from '../../services/errors'
import { createSkillDraftService } from '../../skills/creator/skill-draft.service'
import { createSkillDraftSchema, publishSkillDraftSchema, updateSkillDraftSchema } from '../../skills/creator/skill-draft.schema'
import { assertSkillRuntimeFeature } from '../../skills/config/skill-runtime.config'

export const skillCreatorRoutes = new Hono()
const idSchema = z.string().min(1).max(200)
const service = createSkillDraftService()

skillCreatorRoutes.post('/skill-drafts', async (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    const body = createSkillDraftSchema.parse(await c.req.json())
    return c.json({ data: service.createDraft({ ownerId: owner(c), content: body.content, baseVersionId: body.baseVersionId }) }, 201)
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.get('/skill-drafts/:id', (c) => {
  try { assertSkillRuntimeFeature('creatorEnabled'); return c.json({ data: service.getDraft(idSchema.parse(c.req.param('id')), owner(c)) }) } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.patch('/skill-drafts/:id', async (c) => {
  try {
    assertSkillRuntimeFeature('creatorEnabled')
    const body = updateSkillDraftSchema.parse(await c.req.json())
    return c.json({ data: service.updateDraft(idSchema.parse(c.req.param('id')), owner(c), body.patch, body.expectedRevision) })
  } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.delete('/skill-drafts/:id', (c) => {
  try { assertSkillRuntimeFeature('creatorEnabled'); return c.json({ data: service.discardDraft(idSchema.parse(c.req.param('id')), owner(c)) }) } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.post('/skill-drafts/:id/validate', (c) => {
  try { assertSkillRuntimeFeature('creatorEnabled'); return c.json({ data: service.validateDraft(idSchema.parse(c.req.param('id')), owner(c)) }) } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.post('/skill-drafts/:id/preview', (c) => {
  try { assertSkillRuntimeFeature('creatorEnabled'); return c.json({ data: service.previewDraft(idSchema.parse(c.req.param('id')), owner(c)) }) } catch (error) { return errorResponse(c, error) }
})

skillCreatorRoutes.post('/skill-drafts/:id/publish', async (c) => {
  try {
    assertSkillRuntimeFeature('creatorPublishEnabled')
    const body = publishSkillDraftSchema.parse(await c.req.json())
    return c.json({ data: service.publishDraft(idSchema.parse(c.req.param('id')), owner(c), body) }, 201)
  } catch (error) { return errorResponse(c, error) }
})

function owner(c: any): string { return c.req.header('x-bloom-owner')?.trim() || 'local-user' }
function errorResponse(c: any, error: unknown) {
  if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request' } }, 400)
  if (error instanceof Error && (error as any).code === 'FEATURE_DISABLED') return c.json({ error: { code: 'FEATURE_DISABLED', message: error.message } }, 409)
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}
