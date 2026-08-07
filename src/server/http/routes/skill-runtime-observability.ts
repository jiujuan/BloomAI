import { Hono } from 'hono'
import { errorResponse } from '../dtos/skill-runtime.error'
import { successResponse } from '../dtos/skill-runtime.response'
import { ServiceError } from '../../services/errors'
import type { Context } from 'hono'
import {
  getRuntimeDiagnostics,
  getRuntimeHealth,
  type RuntimeDiagnosticsSnapshot,
  type RuntimeHealth,
} from '../../skills/observability/skill-runtime.diagnostics'

export type SkillRuntimeObservabilityRouteOptions = {
  health?: (context: Context) => RuntimeHealth | unknown | Promise<RuntimeHealth | unknown>
  diagnostics?: (context: Context) => RuntimeDiagnosticsSnapshot | unknown | Promise<RuntimeDiagnosticsSnapshot | unknown>
  isAdmin?: (context: Context) => boolean | Promise<boolean>
}

function defaultIsAdmin(context: Context): boolean {
  return context.req.header('x-bloom-role')?.trim().toLowerCase() === 'admin'
}

/**
 * Health is intentionally public so process/load balancers can use it for
 * liveness and readiness checks. Diagnostics expose operational state and
 * therefore require an administrator role.
 */
export function createSkillRuntimeObservabilityRoutes(
  options: SkillRuntimeObservabilityRouteOptions = {},
): Hono {
  const routes = new Hono()
  const health = options.health ?? (() => getRuntimeHealth())
  const diagnostics = options.diagnostics ?? (() => getRuntimeDiagnostics())
  const isAdmin = options.isAdmin ?? defaultIsAdmin

  routes.get('/skill-runtime/health', async (context) => {
    try {
      return successResponse(context, await health(context))
    } catch (error) {
      return errorResponse(context, error)
    }
  })

  routes.get('/skill-runtime/diagnostics', async (context) => {
    if (!(await isAdmin(context))) {
      return errorResponse(context, new ServiceError('FORBIDDEN', 'Administrator access required'))
    }
    try {
      return successResponse(context, await diagnostics(context))
    } catch (error) {
      return errorResponse(context, error)
    }
  })

  return routes
}

export const skillRuntimeObservabilityRoutes = createSkillRuntimeObservabilityRoutes()
