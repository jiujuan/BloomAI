import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { mapErrorToHttpResponse } from '../error-mapper'
import { ServiceError } from '../../services/errors'
import { skillPackageRuntimeService } from '../../services/skill-package-runtime.service'
import { getSkillRuntimeCapabilities } from '../../skills/config/skill-runtime.config'

const jsonObjectSchema = z.record(z.unknown())
const idSchema = z.string().min(1).max(200)
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
const staticSourceMetadataSchema = z.object({ origin: z.enum(['local', 'npx-artifact']).optional() }).strict()
const packageSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local-directory'), directory: z.string().min(1), subdirectory: z.string().min(1).optional(), metadata: staticSourceMetadataSchema.optional() }).strict(),
  z.object({ kind: z.literal('zip'), zipPath: z.string().min(1), subdirectory: z.string().min(1).optional(), metadata: staticSourceMetadataSchema.optional() }).strict(),
  z.object({ kind: z.literal('github-archive'), repositoryUrl: z.string().url(), ref: z.string().min(1), subdirectory: z.string().min(1).optional() }).strict(),
])
const packageMutationSchema = z.object({ source: packageSourceSchema })
const packageInstallSchema = z.object({
  source: packageSourceSchema,
  reviewId: idSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  confirm: z.literal(true),
})
const importReviewDecisionSchema = z.object({ reviewer: idSchema, reason: z.string().trim().min(1).max(500).optional() }).strict()

const installationUpdateSchema = z.object({ enabled: z.boolean() })
const grantApproveSchema = z.object({ actor: idSchema, scope: jsonObjectSchema.optional(), expiresAt: z.number().int().positive().nullable().optional() }).strict()
const grantRejectSchema = z.object({ actor: idSchema, reason: z.string().trim().min(1).max(500).optional() }).strict()
const grantRevokeSchema = z.object({ actor: idSchema, reason: z.string().trim().min(1).max(500).optional() }).strict()
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
  z.object({ type: z.literal('approve'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal('reject'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(500).optional() }),
  z.object({ type: z.literal('resume'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal('retry'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal('submit_input'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative(), input: jsonObjectSchema }),
  z.object({ type: z.literal('modify'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative(), patchInput: jsonObjectSchema }),
  z.object({ type: z.literal('cancel'), idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative() }),
])
const cancelSchema = z.object({ idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(200).optional() })
const artifactContentQuerySchema = z.object({ runId: idSchema })
const artifactExportSchema = z.object({ runId: idSchema, destinationDir: z.string().min(1) })
const runStatusSchema = z.enum(['created', 'validating', 'running', 'waiting_input', 'waiting_approval', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'])

export const skillPackageRuntimeRoutes = new Hono()

skillPackageRuntimeRoutes.get('/skill-runtime/capabilities', (c) => {
  return c.json({ data: getSkillRuntimeCapabilities() })
})

skillPackageRuntimeRoutes.post('/skill-packages/inspect', async (c) => {
  try { return c.json({ data: await skillPackageRuntimeService.inspectPackage((await readValidated(c, packageMutationSchema)).source) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-packages/install', async (c) => {
  try {
    const input = await readValidated(c, packageInstallSchema)
    return c.json({ data: await skillPackageRuntimeService.installPackage(input.source, input) }, 201)
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-import-reviews/:id', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.getImportReview(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-import-reviews/:id/approve', async (c) => {
  try {
    const input = await readValidated(c, importReviewDecisionSchema)
    return c.json({ data: skillPackageRuntimeService.approveImportReview(idSchema.parse(c.req.param('id')), input.reviewer) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-import-reviews/:id/reject', async (c) => {
  try {
    const input = await readValidated(c, importReviewDecisionSchema)
    return c.json({ data: skillPackageRuntimeService.rejectImportReview(idSchema.parse(c.req.param('id')), input.reviewer, input.reason) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-packages', (c) => {
  try {
    const page = paginationSchema.parse(c.req.query())
    const result = skillPackageRuntimeService.listPackages(page)
    return c.json({ data: result.data, meta: pageMeta(page, result.total) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-packages/:id', (c) => {
  try { return c.json({ data: toPackageDetailHttpDto(skillPackageRuntimeService.getPackageDetail(idSchema.parse(c.req.param('id')))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.patch('/skill-installations/:id', async (c) => {
  try {
    const installation = skillPackageRuntimeService.setInstallationEnabled(idSchema.parse(c.req.param('id')), (await readValidated(c, installationUpdateSchema)).enabled)
    return c.json({ data: toInstallationHttpDto(installation) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.delete('/skill-capability-grants/:id', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.revokeCapabilityGrant(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-capability-grants/:id/approve', async (c) => {
  try {
    const input = await readValidated(c, grantApproveSchema)
    return c.json({ data: skillPackageRuntimeService.approveCapabilityGrant(idSchema.parse(c.req.param('id')), input) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-capability-grants/:id/reject', async (c) => {
  try {
    const input = await readValidated(c, grantRejectSchema)
    return c.json({ data: skillPackageRuntimeService.rejectCapabilityGrant(idSchema.parse(c.req.param('id')), input) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-capability-grants/:id/revoke', async (c) => {
  try {
    const input = await readValidated(c, grantRevokeSchema)
    return c.json({ data: skillPackageRuntimeService.revokeCapabilityGrantByActor(idSchema.parse(c.req.param('id')), input) })
  } catch (error) { return errorResponse(c, error) }
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
skillPackageRuntimeRoutes.get('/skill-runs/:id/next-action', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.getRunNextAction(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.getRun(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id/capabilities', (c) => {
  try { return c.json({ data: skillPackageRuntimeService.getRunCapabilities(idSchema.parse(c.req.param('id'))) }) } catch (error) { return errorResponse(c, error) }
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
function toPackageDetailHttpDto(detail: any) {
  if (!detail || typeof detail !== 'object') return detail
  return {
    ...detail,
    installations: Array.isArray(detail.installations) ? detail.installations.map(toInstallationHttpDto) : detail.installations,
    capabilityGrants: Array.isArray(detail.capabilityGrants)
      ? detail.capabilityGrants.map((grant: any) => ({
        ...grant,
        skill_version_id: grant.skill_version_id ?? grant.skillVersionId,
        revoked_at: grant.revoked_at ?? grant.revokedAt,
        consumed_at: grant.consumed_at ?? grant.consumedAt,
      }))
      : detail.capabilityGrants,
  }
}

function toInstallationHttpDto(installation: any) {
  if (!installation || typeof installation !== 'object') return installation
  return { ...installation, enabled: typeof installation.enabled === 'boolean' ? (installation.enabled ? 1 : 0) : installation.enabled }
}

function pageMeta(page: { limit: number; offset: number }, total: number) { return { ...page, total } }
function errorResponse(c: Context, error: unknown) {
  if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request' } }, 400)
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}