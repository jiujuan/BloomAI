import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { mapErrorToHttpResponse } from '../error-mapper'
import { ServiceError } from '../../services/errors'
import { createMigrationControlService, type MigrationContext } from '../../services/skill-migration.service'

const idSchema = z.string().trim().min(1).max(200)
const emptyBodySchema = z.object({}).strict()
const validateBodySchema = z.object({
  previewId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().positive(),
}).strict()
const publishBodySchema = z.object({
  previewId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().positive(),
  confirm: z.literal(true),
  acknowledgedWarnings: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
}).strict()

const DEFAULT_MAX_BODY_BYTES = 64 * 1024

type MigrationRouteOptions = {
  service?: ReturnType<typeof createMigrationControlService>
  maxBodyBytes?: number
}

/**
 * HTTP adapter for the Legacy migration control plane.
 *
 * The adapter intentionally accepts only control metadata. It never accepts a
 * client-supplied Legacy source or complete draft: every operation re-reads
 * the Archive record through migrationControlService and re-computes the
 * source hash before acting.
 */
export function createSkillMigrationRoutes(options: MigrationRouteOptions = {}) {
  const routes = new Hono()
  const service = options.service ?? createMigrationControlService()
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  routes.post('/skills/:id/migration/inspect', async (c) => {
    try {
      await readBody(c, emptyBodySchema, maxBodyBytes)
      return c.json({ data: service.inspect(idSchema.parse(c.req.param('id')), context(c)) })
    } catch (error) { return errorResponse(c, error) }
  })

  routes.post('/skills/:id/migration/preview', async (c) => {
    try {
      await readBody(c, emptyBodySchema, maxBodyBytes)
      return c.json({ data: service.preview(idSchema.parse(c.req.param('id')), context(c)) })
    } catch (error) { return errorResponse(c, error) }
  })

  routes.post('/skills/:id/migration/validate', async (c) => {
    try {
      const body = await readBody(c, validateBodySchema, maxBodyBytes)
      return c.json({ data: service.validate(idSchema.parse(c.req.param('id')), body, context(c)) })
    } catch (error) { return errorResponse(c, error) }
  })

  routes.post('/skills/:id/migration/publish', async (c) => {
    try {
      const body = await readBody(c, publishBodySchema, maxBodyBytes)
      return c.json({ data: service.publish(idSchema.parse(c.req.param('id')), body, context(c)) }, 201)
    } catch (error) { return errorResponse(c, error) }
  })

  routes.get('/skills/:id/migration-history', (c) => {
    try {
      return c.json({ data: service.history(idSchema.parse(c.req.param('id'))) })
    } catch (error) { return errorResponse(c, error) }
  })

  return routes
}

export const skillMigrationRoutes = createSkillMigrationRoutes()

async function readBody<T extends z.ZodTypeAny>(c: Context, schema: T, maxBodyBytes: number): Promise<z.infer<T>> {
  const contentLength = c.req.header('content-length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBodyBytes) {
    throw new ServiceError('VALIDATION_ERROR', `Migration request body exceeds ${maxBodyBytes} bytes`)
  }
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ServiceError('VALIDATION_ERROR', 'Request body must be valid JSON')
  }
  const serialized = JSON.stringify(raw)
  if (Buffer.byteLength(serialized, 'utf8') > maxBodyBytes) {
    throw new ServiceError('VALIDATION_ERROR', `Migration request body exceeds ${maxBodyBytes} bytes`)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new ServiceError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid migration request')
  return parsed.data
}

function context(c: Context): MigrationContext {
  const ownerId = (c.req.header('x-bloom-owner') || 'local-user').trim()
  const actor = (c.req.header('x-bloom-actor') || ownerId).trim()
  const tenant = (c.req.header('x-bloom-tenant') || 'local').trim()
  if (!ownerId || ownerId.length > 200 || !actor || actor.length > 200 || !tenant || tenant.length > 200) {
    throw new ServiceError('FORBIDDEN', 'Invalid migration owner or tenant context')
  }
  return { ownerId, actor }
}

function errorResponse(c: any, error: unknown) {
  if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request' } }, 400)
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}
