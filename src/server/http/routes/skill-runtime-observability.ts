import { Hono } from 'hono'
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
    return context.json({ data: await health(context) })
  })

  routes.get('/skill-runtime/diagnostics', async (context) => {
    if (!(await isAdmin(context))) {
      return context.json({ error: { code: 'FORBIDDEN', message: 'Administrator access required' } }, 403)
    }
    return context.json({ data: await diagnostics(context) })
  })

  return routes
}

export const skillRuntimeObservabilityRoutes = createSkillRuntimeObservabilityRoutes()
