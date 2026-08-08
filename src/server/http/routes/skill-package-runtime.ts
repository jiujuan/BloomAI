import { Hono } from 'hono'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { ServiceError } from '../../services/errors'
import { skillPackageRuntimeService } from '../../services/skill-package-runtime.service'
import { getSkillRuntimeCapabilities } from '../../skills/config/skill-runtime.config'
import { errorResponse } from '../dtos/skill-runtime.error'
import { pageSuccess, successResponse } from '../dtos/skill-runtime.response'
import { getRequestId } from '../request-context'
import { getSkillActor } from '../skills-policy'

const jsonObjectSchema = z.record(z.unknown())
const idSchema = z.string().min(1).max(200)
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
const packageListQuerySchema = paginationSchema.extend({
  search: z.string().trim().min(1).max(200).optional(),
  sourceType: z.string().trim().min(1).max(100).optional(),
  includeArchived: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  sort: z.enum(['updatedAt', 'createdAt', 'name', 'sourceType']).default('updatedAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
}).strict()
const staticSourceMetadataSchema = z.object({ origin: z.enum(['local', 'npx-artifact']).optional() }).strict()
const packageSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local-directory'), directory: z.string().min(1), subdirectory: z.string().min(1).optional(), metadata: staticSourceMetadataSchema.optional() }).strict(),
  z.object({ kind: z.literal('zip'), zipPath: z.string().min(1), subdirectory: z.string().min(1).optional(), metadata: staticSourceMetadataSchema.optional() }).strict(),
  z.object({ kind: z.literal('github-archive'), repositoryUrl: z.string().url(), ref: z.string().min(1), subdirectory: z.string().min(1).optional() }).strict(),
])
const packageMutationSchema = z.object({ source: packageSourceSchema }).strict()
const packageInstallSchema = z.object({
  source: packageSourceSchema,
  reviewId: idSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  confirm: z.literal(true),
}).strict()
const importReviewDecisionSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict()

