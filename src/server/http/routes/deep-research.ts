import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type {
  JsonObject,
  ResearchArtifactContent,
  ResearchClarificationInput,
  ResearchCoverageAssessmentDto,
  ResearchHistoryPageDto,
  ResearchIterationDto,
  ResearchRunAttemptSummaryDto,
  ResearchRunCheckpointSummaryDto,
  ResearchEventDto,
  ResearchRunDetailDto,
  ResearchRunDiagnosticsDto,
  ResearchRunDto,
  ResearchRunFilter,
  StartResearchInput,
} from '@shared/deepresearch/contracts'
import { clarificationSchema, startResearchSchema } from '@shared/deepresearch/schemas'
import { getDeepResearchModule } from '@server/deepresearch'
import { isResearchDomainError } from '@server/deepresearch/domain/errors'
import { readJson } from '../util'

type MaybePromise<T> = T | Promise<T>

type DeepResearchHttpModule = {
  startResearch(input: StartResearchInput): Promise<ResearchRunDto>
  getRun(runId: string): MaybePromise<ResearchRunDetailDto | undefined>
  getRunDiagnostics(runId: string): MaybePromise<ResearchRunDiagnosticsDto | undefined>
  listRuns(filter?: ResearchRunFilter): MaybePromise<ResearchRunDto[]>
  listAttemptHistory(runId: string, query?: HistoryQuery): MaybePromise<ResearchHistoryPageDto<ResearchRunAttemptSummaryDto>>
  listCheckpointHistory(runId: string, query?: HistoryQuery): MaybePromise<ResearchHistoryPageDto<ResearchRunCheckpointSummaryDto>>
  listIterationHistory(runId: string, query?: HistoryQuery): MaybePromise<ResearchHistoryPageDto<ResearchIterationDto>>
  listAssessmentHistory(runId: string, query?: HistoryQuery): MaybePromise<ResearchHistoryPageDto<ResearchCoverageAssessmentDto>>
  listEvents(runId: string, afterSequence?: number): MaybePromise<ResearchEventDto[]>
  answerClarification(runId: string, input: ResearchClarificationInput): Promise<ResearchRunDto>
  cancelRun(runId: string): Promise<ResearchRunDto>
  resumeRun(runId: string): Promise<ResearchRunDto>
  getArtifact(runId: string, artifactId: string): MaybePromise<ResearchArtifactContent | undefined>
  subscribeToEvents(runId: string, listener: (event: ResearchEventDto) => void): () => void
}

export interface CreateDeepResearchRoutesOptions {
  module?: DeepResearchHttpModule
  /**
   * Diagnostics contain operational details and are denied unless a trusted
   * authentication middleware marks the request as an administrator.
   */
  isAdmin?: (context: any) => boolean
}

const listFilterSchema = z.object({
  sessionId: z.string().min(1).optional(),
  statuses: z.string().optional(),
  profile: z.enum(['general', 'market', 'competitor', 'academic']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
})

const afterSchema = z.coerce.number().int().min(0)
const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(200).optional(),
})

type HistoryQuery = z.infer<typeof historyQuerySchema>

function errorResponse(c: any, status: 400 | 403 | 404 | 409 | 500, code: string, message: string) {
  return c.json({ error: { code, message } }, status)
}

function routeError(c: any, error: unknown) {
  if (error instanceof z.ZodError) {
    return errorResponse(c, 400, 'RESEARCH_VALIDATION_ERROR', error.issues[0]?.message ?? 'Invalid Deep Research request.')
  }
  if (isResearchDomainError(error)) {
    const status = ['RESEARCH_INVALID_TRANSITION', 'RESEARCH_NOT_RUNNABLE', 'RESEARCH_NOT_RESUMABLE', 'RESEARCH_BUDGET_EXHAUSTED', 'RESEARCH_CANCELLED'].includes(error.code) ? 409 : 400
    return errorResponse(c, status, error.code, error.message)
  }
  return errorResponse(c, 500, 'INTERNAL_ERROR', 'Internal server error')
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

const privatePayloadKey = /(?:token|secret|password|authorization|cookie|storage.?path|ownership|lease|executor|content|body|html|markdown|raw|answer)/i
const absolutePath = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/

function publicUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return absolutePath.test(value) ? '[redacted]' : value
  }
}

function redactJson(value: unknown, key = ''): unknown {
  if (privatePayloadKey.test(key)) return undefined
  if (typeof value === 'string') return publicUrl(value)
  if (Array.isArray(value)) return value.map((item) => redactJson(item)).filter((item) => item !== undefined)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([entryKey, entryValue]) => [entryKey, redactJson(entryValue, entryKey)] as const)
      .filter(([, entryValue]) => entryValue !== undefined))
  }
  return value
}

/** One redaction boundary is shared by JSON replay and live SSE payloads. */
export function toPublicResearchEvent(event: ResearchEventDto): ResearchEventDto {
  return {
    ...event,
    eventId: event.eventId ?? `${event.runId}:${event.sequence}`,
    payload: redactJson(event.payload) as JsonObject,
  }
}

