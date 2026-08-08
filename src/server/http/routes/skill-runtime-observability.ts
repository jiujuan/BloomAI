import { Hono } from 'hono'
import { z } from 'zod'
import { errorResponse } from '../dtos/skill-runtime.error'
import { pageSuccess, successResponse } from '../dtos/skill-runtime.response'
import { ServiceError } from '../../services/errors'
import { createSqliteAuditRepository } from '../../db/repositories/skill-package.repo'
import type { AuditEventSnapshot, AuditQuery, Page } from '../../skills/application/ports'
import type { Context } from 'hono'
import {
  getRuntimeDiagnostics,
  getRuntimeHealth,
  type RuntimeDiagnosticsSnapshot,
  type RuntimeHealth,
} from '../../skills/observability/skill-runtime.diagnostics'

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().trim().min(1).max(200).optional(),
  resourceType: z.string().trim().min(1).max(100).optional(),
  resourceId: z.string().trim().min(1).max(200).optional(),
}).strict()

export type SkillRuntimeObservabilityRouteOptions = {
  health?: (context: Context) => RuntimeHealth | unknown | Promise<RuntimeHealth | unknown>
  diagnostics?: (context: Context) => RuntimeDiagnosticsSnapshot | unknown | Promise<RuntimeDiagnosticsSnapshot | unknown>
  audit?: (context: Context, query: AuditQuery) => Page<AuditEventSnapshot> | Promise<Page<AuditEventSnapshot>>
  isAdmin?: (context: Context) => boolean | Promise<boolean>
}

function defaultIsAdmin(context: Context): boolean {
  return context.req.header('x-bloom-role')?.trim().toLowerCase() === 'admin'
}

/**
 * Health is intentionally public so process/load balancers can use it for
 * liveness and readiness checks. Diagnostics and audit records expose
 * operational state, therefore they require an administrator role.
 */
export function createSkillRuntimeObservabilityRoutes(
  options: SkillRuntimeObservabilityRouteOptions = {},
): Hono {
  const routes = new Hono()
  const health = options.health ?? (() => getRuntimeHealth())
  const diagnostics = options.diagnostics ?? (() => getRuntimeDiagnostics())
  const auditRepository = createSqliteAuditRepository()
  const audit = options.audit ?? ((_context: Context, query: AuditQuery) => auditRepository.list?.(query) ?? { data: [], total: 0 })
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

  routes.get('/skill-runtime/audit', async (context) => {
    if (!(await isAdmin(context))) {
      return errorResponse(context, new ServiceError('FORBIDDEN', 'Administrator access required'))
    }
    try {
      const query = auditQuerySchema.parse(context.req.query())
      const page = await audit(context, query)
      return pageSuccess(context, page.data, query, page.total)
    } catch (error) {
      return errorResponse(context, error)
    }
  })

  return routes
}

export const skillRuntimeObservabilityRoutes = createSkillRuntimeObservabilityRoutes()
