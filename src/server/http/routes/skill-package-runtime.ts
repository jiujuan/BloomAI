import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { ArtifactStore, ArtifactStoreError } from '../../skills/artifacts'
import { PackageInstallError, PackageInstaller } from '../../skills/packages/package-installer'
import { SkillRunCoordinator } from '../../skills/runtime'
import {
  SkillRunConflictError,
  SkillRunNotFoundError,
  SkillRunTransitionError,
} from '../../skills/runtime/skill-run-coordinator'

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
const runStatusSchema = z.enum(['created', 'validating', 'running', 'waiting_input', 'waiting_approval', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'])

export const skillPackageRuntimeRoutes = new Hono()
const coordinator = new SkillRunCoordinator()
const artifactStore = new ArtifactStore()

skillPackageRuntimeRoutes.post('/skill-packages/inspect', async (c) => {
  try {
    const body = await readValidated(c, packageMutationSchema)
    return c.json({ data: await new PackageInstaller().inspect(body.source) })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.post('/skill-packages/install', async (c) => {
  try {
    const body = await readValidated(c, packageMutationSchema)
    return c.json({ data: await new PackageInstaller().install(body.source) }, 201)
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.get('/skill-packages', (c) => {
  try {
    const page = paginationSchema.parse(c.req.query())
    const result = skillPackageRepo.listPackages(page)
    return c.json({ data: result.data, meta: pageMeta(page, result.total) })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.get('/skill-packages/:id', (c) => {
  try {
    const id = idSchema.parse(c.req.param('id'))
    const packageRecord = skillPackageRepo.getPackage(id)
    if (!packageRecord) throw new HttpApiError('NOT_FOUND', 'Skill package not found', 404)
    const versions = skillPackageRepo.listVersions(id)
    return c.json({ data: {
      package: packageRecord,
      versions,
      installations: skillPackageRepo.listInstallations(id),
      capabilityGrants: versions.flatMap((version) => skillPackageRepo.listCapabilityGrants(version.id).map((grant) => ({
        ...grant,
        skill_version_id: version.id,
      }))),
    } })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.patch('/skill-installations/:id', async (c) => {
  try {
    const installation = skillPackageRepo.setInstallationEnabled(
      idSchema.parse(c.req.param('id')),
      (await readValidated(c, installationUpdateSchema)).enabled,
    )
    if (!installation) throw new HttpApiError('NOT_FOUND', 'Skill installation not found', 404)
    return c.json({ data: installation })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.delete('/skill-capability-grants/:id', (c) => {
  try {
    if (!skillPackageRepo.revokeCapabilityGrant(idSchema.parse(c.req.param('id')))) {
      throw new HttpApiError('NOT_FOUND', 'Active capability grant not found', 404)
    }
    return c.json({ data: { revoked: true } })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.delete('/skill-installations/:id', (c) => {
  try {
    const id = idSchema.parse(c.req.param('id'))
    if (!skillPackageRepo.deleteInstallation(id)) throw new HttpApiError('NOT_FOUND', 'Skill installation not found', 404)
    return c.json({ data: { uninstalled: true } })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.post('/skill-runs', async (c) => {
  try {
    const body = await readValidated(c, createRunSchema)
    const version = skillPackageRepo.resolveRunnableVersion(body.skillVersionId ?? body.skillId!)
    if (!version) throw new HttpApiError('NOT_FOUND', 'Installed and enabled Package Skill was not found', 404)
    if (version.is_compatible !== 1) throw new HttpApiError('SKILL_VERSION_INCOMPATIBLE', 'Skill version is incompatible with the Package Runtime', 409)
    const context = { ...(body.context ?? {}), ...(body.target ? { target: body.target } : {}) }
    const started = coordinator.startRun({
      skillVersionId: version.id,
      input: body.input,
      context,
      surface: body.surface,
      sessionId: body.sessionId,
      imageSessionId: body.imageSessionId,
    })
    const run = coordinator.getRun(started.runId)
    return c.json({ data: { runId: run.id, status: run.status, revision: run.revision } }, 201)
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.get('/skill-runs', (c) => {
  try {
    const page = paginationSchema.extend({ status: runStatusSchema.optional(), skillVersionId: idSchema.optional() }).parse(c.req.query())
    const result = skillPackageRepo.listRuns(page)
    return c.json({ data: result.data.map((run) => coordinator.getRun(run.id)), meta: pageMeta(page, result.total) })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.get('/skill-runs/:id', (c) => {
  try {
    return c.json({ data: coordinator.getRun(idSchema.parse(c.req.param('id'))) })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.get('/skill-runs/:id/events', (c) => {
  try {
    const id = idSchema.parse(c.req.param('id'))
    const { afterSeq } = z.object({ afterSeq: z.coerce.number().int().min(0).default(0) }).parse(c.req.query())
    coordinator.getRun(id)
    return c.json({ data: coordinator.subscribeEvents(id, afterSeq), meta: { afterSeq } })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.post('/skill-runs/:id/commands', async (c) => {
  try {
    const run = coordinator.dispatchCommand(idSchema.parse(c.req.param('id')), await readValidated(c, commandSchema))
    return c.json({ data: run })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.post('/skill-runs/:id/cancel', async (c) => {
  try {
    const body = await readValidated(c, cancelSchema)
    const run = coordinator.dispatchCommand(idSchema.parse(c.req.param('id')), { type: 'cancel', ...body })
    return c.json({ data: run })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.get('/skill-runs/:id/artifacts', (c) => {
  try {
    const runId = idSchema.parse(c.req.param('id'))
    coordinator.getRun(runId)
    return c.json({ data: skillPackageRepo.listArtifacts(runId) })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.get('/skill-artifacts/:id/content', (c) => {
  try {
    const content = artifactStore.readContent(idSchema.parse(c.req.param('id')))
    return new Response(Uint8Array.from(content.content), { headers: { 'Content-Type': content.mimeType } })
  } catch (error) {
    return errorResponse(c, error)
  }
})

skillPackageRuntimeRoutes.post('/skill-artifacts/:id/export', async (c) => {
  try {
    const body = await readValidated(c, z.object({ destinationDir: z.string().min(1) }))
    const path = artifactStore.exportArtifact({ artifactId: idSchema.parse(c.req.param('id')), destinationDir: body.destinationDir })
    return c.json({ data: { path } })
  } catch (error) {
    return errorResponse(c, error)
  }
})

async function readValidated<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new HttpApiError('VALIDATION_ERROR', 'Request body must be valid JSON', 400)
  }
  return schema.parse(body)
}

function pageMeta(page: { limit: number; offset: number }, total: number) {
  return { ...page, total }
}

class HttpApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
  }
}

function errorResponse(c: Context, error: unknown) {
  if (error instanceof HttpApiError) return c.json({ error: { code: error.code, message: error.message } }, error.status as 400 | 404 | 409)
  if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request' } }, 400)
  if (error instanceof SkillRunNotFoundError) return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
  if (error instanceof SkillRunConflictError) return c.json({ error: { code: 'REVISION_CONFLICT', message: error.message } }, 409)
  if (error instanceof SkillRunTransitionError) return c.json({ error: { code: 'INVALID_RUN_TRANSITION', message: error.message } }, 409)
  if (error instanceof PackageInstallError) return c.json({ error: { code: 'PACKAGE_INSTALL_ERROR', message: error.message } }, 400)
  if (error instanceof ArtifactStoreError) {
    const status = error.message.startsWith('Artifact not found') ? 404 : 400
    return c.json({ error: { code: status === 404 ? 'NOT_FOUND' : 'ARTIFACT_ERROR', message: error.message } }, status)
  }
  const message = error instanceof Error ? error.message : 'Internal server error'
  return c.json({ error: { code: 'INTERNAL_ERROR', message } }, 500)
}
