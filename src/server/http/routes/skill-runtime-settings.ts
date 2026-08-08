import { Hono } from 'hono'
import type { Context } from 'hono'
import { errorResponse } from '../dtos/skill-runtime.error'
import { successResponse } from '../dtos/skill-runtime.response'
import { getSkillActor } from '../skills-policy'
import { getRequestId } from '../request-context'
import { readJson } from '../util'
import { ServiceError } from '../../services/errors'
import { skillRuntimeSettingsService } from '../../services/skill-runtime-settings.service'

export const skillRuntimeSettingsRoutes = new Hono()

function requireActor(context: Context): string {
  const actor = getSkillActor(context)
  if (!actor) throw new ServiceError('FORBIDDEN', 'Authenticated skill actor is required')
  return actor
}

function auditContext(context: Context) {
  return { actor: requireActor(context), requestId: getRequestId(context) }
}

skillRuntimeSettingsRoutes.get('/skill-runtime/settings', (context) => {
  try {
    return successResponse(context, skillRuntimeSettingsService.get())
  } catch (error) {
    return errorResponse(context, error)
  }
})

skillRuntimeSettingsRoutes.patch('/skill-runtime/settings', async (context) => {
  try {
    const result = skillRuntimeSettingsService.update(await readJson(context), auditContext(context))
    return successResponse(context, result)
  } catch (error) {
    return errorResponse(context, error)
  }
})

skillRuntimeSettingsRoutes.post('/skill-runtime/settings/rollback', async (context) => {
  try {
    // Consume an optional body for consistency with clients that always send
    // JSON, but rollback intentionally has no writable input fields.
    await readJson(context)
    const result = skillRuntimeSettingsService.rollback(auditContext(context))
    return successResponse(context, result)
  } catch (error) {
    return errorResponse(context, error)
  }
})

skillRuntimeSettingsRoutes.get('/skill-runtime/feature-flags', (context) => {
  try {
    return successResponse(context, skillRuntimeSettingsService.getFeatureFlags())
  } catch (error) {
    return errorResponse(context, error)
  }
})

skillRuntimeSettingsRoutes.patch('/skill-runtime/feature-flags', async (context) => {
  try {
    const result = skillRuntimeSettingsService.updateFeatureFlags(await readJson(context), auditContext(context))
    return successResponse(context, result)
  } catch (error) {
    return errorResponse(context, error)
  }
})
