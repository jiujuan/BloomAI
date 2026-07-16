import { and, desc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type {
  JsonObject,
  ResearchArtifactDto,
  ResearchBriefDto,
  ResearchBudgetDto,
  ResearchEventDto,
  ResearchProfile,
  ResearchQualityDto,
  ResearchRunDetailDto,
  ResearchRunDto,
  ResearchRunErrorDto,
  ResearchRunFilter,
  ResearchRunStatus,
  ResearchUsageDto,
  StartResearchInput,
} from '@shared/deepresearch/contracts'
import type { ResearchEventType } from '@shared/deepresearch/events'
import { assertResearchTransition } from '@server/deepresearch/domain/state-machine'
import { getOrmDb } from '../../client'
import {
  research_artifacts,
  research_claims,
  research_citations,
  research_evidence,
  research_events,
  research_questions,
  research_report_sections,
  research_search_queries,
  research_source_snapshots,
  research_sources,
  research_runs,
} from '../../schema'
import { appendResearchEventInTransaction } from './research-event.repo'
import { mapResearchEvidence } from './research-evidence.repo'
import { mapResearchEvent } from './research-event.repo'
import { mapResearchQuestion, mapResearchSearchQuery } from './research-question.repo'
import { mapResearchArtifact, mapResearchCitation, mapResearchClaim, mapResearchSection } from './research-report.repo'
import { mapResearchSnapshot, mapResearchSource } from './research-source.repo'
import { decodeJson, EMPTY_JSON_OBJECT, encodeJson, initialResearchUsage } from './repository-utils'

export interface CreateResearchRunInput {
  input: StartResearchInput
  budget: ResearchBudgetDto
  usage?: ResearchUsageDto
}

export interface TransitionResearchRunOptions {
  phase?: string
  progress?: number
  resumePhase?: string | null
  error?: ResearchRunErrorDto | null
  eventType?: ResearchEventType
  eventPayload?: JsonObject
}

function mapRun(row: typeof research_runs.$inferSelect): ResearchRunDto {
  const error = row.error_code
    ? { code: row.error_code, message: row.error_message ?? row.error_code, retryable: Boolean(row.error_retryable) }
    : null

  return {
    id: row.id,
    sessionId: row.session_id,
    topic: row.topic,
    profile: row.profile as ResearchProfile,
    depth: row.depth as ResearchRunDto['depth'],
    status: row.status as ResearchRunStatus,
    phase: row.phase,
    progress: row.progress,
    brief: row.brief_json ? decodeJson<ResearchBriefDto | null>(row.brief_json, null) : null,
    workflowRunId: row.workflow_run_id,
    budget: decodeJson<ResearchBudgetDto>(row.budget_json, {
      maxQuestions: 0,
      maxIterations: 0,
      maxSearchQueries: 0,
      maxNormalizedSources: 0,
      maxFetchedSources: 0,
      searchConcurrency: 0,
      fetchConcurrency: 0,
      maxDurationMs: 0,
    }),
    usage: decodeJson<ResearchUsageDto>(row.usage_json, initialResearchUsage()),
    quality: row.quality_json ? decodeJson<ResearchQualityDto | null>(row.quality_json, null) : null,
    reportArtifactId: row.report_artifact_id,
    resumePhase: row.resume_phase,
    error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function isTerminal(status: ResearchRunStatus): boolean {
  return status === 'completed' || status === 'completed_with_limitations' || status === 'cancelled'
}

export const researchRunRepo = {
  create(data: CreateResearchRunInput): ResearchRunDto {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(research_runs).values({
      id,
      session_id: data.input.sessionId ?? null,
      topic: data.input.topic,
      profile: data.input.profile,
      depth: data.input.depth,
      status: 'queued',
      phase: 'queued',
      progress: 0,
      input_json: encodeJson(data.input),
      brief_json: null,
      budget_json: encodeJson(data.budget),
      usage_json: encodeJson(data.usage ?? initialResearchUsage()),
      quality_json: null,
      workflow_run_id: null,
      report_artifact_id: null,
      resume_phase: null,
      executor_id: null,
      lease_expires_at: null,
      heartbeat_at: null,
      error_code: null,
      error_message: null,
      error_retryable: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    }).run()
    return this.get(id)!
  },

  get(id: string): ResearchRunDto | undefined {
    const row = getOrmDb().select().from(research_runs).where(eq(research_runs.id, id)).get()
    return row ? mapRun(row) : undefined
  },

  setWorkflowRunId(id: string, workflowRunId: string): ResearchRunDto {
    const result = getOrmDb().update(research_runs).set({
      workflow_run_id: workflowRunId,
      updated_at: Date.now(),
    }).where(eq(research_runs.id, id)).run()
    if (result.changes !== 1) throw new Error('Deep Research Run not found: ' + id)
    return this.get(id)!
  },

  setBrief(id: string, brief: ResearchBriefDto): ResearchRunDto {
    const result = getOrmDb().update(research_runs).set({
      brief_json: encodeJson(brief),
      updated_at: Date.now(),
    }).where(eq(research_runs.id, id)).run()
    if (result.changes !== 1) throw new Error('Deep Research Run not found: ' + id)
    return this.get(id)!
  },

  setUsage(id: string, usage: ResearchUsageDto): ResearchRunDto {
    const result = getOrmDb().update(research_runs).set({
      usage_json: encodeJson(usage),
      updated_at: Date.now(),
    }).where(eq(research_runs.id, id)).run()
    if (result.changes !== 1) throw new Error('Deep Research Run not found: ' + id)
    return this.get(id)!
  },

  list(filter: ResearchRunFilter = {}): ResearchRunDto[] {
    const conditions = []
    if (filter.sessionId) conditions.push(eq(research_runs.session_id, filter.sessionId))
    if (filter.statuses?.length) conditions.push(inArray(research_runs.status, filter.statuses))
    if (filter.profile) conditions.push(eq(research_runs.profile, filter.profile))
    if (filter.cursor && Number.isFinite(Number(filter.cursor))) conditions.push(lt(research_runs.created_at, Number(filter.cursor)))

    const query = getOrmDb().select().from(research_runs)
    const rows = conditions.length
      ? query.where(and(...conditions)).orderBy(desc(research_runs.created_at)).limit(filter.limit ?? 50).all()
      : query.orderBy(desc(research_runs.created_at)).limit(filter.limit ?? 50).all()
    return rows.map(mapRun)
  },

  transitionWithEvent(id: string, to: ResearchRunStatus, options: TransitionResearchRunOptions = {}): ResearchRunDto {
    return getOrmDb().transaction((tx) => {
      const currentRow = tx.select().from(research_runs).where(eq(research_runs.id, id)).get()
      if (!currentRow) throw new Error('Deep Research Run not found: ' + id)

      const current = mapRun(currentRow)
      assertResearchTransition(current.status, to)

      const now = Date.now()
      const phase = options.phase ?? to
      const updates: Record<string, unknown> = {
        status: to,
        phase,
        updated_at: now,
      }
      if (options.progress !== undefined) updates.progress = options.progress
      if (options.resumePhase !== undefined) updates.resume_phase = options.resumePhase
      if (options.error === null) {
        updates.error_code = null
        updates.error_message = null
        updates.error_retryable = null
      } else if (options.error) {
        updates.error_code = options.error.code
        updates.error_message = options.error.message
        updates.error_retryable = Number(options.error.retryable)
      }
      if (isTerminal(to)) updates.completed_at = now

      tx.update(research_runs).set(updates as typeof research_runs.$inferInsert).where(eq(research_runs.id, id)).run()
      appendResearchEventInTransaction(tx, {
        runId: id,
        type: options.eventType ?? 'research.run.status_changed',
        phase,
        payload: options.eventPayload ?? { from: current.status, to },
      })

      return mapRun(tx.select().from(research_runs).where(eq(research_runs.id, id)).get()!)
    })
  },

  acquireLease(id: string, executorId: string, leaseMs: number, now = Date.now()): boolean {
    const result = getOrmDb().update(research_runs).set({
      executor_id: executorId,
      lease_expires_at: now + leaseMs,
      heartbeat_at: now,
    }).where(and(
      eq(research_runs.id, id),
      or(
        isNull(research_runs.lease_expires_at),
        lte(research_runs.lease_expires_at, now),
        eq(research_runs.executor_id, executorId),
      ),
    )).run()
    return result.changes === 1
  },

  releaseLease(id: string, executorId: string): boolean {
    const result = getOrmDb().update(research_runs).set({
      executor_id: null,
      lease_expires_at: null,
      heartbeat_at: null,
    }).where(and(eq(research_runs.id, id), eq(research_runs.executor_id, executorId))).run()
    return result.changes === 1
  },

  delete(id: string): void {
    getOrmDb().delete(research_runs).where(eq(research_runs.id, id)).run()
  },

  getDetail(id: string): ResearchRunDetailDto | undefined {
    const run = this.get(id)
    if (!run) return undefined

    const database = getOrmDb()
    const questions = database.select().from(research_questions).where(eq(research_questions.run_id, id)).all().map(mapResearchQuestion)
    const searchQueries = database.select().from(research_search_queries).where(eq(research_search_queries.run_id, id)).all().map(mapResearchSearchQuery)
    const sources = database.select().from(research_sources).where(eq(research_sources.run_id, id)).all().map(mapResearchSource)
    const snapshots = database.select().from(research_source_snapshots).where(eq(research_source_snapshots.run_id, id)).all().map(mapResearchSnapshot)
    const evidence = database.select().from(research_evidence).where(eq(research_evidence.run_id, id)).all().map(mapResearchEvidence)
    const sections = database.select().from(research_report_sections).where(eq(research_report_sections.run_id, id)).all().map(mapResearchSection)
    const claims = database.select().from(research_claims).where(eq(research_claims.run_id, id)).all().map(mapResearchClaim)
    const citations = database.select().from(research_citations).where(eq(research_citations.run_id, id)).all().map(mapResearchCitation)
    const events = database.select().from(research_events).where(eq(research_events.run_id, id)).all().map(mapResearchEvent)
    const artifacts = database.select().from(research_artifacts).where(eq(research_artifacts.run_id, id)).all().map(mapResearchArtifact)

    return {
      ...run,
      questions,
      searchQueries,
      sources,
      snapshots,
      evidence,
      report: sections.length || claims.length || citations.length
        ? { runId: id, title: run.brief?.title ?? run.topic, sections, claims, citations, generatedAt: run.completedAt }
        : null,
      events,
      artifacts,
    }
  },
}
