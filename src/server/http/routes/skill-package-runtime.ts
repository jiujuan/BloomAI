import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { mapErrorToHttpResponse } from '../error-mapper'
import { ServiceError } from '../../services/errors'
import { skillPackageRuntimeService } from '../../services/skill-package-runtime.service'

const jsonObjectSchema = z.record(z.unknown())
const idSchema = z.string().min(1).max(200)
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
const packageSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local-directory'), directory: z.string().min(1), subdirectory: z.string().min(1).optional() }),
  z.object({ kind: z.literal('zip'), zipPath: z.string().min(1), subdirectory: z.string().min(1).optional() }),
  z.object({ kind: z.literal('github-archive'), repositoryUrl: z.string().url(), ref: z.string().min(1), subdirectory: z.string().min(1).optional() }),
])
const packageMutationSchema = z.object({ source: packageSourceSchema })
const installationUpdateSchema = z.object({ enabled: z.boolean() })
const createRunSchema = z.object({
  skillId: idSchema.optional(),
  skillVersionId: idSchema.optional(),
  input: jsonObjectSchema,
  context: jsonObjectSchema.optional(),
  surface: z.enum(['skills', 'chat', 'image']).optional(),
  sessionId: idSchema.optional(),
  imageSessionId: idSchema.optional(),
  target: z.object({ kind: z.enum(['chat', 'image_session', 'artifact_only']), id: idSchema.optional() }).optional(),
}).refine((body) => Boolean(body.skillId || body.skillVersionId), { message: 'skillId or skillVersionId is required' })
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal('modify'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative(), patchInput: jsonObjectSchema }),
  z.object({ type: z.literal('cancel'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative() }),
])
const cancelSchema = z.object({ idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative() })
const artifactContentQuerySchema = z.object({ runId: idSchema })
const artifactExportSchema = z.object({ runId: idSchema, destinationDir: z.string().min(1) })
const runStatusSchema = z.enum(['created', 'validating', 'running', 'waiting_input', 'waiting_approval', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'])

export const skillPackageRuntimeRoutes = new Hono()

skillPackageRuntimeRoutes.post('/skill-packages/inspect', async (c) => {
  try { return c.json({ data: await skillPackageRuntimeService.inspectPackage((await readValidated(c, packageMutationSchema)).source) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-packages/install', async (c) => {
  try { return c.json({ data: await skillPackageRuntimeService.installPackage((await readValidated(c, packageMutationSchema)).source) }, 201) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-packages', (c) => {
  try {
    const page = paginationSchema.parse(c.req.query())
    const result = skillPackageRuntimeService.listPackages(page)
    return c.json({ data: result.data, meta: pageMeta(page, result.total) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-packages/:id', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.getPackageDetail(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.patch('/skill-installations/:id', async (c) => {
  try { return c.json({ data: skillPackageRuntimeService.setInstallationEnabled(idSchema.parse(c.req.param('id')), (await readValidated(c, installationUpdateSchema)).enabled) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.delete('/skill-capability-grants/:id', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.revokeCapabilityGrant(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.delete('/skill-installations/:id', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.removeInstallation(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-runs', async (c) => {
  try { return c.json({ data: skillPackageRuntimeService.startRun(await readValidated(c, createRunSchema)) }, 201) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs', (c) => {
  try {
    const page = paginationSchema.extend({ status: runStatusSchema.optional(), skillVersionId: idSchema.optional() }).parse(c.req.query())
    const result = skillPackageRuntimeService.listRuns(page)
    return c.json({ data: result.data, meta: pageMeta(page, result.total) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.getRun(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id/events', (c) => {
  try {
    const id = idSchema.parse(c.req.param('id'))
    const { afterSeq } = z.object({ afterSeq: z.coerce.number().int().min(0).default(0) }).parse(c.req.query())
    return c.json({ data: skillPackageRuntimeService.listRunEvents(id, afterSeq), meta: { afterSeq } })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-runs/:id/commands', async (c) => {
  try { return c.json({ data: skillPackageRuntimeService.executeRunCommand(idSchema.parse(c.req.param('id')), await readValidated(c, commandSchema)) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-runs/:id/cancel', async (c) => {
  try { return c.json({ data: skillPackageRuntimeService.cancelRun(idSchema.parse(c.req.param('id')), await readValidated(c, cancelSchema)) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id/artifacts', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.listRunArtifacts(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-artifacts/:id/content', (c) => {
  try {
    const content = skillPackageRuntimeService.readArtifactContent(idSchema.parse(c.req.param('id')), artifactContentQuerySchema.parse(c.req.query()).runId)
    return new Response(Uint8Array.from(content.content), { headers: { 'Content-Type': content.mimeType } })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-artifacts/:id/export', async (c) => {
  try {
    const body = await readValidated(c, artifactExportSchema)
    return c.json({ data: { path: skillPackageRuntimeService.exportArtifact(idSchema.parse(c.req.param('id')), body.runId, body.destinationDir) } })
  } catch (error) { return errorResponse(c, error) }
})

async function readValidated<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown
  try { body = await c.req.json() } catch { throw new ServiceError('VALIDATION_ERROR', 'Request body must be valid JSON') }
  return schema.parse(body)
}
function pageMeta(page: { limit: number; offset: number }, total: number) { return { ...page, total } }
function errorResponse(c: Context, error: unknown) {
  if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request' } }, 400)
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}