function toPublicResearchRun(run: ResearchRunDto): ResearchRunDto {
  return {
    ...run,
    execution: run.execution ? {
      attempt: {
        ...run.execution.attempt,
        workflowRunId: null,
        executorId: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    } : null,
  }
}

/** The long-lived detail route remains additive while hiding fetched bodies and sensitive URL components. */
export function toPublicResearchRunDiagnostics(diagnostics: ResearchRunDiagnosticsDto): ResearchRunDiagnosticsDto {
  return {
    ...diagnostics,
    queries: {
      ...diagnostics.queries,
      items: diagnostics.queries.items.map((query) => ({
        ...query,
        candidates: query.candidates.map((candidate) => ({ ...candidate, url: publicUrl(candidate.url) })),
      })),
    },
    sources: {
      ...diagnostics.sources,
      selected: diagnostics.sources.selected.map((source) => ({ ...source, canonicalUrl: publicUrl(source.canonicalUrl) })),
      candidates: diagnostics.sources.candidates.map((candidate) => ({
        ...candidate,
        canonicalUrl: candidate.canonicalUrl ? publicUrl(candidate.canonicalUrl) : null,
        originalUrl: publicUrl(candidate.originalUrl),
      })),
    },
    fetch: {
      ...diagnostics.fetch,
      snapshots: diagnostics.fetch.snapshots.map((snapshot) => ({ ...snapshot, finalUrl: publicUrl(snapshot.finalUrl) })),
    },
  }
}

export function toPublicResearchRunDetail(run: ResearchRunDetailDto): ResearchRunDetailDto {
  return {
    ...run,
    ...toPublicResearchRun(run),
    sources: run.sources.map((source) => ({
      ...source,
      canonicalUrl: publicUrl(source.canonicalUrl),
      originalUrl: source.originalUrl ? publicUrl(source.originalUrl) : undefined,
      scores: redactJson(source.scores) as JsonObject,
    })),
    snapshots: run.snapshots.map((snapshot) => ({
      ...snapshot,
      content: '[redacted]',
      metadata: redactJson(snapshot.metadata) as JsonObject,
      finalUrl: publicUrl(snapshot.finalUrl),
    })),
    events: run.events.map(toPublicResearchEvent),
  }
}

function parseHistoryQuery(c: any): HistoryQuery {
  return historyQuerySchema.parse(c.req.query())
}

export function createDeepResearchRoutes(options: CreateDeepResearchRoutesOptions = {}): Hono {
  const module = options.module ?? getDeepResearchModule()
  const routes = new Hono()

  routes.get('/status', (c) => c.json({ data: { enabled: true, version: 'v2' } }))

  routes.post('/runs', async (c) => {
    try {
      const input = startResearchSchema.parse(await readJson(c))
      return c.json({ data: toPublicResearchRun(await module.startResearch(input)) }, 201)
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs', async (c) => {
    try { return c.json({ data: (await module.listRuns(buildFilter(c))).map(toPublicResearchRun) }) } catch (error) { return routeError(c, error) }
  })

  routes.get('/admin/runs/:runId/diagnostics', async (c) => {
    try {
      // Never infer admin authority from a user-controlled header. The hosting
      // application must set this through its trusted auth middleware or pass
      // the explicit route option when wiring the desktop/admin runtime.
      const isAdmin = options.isAdmin?.(c) ?? (c as any).get('isAdmin') === true
      if (!isAdmin) return errorResponse(c, 403, 'RESEARCH_DIAGNOSTICS_FORBIDDEN', 'Administrator access is required for Run diagnostics.')
      const diagnostics = await module.getRunDiagnostics(c.req.param('runId'))
      return diagnostics
        ? c.json({ data: toPublicResearchRunDiagnostics(diagnostics) })
        : errorResponse(c, 404, 'RESEARCH_RUN_NOT_FOUND', 'Deep Research Run not found: ' + c.req.param('runId'))
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId', async (c) => {
    try {
      const run = await requireRun(c, module, c.req.param('runId'))
      return isResponse(run) ? run : c.json({ data: toPublicResearchRunDetail(run) })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/events', async (c) => {
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: (await module.listEvents(runId, parseAfter(c.req.query('after')))).map(toPublicResearchEvent) })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/stream', async (c) => {
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
          const publicEvent = toPublicResearchEvent(event)
          writeTail = writeTail.then(() => stream.writeSSE({
            // Numeric sequence keeps Last-Event-ID replay compatible; eventId in data is the V2 dedupe key.
            id: String(publicEvent.sequence),
            event: publicEvent.type,
            data: JSON.stringify(publicEvent),
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

  routes.get('/runs/:runId/attempts', async (c) => {
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: await module.listAttemptHistory(runId, parseHistoryQuery(c)) })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/checkpoints', async (c) => {
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: await module.listCheckpointHistory(runId, parseHistoryQuery(c)) })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/iterations', async (c) => {
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: await module.listIterationHistory(runId, parseHistoryQuery(c)) })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/assessments', async (c) => {
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: await module.listAssessmentHistory(runId, parseHistoryQuery(c)) })
    } catch (error) { return routeError(c, error) }
  })

  routes.post('/runs/:runId/clarifications', async (c) => {
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      const input = clarificationSchema.parse(await readJson(c))
      return c.json({ data: toPublicResearchRun(await module.answerClarification(runId, input)) })
    } catch (error) { return routeError(c, error) }
  })

  routes.post('/runs/:runId/cancel', async (c) => {
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: toPublicResearchRun(await module.cancelRun(runId)) })
    } catch (error) { return routeError(c, error) }
  })

  routes.post('/runs/:runId/resume', async (c) => {
    try {
      const runId = c.req.param('runId')
      const run = await requireRun(c, module, runId)
      if (isResponse(run)) return run
      return c.json({ data: toPublicResearchRun(await module.resumeRun(runId)) })
    } catch (error) { return routeError(c, error) }
  })

  routes.get('/runs/:runId/artifacts/:artifactId', async (c) => {
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
