import { createHash } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { JsonObject, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import type { CandidateSourceQualityAssessment, SourceCategory, SourceRejectionReason, SourceScoringMethod } from '@server/deepresearch/domain/source-quality'
import { getOrmDb } from '../../client'
import { research_source_assessments, research_source_snapshots, research_sources } from '../../schema'
import { decodeJson, EMPTY_JSON_OBJECT, encodeJson } from './repository-utils'

export interface CreateResearchSourceInput {
  runId: string
  canonicalUrl: string
  originalUrl?: string
  domain: string
  title?: string | null
  author?: string | null
  publisher?: string | null
  publishedAt?: number | null
  sourceType: string
  selectionStatus: ResearchSourceDto['selectionStatus']
  /** Keeps structured curation diagnostics while the public DTO remains JSON-safe. */
  scores: JsonObject | Record<string, unknown>
}


export interface ResearchSourceAssessmentRecord {
  id: string
  runId: string
  questionId: string
  queryId: string
  candidateKey: string
  canonicalUrl: string | null
  originalUrl: string
  domain: string
  title: string
  snippet: string
  category: SourceCategory
  scoringMethod: SourceScoringMethod
  scoreBreakdown: CandidateSourceQualityAssessment['scores']
  reasons: string[]
  rejectionReasons: SourceRejectionReason[]
  selectionStatus: 'discovered' | 'selected' | 'rejected'
  createdAt: number
  updatedAt: number
}

export interface RecordCandidateSourceAssessmentInput {
  runId: string
  questionId: string
  queryId: string
  canonicalUrl?: string | null
  originalUrl: string
  domain: string
  title: string
  snippet: string
  selectionStatus: ResearchSourceAssessmentRecord['selectionStatus']
  assessment: CandidateSourceQualityAssessment
}
export interface CreateResearchSnapshotInput {
  runId: string
  sourceId: string
  contentHash: string
  content: string
  metadata: JsonObject
  fetchedAt: number
  parserVersion: string
  finalUrl: string
  httpStatus?: number | null
  idempotencyKey: string
}

export function mapResearchSource(row: typeof research_sources.$inferSelect): ResearchSourceDto {
  return {
    id: row.id,
    runId: row.run_id,
    canonicalUrl: row.canonical_url,
    originalUrl: row.original_url,
    domain: row.domain,
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    publishedAt: row.published_at,
    sourceType: row.source_type,
    selectionStatus: row.selection_status as ResearchSourceDto['selectionStatus'],
    scores: decodeJson<JsonObject>(row.scores_json, EMPTY_JSON_OBJECT),
  }
}


function candidateKeyFor(input: Pick<RecordCandidateSourceAssessmentInput, 'queryId' | 'canonicalUrl' | 'originalUrl'>): string {
  const identity = input.canonicalUrl || input.originalUrl
  return createHash('sha256').update(`${input.queryId}\n${identity.normalize('NFKC').trim().toLowerCase()}`).digest('hex')
}

export function mapResearchSourceAssessment(row: typeof research_source_assessments.$inferSelect): ResearchSourceAssessmentRecord {
  return {
    id: row.id,
    runId: row.run_id,
    questionId: row.question_id,
    queryId: row.query_id,
    candidateKey: row.candidate_key,
    canonicalUrl: row.canonical_url,
    originalUrl: row.original_url,
    domain: row.domain,
    title: row.title,
    snippet: row.snippet,
    category: row.source_category as SourceCategory,
    scoringMethod: row.scoring_method as SourceScoringMethod,
    scoreBreakdown: decodeJson<CandidateSourceQualityAssessment['scores']>(row.score_breakdown_json, {
      relevance: 0, authority: 0, recency: 0, independence: 0, fetchability: 0, final: 0,
    }),
    reasons: decodeJson<string[]>(row.assessment_reasons_json, []),
    rejectionReasons: decodeJson<SourceRejectionReason[]>(row.rejection_reasons_json, []),
    selectionStatus: row.selection_status as ResearchSourceAssessmentRecord['selectionStatus'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
export function mapResearchSnapshot(row: typeof research_source_snapshots.$inferSelect): ResearchSourceSnapshotDto {
  return {
    id: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    contentHash: row.content_hash,
    content: row.content,
    metadata: decodeJson<JsonObject>(row.metadata_json, EMPTY_JSON_OBJECT),
    fetchedAt: row.fetched_at,
    parserVersion: row.parser_version,
    finalUrl: row.final_url,
    httpStatus: row.http_status,
  }
}

export const researchSourceRepo = {

  recordCandidateAssessment(input: RecordCandidateSourceAssessmentInput): ResearchSourceAssessmentRecord {
    const candidateKey = candidateKeyFor(input)
    return getOrmDb().transaction((tx) => {
      const existing = tx.select().from(research_source_assessments).where(and(
        eq(research_source_assessments.run_id, input.runId),
        eq(research_source_assessments.candidate_key, candidateKey),
      )).get()
      if (existing) return mapResearchSourceAssessment(existing)

      const id = uuidv4()
      const now = Date.now()
      tx.insert(research_source_assessments).values({
        id,
        run_id: input.runId,
        question_id: input.questionId,
        query_id: input.queryId,
        candidate_key: candidateKey,
        canonical_url: input.canonicalUrl ?? null,
        original_url: input.originalUrl,
        domain: input.domain,
        title: input.title,
        snippet: input.snippet,
        source_category: input.assessment.category,
        scoring_method: input.assessment.scoringMethod,
        score_breakdown_json: encodeJson(input.assessment.scores),
        assessment_reasons_json: encodeJson([...input.assessment.reasons]),
        rejection_reasons_json: encodeJson([...input.assessment.rejectionReasons]),
        selection_status: input.selectionStatus,
        created_at: now,
        updated_at: now,
      }).run()
      return mapResearchSourceAssessment(tx.select().from(research_source_assessments).where(eq(research_source_assessments.id, id)).get()!)
    })
  },

  listCandidateAssessments(runId: string, questionId?: string): ResearchSourceAssessmentRecord[] {
    const where = questionId
      ? and(eq(research_source_assessments.run_id, runId), eq(research_source_assessments.question_id, questionId))
      : eq(research_source_assessments.run_id, runId)
    return getOrmDb().select().from(research_source_assessments).where(where)
      .orderBy(asc(research_source_assessments.created_at)).all().map(mapResearchSourceAssessment)
  },
  createSource(input: CreateResearchSourceInput): ResearchSourceDto {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(research_sources).values({
      id,
      run_id: input.runId,
      canonical_url: input.canonicalUrl,
      original_url: input.originalUrl ?? input.canonicalUrl,
      domain: input.domain,
      title: input.title ?? null,
      author: input.author ?? null,
      publisher: input.publisher ?? null,
      published_at: input.publishedAt ?? null,
      source_type: input.sourceType,
      selection_status: input.selectionStatus,
      scores_json: encodeJson(input.scores),
      created_at: now,
      updated_at: now,
    }).run()

    return this.getSource(id)!
  },

  getSource(id: string): ResearchSourceDto | undefined {
    const row = getOrmDb().select().from(research_sources).where(eq(research_sources.id, id)).get()
    return row ? mapResearchSource(row) : undefined
  },

  getByCanonicalUrl(runId: string, canonicalUrl: string): ResearchSourceDto | undefined {
    const row = getOrmDb()
      .select()
      .from(research_sources)
      .where(and(eq(research_sources.run_id, runId), eq(research_sources.canonical_url, canonicalUrl)))
      .get()
    return row ? mapResearchSource(row) : undefined
  },

  listSources(runId: string): ResearchSourceDto[] {
    return getOrmDb()
      .select()
      .from(research_sources)
      .where(eq(research_sources.run_id, runId))
      .orderBy(asc(research_sources.created_at))
      .all()
      .map(mapResearchSource)
  },

  createSnapshot(input: CreateResearchSnapshotInput): ResearchSourceSnapshotDto {
    return getOrmDb().transaction((tx) => {
      const existingByIdempotencyKey = tx
        .select()
        .from(research_source_snapshots)
        .where(and(
          eq(research_source_snapshots.run_id, input.runId),
          eq(research_source_snapshots.idempotency_key, input.idempotencyKey),
        ))
        .get()
      if (existingByIdempotencyKey) return mapResearchSnapshot(existingByIdempotencyKey)

      const existingByContentHash = tx
        .select()
        .from(research_source_snapshots)
        .where(and(
          eq(research_source_snapshots.run_id, input.runId),
          eq(research_source_snapshots.content_hash, input.contentHash),
        ))
        .orderBy(asc(research_source_snapshots.created_at))
        .get()
      if (existingByContentHash) return mapResearchSnapshot(existingByContentHash)

      const id = uuidv4()
      tx.insert(research_source_snapshots).values({
        id,
        run_id: input.runId,
        source_id: input.sourceId,
        content_hash: input.contentHash,
        content: input.content,
        metadata_json: encodeJson(input.metadata),
        fetched_at: input.fetchedAt,
        parser_version: input.parserVersion,
        final_url: input.finalUrl,
        http_status: input.httpStatus ?? null,
        idempotency_key: input.idempotencyKey,
        created_at: Date.now(),
      }).run()

      return mapResearchSnapshot(tx.select().from(research_source_snapshots).where(eq(research_source_snapshots.id, id)).get()!)
    })
  },

  getSnapshotByContentHash(runId: string, contentHash: string): ResearchSourceSnapshotDto | undefined {
    const row = getOrmDb()
      .select()
      .from(research_source_snapshots)
      .where(and(eq(research_source_snapshots.run_id, runId), eq(research_source_snapshots.content_hash, contentHash)))
      .orderBy(asc(research_source_snapshots.created_at))
      .get()
    return row ? mapResearchSnapshot(row) : undefined
  },

  getLatestSnapshotForSource(runId: string, sourceId: string): ResearchSourceSnapshotDto | undefined {
    const row = getOrmDb()
      .select()
      .from(research_source_snapshots)
      .where(and(eq(research_source_snapshots.run_id, runId), eq(research_source_snapshots.source_id, sourceId)))
      .orderBy(desc(research_source_snapshots.created_at))
      .get()
    return row ? mapResearchSnapshot(row) : undefined
  },
  listSnapshots(runId: string): ResearchSourceSnapshotDto[] {
    return getOrmDb()
      .select()
      .from(research_source_snapshots)
      .where(eq(research_source_snapshots.run_id, runId))
      .orderBy(asc(research_source_snapshots.fetched_at))
      .all()
      .map(mapResearchSnapshot)
  },
}