const installationUpdateSchema = z.object({ enabled: z.boolean(), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().trim().min(1).max(200) }).strict()
const installationUninstallSchema = z.object({ expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().trim().min(1).max(200) }).strict()
const installationRollbackSchema = z.object({ versionId: idSchema.optional(), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(500) }).strict()
const packageDeleteSchema = z.object({ confirm: z.literal(true), idempotencyKey: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(500) }).strict()
const versionCandidateSchema = z.object({
  version: z.string().trim().min(1).max(100),
  manifest: jsonObjectSchema,
  manifestHash: z.string().trim().min(1).max(200),
  packagePath: z.string().trim().min(1).max(1000),
  sourceSnapshot: jsonObjectSchema.optional(),
  isCompatible: z.boolean().optional(),
  status: z.string().trim().min(1).max(40).optional(),
  securityStatus: z.string().trim().min(1).max(40).optional(),
  securityFindings: jsonObjectSchema.optional(),
  snapshotHash: z.string().trim().max(200).optional(),
}).strict()
const versionUpdateSchema = versionCandidateSchema.extend({ confirm: z.literal(true) }).strict()
const versionSwitchSchema = z.object({
  versionId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict()
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
const artifactContentQuerySchema = z.object({ runId: idSchema }).strict()
const artifactListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), offset: z.coerce.number().int().min(0).optional(), sort: z.enum(['createdAt', 'size', 'kind']).optional(), direction: z.enum(['asc', 'desc']).optional() }).strict()
const artifactExportSchema = z.object({ runId: idSchema, destinationDir: z.string().min(1), confirmed: z.literal(true), actor: idSchema.optional(), auditReason: z.string().trim().min(1).max(500) }).strict()
const runStatusSchema = z.enum(['created', 'validating', 'running', 'waiting_input', 'waiting_approval', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'])

export const skillPackageRuntimeRoutes = new Hono()

function requireSkillActor(c: Context): string {
  const actor = getSkillActor(c)
  if (!actor) throw new ServiceError('FORBIDDEN', 'Authenticated Skills actor is required')
  return actor
}

skillPackageRuntimeRoutes.get('/skill-runtime/capabilities', (c) => {
  return successResponse(c, getSkillRuntimeCapabilities())
})

skillPackageRuntimeRoutes.post('/skill-packages/inspect', async (c) => {
  try { return successResponse(c, await skillPackageRuntimeService.inspectPackage((await readValidated(c, packageMutationSchema)).source, { actor: getSkillActor(c), requestId: getRequestId(c) })) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-packages/install', async (c) => {
  try {
    const input = await readValidated(c, packageInstallSchema)
    return successResponse(c, await skillPackageRuntimeService.installPackage(input.source, input, { actor: getSkillActor(c), requestId: getRequestId(c) }), 201)
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-import-reviews/:id', (c) => {
  try { return successResponse(c, skillPackageRuntimeService.getImportReview(idSchema.parse(c.req.param('id')))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-import-reviews/:id/approve', async (c) => {
  try {
    const input = await readValidated(c, importReviewDecisionSchema)
    return successResponse(c, skillPackageRuntimeService.approveImportReview(idSchema.parse(c.req.param('id')), requireSkillActor(c), { actor: getSkillActor(c), requestId: getRequestId(c) }))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-import-reviews/:id/reject', async (c) => {
  try {
    const input = await readValidated(c, importReviewDecisionSchema)
    return successResponse(c, skillPackageRuntimeService.rejectImportReview(idSchema.parse(c.req.param('id')), requireSkillActor(c), input.reason, { actor: getSkillActor(c), requestId: getRequestId(c) }))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-packages', (c) => {
  try {
    const page = packageListQuerySchema.parse(c.req.query())
    const result = skillPackageRuntimeService.listPackages(page)
    return pageSuccess(c, result.data, page, result.total)
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-installations', (c) => {
  try {
    const page = paginationSchema.parse(c.req.query())
    const result = skillPackageRuntimeService.listInstallations(page)
    return pageSuccess(c, result.data.map(toInstallationHttpDto), page, result.total)
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.delete('/skill-packages/:id', async (c) => {
  try {
    const input = await readValidated(c, packageDeleteSchema)
    return successResponse(c, skillPackageRuntimeService.deletePackage(idSchema.parse(c.req.param('id')), { ...input, actor: getSkillActor(c), requestId: getRequestId(c) }))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-packages/:id', (c) => {
  try { return successResponse(c, toPackageDetailHttpDto(skillPackageRuntimeService.getPackageDetail(idSchema.parse(c.req.param('id'))))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-packages/:id/versions', (c) => {
  try { return successResponse(c, skillPackageRuntimeService.listVersions(idSchema.parse(c.req.param('id')))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-versions/:id', (c) => {
  try { return successResponse(c, skillPackageRuntimeService.getVersion(idSchema.parse(c.req.param('id')))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-versions/:id/diff', (c) => {
  try {
    const toVersionId = idSchema.parse(c.req.query('toVersionId'))
    return successResponse(c, skillPackageRuntimeService.diffVersions(idSchema.parse(c.req.param('id')), toVersionId))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-packages/:id/update/preview', async (c) => {
  try {
    const candidate = await readValidated(c, versionCandidateSchema)
    return successResponse(c, await skillPackageRuntimeService.previewVersionUpdate(idSchema.parse(c.req.param('id')), candidate))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-packages/:id/update', async (c) => {
  try {
    const { confirm: _confirm, ...candidate } = await readValidated(c, versionUpdateSchema)
    return successResponse(c, await skillPackageRuntimeService.updatePackageVersion(idSchema.parse(c.req.param('id')), candidate, { actor: getSkillActor(c), requestId: getRequestId(c) }), 201)
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.patch('/skill-installations/:id', async (c) => {
  try {
    const input = await readValidated(c, installationUpdateSchema)
    const installation = skillPackageRuntimeService.setInstallationEnabledWithRevision(idSchema.parse(c.req.param('id')), input.enabled, { ...input, actor: getSkillActor(c), requestId: getRequestId(c) })
    return successResponse(c, toInstallationHttpDto(installation))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-installations/:id/switch-version', async (c) => {
  try {
    const input = await readValidated(c, versionSwitchSchema)
    return successResponse(c, toInstallationHttpDto(skillPackageRuntimeService.switchCurrentVersion(idSchema.parse(c.req.param('id')), input.versionId, { ...input, actor: getSkillActor(c), requestId: getRequestId(c) })))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.delete('/skill-capability-grants/:id', (c) => {
  try { return successResponse(c, skillPackageRuntimeService.revokeCapabilityGrant(idSchema.parse(c.req.param('id')))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-capability-grants/:id/approve', async (c) => {
  try {
    const input = await readValidated(c, grantApproveSchema)
    return successResponse(c, skillPackageRuntimeService.approveCapabilityGrant(idSchema.parse(c.req.param('id')), input))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-capability-grants/:id/reject', async (c) => {
  try {
    const input = await readValidated(c, grantRejectSchema)
    return successResponse(c, skillPackageRuntimeService.rejectCapabilityGrant(idSchema.parse(c.req.param('id')), input))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-capability-grants/:id/revoke', async (c) => {
  try {
    const input = await readValidated(c, grantRevokeSchema)
    return successResponse(c, skillPackageRuntimeService.revokeCapabilityGrantByActor(idSchema.parse(c.req.param('id')), input))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-installations/:id/rollback', async (c) => {
  try {
    const input = await readValidated(c, installationRollbackSchema)
    return successResponse(c, toInstallationHttpDto(skillPackageRuntimeService.rollbackInstallation(idSchema.parse(c.req.param('id')), { ...input, actor: getSkillActor(c), requestId: getRequestId(c) })))
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.delete('/skill-installations/:id', async (c) => {
  try {
    const input = await readValidated(c, installationUninstallSchema)
    return successResponse(c, { uninstalled: true, installation: toInstallationHttpDto(skillPackageRuntimeService.uninstallInstallation(idSchema.parse(c.req.param('id')), { ...input, actor: getSkillActor(c), requestId: getRequestId(c) })) })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-runs', async (c) => {
  try { return successResponse(c, skillPackageRuntimeService.startRun(await readValidated(c, createRunSchema)), 201) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs', (c) => {
  try {
    const page = paginationSchema.extend({ status: runStatusSchema.optional(), skillVersionId: idSchema.optional() }).parse(c.req.query())
    const result = skillPackageRuntimeService.listRuns(page)
    return pageSuccess(c, result.data, page, result.total)
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id/next-action', (c) => {
  try { return successResponse(c, skillPackageRuntimeService.getRunNextAction(idSchema.parse(c.req.param('id')))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id', (c) => {
  try { return successResponse(c, skillPackageRuntimeService.getRun(idSchema.parse(c.req.param('id')))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id/capabilities', (c) => {
  try { return successResponse(c, skillPackageRuntimeService.getRunCapabilities(idSchema.parse(c.req.param('id')))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id/events', (c) => {
  try {
    const id = idSchema.parse(c.req.param('id'))
    const { afterSeq } = z.object({ afterSeq: z.coerce.number().int().min(0).default(0) }).parse(c.req.query())
    const events = skillPackageRuntimeService.listRunEvents(id, afterSeq)
    return successResponse(c, events, 200, { afterSeq })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id/stream', (c) => {
  try {
    const id = idSchema.parse(c.req.param('id'))
    const { afterSeq } = z.object({ afterSeq: z.coerce.number().int().min(0).default(0) }).parse(c.req.query())
    const events = skillPackageRuntimeService.listRunEvents(id, afterSeq)
    return streamSSE(c, async (stream) => {
      if (events.length === 0) {
        await stream.writeSSE({ id: String(afterSeq), event: 'ready', data: JSON.stringify({ runId: id, afterSeq }) })
        return
      }
      for (const event of events) {
        await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) })
      }
    })
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-runs/:id/commands', async (c) => {
  try { return successResponse(c, skillPackageRuntimeService.executeRunCommand(idSchema.parse(c.req.param('id')), await readValidated(c, commandSchema))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-runs/:id/cancel', async (c) => {
  try { return successResponse(c, skillPackageRuntimeService.cancelRun(idSchema.parse(c.req.param('id')), await readValidated(c, cancelSchema))) } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-runs/:id/artifacts', (c) => {
  try {
    const runId = idSchema.parse(c.req.param('id'))
    const rawQuery = c.req.query()
    if (Object.keys(rawQuery).length === 0) return successResponse(c, skillPackageRuntimeService.listRunArtifacts(runId))
    const query = artifactListQuerySchema.parse(rawQuery)
    const page = skillPackageRuntimeService.listRunArtifacts(runId, query)
    return pageSuccess(c, page.data, { limit: page.limit, offset: page.offset }, page.total)
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.get('/skill-artifacts/:id/content', (c) => {
  try {
    const content = skillPackageRuntimeService.readArtifactContent(idSchema.parse(c.req.param('id')), artifactContentQuerySchema.parse(c.req.query()).runId)
    const response = new Response(Uint8Array.from(content.content), { headers: { 'Content-Type': content.mimeType } })
     response.headers.set('x-request-id', getRequestId(c))
     return response
  } catch (error) { return errorResponse(c, error) }
})
skillPackageRuntimeRoutes.post('/skill-artifacts/:id/export', async (c) => {
  try {
    const body = await readValidated(c, artifactExportSchema)
    return successResponse(c, { path: skillPackageRuntimeService.exportArtifact(idSchema.parse(c.req.param('id')), body.runId, body.destinationDir, body) })
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
