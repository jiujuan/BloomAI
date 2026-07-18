import { and, asc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ResearchCoverageDto, ResearchQuestionDto, ResearchRunErrorDto, ResearchSearchQueryDto, ResearchSearchResultCandidateDto } from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { research_questions, research_search_queries } from '../../schema'
import { decodeJson, EMPTY_JSON_OBJECT, encodeJson } from './repository-utils'

export interface CreateResearchQuestionInput {
  runId: string
  parentQuestionId?: string | null
  ordinal: number
  question: string
  intent: string
  requiredEvidenceTypes: string[]
  priority: ResearchQuestionDto['priority']
  status?: ResearchQuestionDto['status']
  coverage?: ResearchCoverageDto | null
}

export interface CreateResearchSearchQueryInput {
  runId: string
  questionId: string
  iteration: number
  query: string
  provider?: string | null
  status?: ResearchSearchQueryDto['status']
  resultCount?: number
  error?: ResearchRunErrorDto | null
  idempotencyKey: string
  completedAt?: number | null
  candidates?: ResearchSearchResultCandidateDto[]
}

export function mapResearchQuestion(row: typeof research_questions.$inferSelect): ResearchQuestionDto {
  return {
    id: row.id,
    runId: row.run_id,
    parentQuestionId: row.parent_question_id,
    ordinal: row.ordinal,
    question: row.question,
    intent: row.intent,
    requiredEvidenceTypes: decodeJson<string[]>(row.required_evidence_types_json, []),
    priority: row.priority as ResearchQuestionDto['priority'],
    status: row.status as ResearchQuestionDto['status'],
    coverage: row.coverage_json ? decodeJson<ResearchCoverageDto | null>(row.coverage_json, null) : null,
  }
}

export function mapResearchSearchQuery(row: typeof research_search_queries.$inferSelect): ResearchSearchQueryDto {
  const error = row.error_code
    ? { code: row.error_code, message: row.error_message ?? row.error_code, retryable: Boolean(row.error_retryable) }
    : null

  return {
    id: row.id,
    runId: row.run_id,
    questionId: row.question_id,
    iteration: row.iteration,
    query: row.query,
    provider: row.provider,
    status: row.status as ResearchSearchQueryDto['status'],
    resultCount: row.result_count,
    error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    idempotencyKey: row.idempotency_key,
    candidates: decodeJson<ResearchSearchResultCandidateDto[]>(row.result_json, []),
  }
}

export function updateResearchQuestionCoverageInTransaction(
  executor: any,
  id: string,
  data: { coverage: ResearchCoverageDto; status: ResearchQuestionDto['status']; updatedAt: number },
): void {
  const result = executor.update(research_questions).set({
    coverage_json: encodeJson(data.coverage),
    status: data.status,
    updated_at: data.updatedAt,
  }).where(eq(research_questions.id, id)).run()
  if (result.changes !== 1) throw new Error('Deep Research Question not found: ' + id)
}
export const researchQuestionRepo = {
  create(input: CreateResearchQuestionInput): ResearchQuestionDto {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(research_questions).values({
      id,
      run_id: input.runId,
      parent_question_id: input.parentQuestionId ?? null,
      ordinal: input.ordinal,
      question: input.question,
      intent: input.intent,
      required_evidence_types_json: encodeJson(input.requiredEvidenceTypes),
      priority: input.priority,
      status: input.status ?? 'planned',
      coverage_json: input.coverage ? encodeJson(input.coverage) : null,
      created_at: now,
      updated_at: now,
    }).run()

    return this.get(id)!
  },

  get(id: string): ResearchQuestionDto | undefined {
    const row = getOrmDb().select().from(research_questions).where(eq(research_questions.id, id)).get()
    return row ? mapResearchQuestion(row) : undefined
  },

  list(runId: string): ResearchQuestionDto[] {
    return getOrmDb()
      .select()
      .from(research_questions)
      .where(eq(research_questions.run_id, runId))
      .orderBy(asc(research_questions.ordinal))
      .all()
      .map(mapResearchQuestion)
  },

  updateCoverage(id: string, data: { coverage: ResearchCoverageDto; status: ResearchQuestionDto['status'] }): ResearchQuestionDto {
    const result = getOrmDb().update(research_questions).set({
      coverage_json: encodeJson(data.coverage),
      status: data.status,
      updated_at: Date.now(),
    }).where(eq(research_questions.id, id)).run()
    if (result.changes !== 1) throw new Error('Deep Research Question not found: ' + id)
    return this.get(id)!
  },

  createSearchQuery(input: CreateResearchSearchQueryInput): ResearchSearchQueryDto {
    const existing = this.getSearchQueryByIdempotencyKey(input.runId, input.idempotencyKey)
    if (existing) return existing
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(research_search_queries).values({
      id,
      run_id: input.runId,
      question_id: input.questionId,
      iteration: input.iteration,
      query: input.query,
      provider: input.provider ?? null,
      status: input.status ?? 'queued',
      result_count: input.resultCount ?? 0,
      error_code: input.error?.code ?? null,
      error_message: input.error?.message ?? null,
      error_retryable: input.error ? Number(input.error.retryable) : null,
      idempotency_key: input.idempotencyKey,
      created_at: now,
      completed_at: input.completedAt ?? null,
      result_json: encodeJson(input.candidates ?? []),
    }).run()

    return this.getSearchQuery(id)!
  },

  updateSearchQuery(id: string, data: { provider?: string | null; status: ResearchSearchQueryDto['status']; resultCount?: number; error?: ResearchRunErrorDto | null; completedAt?: number | null; candidates?: ResearchSearchResultCandidateDto[] }): ResearchSearchQueryDto {
    const result = getOrmDb().update(research_search_queries).set({
      provider: data.provider ?? null,
      status: data.status,
      result_count: data.resultCount ?? 0,
      error_code: data.error?.code ?? null,
      error_message: data.error?.message ?? null,
      error_retryable: data.error ? Number(data.error.retryable) : null,
      completed_at: data.completedAt ?? null,
      result_json: encodeJson(data.candidates ?? this.getSearchQuery(id)?.candidates ?? []),
    }).where(eq(research_search_queries.id, id)).run()
    if (result.changes !== 1) throw new Error('Deep Research Search Query not found: ' + id)
    return this.getSearchQuery(id)!
  },

  getSearchQueryByIdempotencyKey(runId: string, idempotencyKey: string): ResearchSearchQueryDto | undefined {
    const row = getOrmDb()
      .select()
      .from(research_search_queries)
      .where(and(eq(research_search_queries.run_id, runId), eq(research_search_queries.idempotency_key, idempotencyKey)))
      .get()
    return row ? mapResearchSearchQuery(row) : undefined
  },
  getSearchQuery(id: string): ResearchSearchQueryDto | undefined {
    const row = getOrmDb().select().from(research_search_queries).where(eq(research_search_queries.id, id)).get()
    return row ? mapResearchSearchQuery(row) : undefined
  },

  listSearchQueries(runId: string): ResearchSearchQueryDto[] {
    return getOrmDb()
      .select()
      .from(research_search_queries)
      .where(eq(research_search_queries.run_id, runId))
      .orderBy(asc(research_search_queries.iteration), asc(research_search_queries.created_at))
      .all()
      .map(mapResearchSearchQuery)
  },
}
