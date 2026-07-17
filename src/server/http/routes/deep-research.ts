import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type {
  ResearchArtifactContent,
  ResearchClarificationInput,
  ResearchEventDto,
  ResearchRunDetailDto,
  ResearchRunDto,
  ResearchRunFilter,
  StartResearchInput,
} from '@shared/deepresearch/contracts'
import { clarificationSchema, startResearchSchema } from '@shared/deepresearch/schemas'
import { isDeepResearchV2Enabled } from '@server/config/config'
import { getDeepResearchModule } from '@server/deepresearch'
import { isResearchDomainError } from '@server/deepresearch/domain/errors'
import { readJson } from '../util'

type MaybePromise<T> = T | Promise<T>

type DeepResearchHttpModule = {
  startResearch(input: StartResearchInput): Promise<ResearchRunDto>
  getRun(runId: string): MaybePromise<ResearchRunDetailDto | undefined>
  listRuns(filter?: ResearchRunFilter): MaybePromise<ResearchRunDto[]>
  listEvents(runId: string, afterSequence?: number): MaybePromise<ResearchEventDto[]>
  answerClarification(runId: string, input: ResearchClarificationInput): Promise<ResearchRunDto>
  cancelRun(runId: string): Promise<ResearchRunDto>
  resumeRun(runId: string): Promise<ResearchRunDto>
  getArtifact(runId: string, artifactId: string): MaybePromise<ResearchArtifactContent | undefined>
  subscribeToEvents(runId: string, listener: (event: ResearchEventDto) => void): () => void
}

export interface CreateDeepResearchRoutesOptions {
  module?: DeepResearchHttpModule
  isEnabled?: () => boolean
}

const listFilterSchema = z.object({
  sessionId: z.string().min(1).optional(),
  statuses: z.string().optional(),
  profile: z.enum(['general', 'market', 'competitor', 'academic']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
})

const afterSchema = z.coerce.number().int().min(0)

function errorResponse(c: any, status: 400 | 404 | 409 | 500, code: string, message: string) {
  return c.json({ error: { code, message } }, status)
}

function routeError(c: any, error: unknown) {
  if (error instanceof z.ZodError) {
    return errorResponse(c, 400, 'RESEARCH_VALIDATION_ERROR', error.issues[0]?.message ?? 'Invalid Deep Research request.')
  }
  if (isResearchDomainError(error)) {
    const status = error.code === 'RESEARCH_INVALID_TRANSITION' || error.code === 'RESEARCH_NOT_RUNNABLE' || error.code === 'RESEARCH_BUDGET_EXHAUSTED' ? 409 : 400
    return errorResponse(c, status, error.code, error.message)
  }
  return errorResponse(c, 500, 'INTERNAL_ERROR', 'Internal server error')
}

function unavailable(c: any, isEnabled: () => boolean) {
  return isEnabled() ? undefined : errorResponse(c, 404, 'DEEP_RESEARCH_DISABLED', 'Deep Research V2 is disabled.')
}

async function requireRun(c: any, module: DeepResearchHttpModule, runId: string): Promise<ResearchRunDetailDto | Response> {
  const run = await module.getRun(runId)
  return run ?? errorResponse(c, 404, 'RESEARCH_RUN_NOT_FOUND', 'Deep Research Run not found: ' + runId)
}

function parseAfter(value: string | undefined): number {
  return afterSchema.parse(value ?? '0')
}

function buildFilter(c: any): ResearchRunFilter {
  const parsed = listFilterSchema.parse(c.req.query())
  return {
    sessionId: parsed.sessionId,
    statuses: parsed.statuses ? parsed.statuses.split(',').filter(Boolean) as ResearchRunFilter['statuses'] : undefined,
    profile: parsed.profile,
    limit: parsed.limit,
    cursor: parsed.cursor,
  }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response
}

export function createDeepResearchRoutes(options: CreateDeepResearchRoutesOptions = {}): Hono {
  const module = options.module ?? getDeepResearchModule()
  const isEnabled = options.isEnabled ?? isDeepResearchV2Enabled
  const routes = new Hono()

  routes.get('/status', (c) => c.json({ data: { enabled: isEnabled(), version: 'v2' } }))

  routes.post('/runs', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try {
      const input = startResearchSchema.parse(await readJson(c))
      return c.json({ data: await module.startResearch(input) }, 201)
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try { return c.json({ data: await module.listRuns(buildFilter(c)) }) } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try {
      const run = await requireRun(c, module, c.req.param('runId'))
      return isResponse(run) ? run : c.json({ data: run })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/events', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: await module.listEvents(runId, parseAfter(c.req.query('after'))) })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/stream', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      const after = parseAfter(c.req.query('after') ?? c.req.header('Last-Event-ID'))

      return streamSSE(c, async (stream) => {
        let cursor = after
        let writeTail = Promise.resolve()
        const enqueue = (event: ResearchEventDto) => {
          if (event.sequence <= cursor) return
          cursor = event.sequence
          writeTail = writeTail.then(() => stream.writeSSE({
            id: String(event.sequence),
            event: event.type,
            data: JSON.stringify(event),
          }))
        }
        const unsubscribe = module.subscribeToEvents(runId, enqueue)
        stream.onAbort(unsubscribe)
        for (const event of await module.listEvents(runId, after)) enqueue(event)
        await writeTail
        await new Promise<void>((resolve) => stream.onAbort(resolve))
      })
    } catch (error) { return routeError(c, error) }
  })

  routes.post('/runs/:runId/clarifications', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      const input = clarificationSchema.parse(await readJson(c))
      return c.json({ data: await module.answerClarification(runId, input) })
    } catch (error) { return routeError(c, error) }
  })

  routes.post('/runs/:runId/cancel', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: await module.cancelRun(runId) })
    } catch (error) { return routeError(c, error) }
  })

  routes.post('/runs/:runId/resume', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: await module.resumeRun(runId) })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/artifacts/:artifactId', async (c) => {
    const disabled = unavailable(c, isEnabled)
    if (disabled) return disabled
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      const artifact = await module.getArtifact(runId, c.req.param('artifactId'))
      if (!artifact) return errorResponse(c, 404, 'RESEARCH_ARTIFACT_NOT_FOUND', 'Deep Research artifact was not found.')
      return c.body(artifact.content, 200, {
        'Content-Type': artifact.artifact.contentType,
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(artifact.artifact.fileName),
      })
    } catch (error) { return routeError(c, error) }
  })

  return routes
}

export const deepResearchRoutes = createDeepResearchRoutes()
