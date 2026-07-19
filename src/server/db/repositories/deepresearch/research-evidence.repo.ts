import { and, asc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ResearchEvidenceDto } from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { research_evidence } from '../../schema'
import { decodeJson, encodeJson } from './repository-utils'

export interface UpsertResearchEvidenceInput {
  runId: string
  questionId: string
  sourceId?: string
  snapshotId: string
  passage: string
  summary: string
  claim?: string
  evidenceType?: NonNullable<ResearchEvidenceDto['evidenceType']>
  entities?: string[]
  numbers?: NonNullable<ResearchEvidenceDto['numbers']>
  timeframe?: string | null
  stance: ResearchEvidenceDto['stance']
  relevance?: number
  confidence: number
  startOffset: number
  endOffset: number
  idempotencyKey: string
}

export function mapResearchEvidence(row: typeof research_evidence.$inferSelect): ResearchEvidenceDto {
  return {
    id: row.id,
    runId: row.run_id,
    questionId: row.question_id,
    sourceId: row.source_id,
    snapshotId: row.snapshot_id,
    passage: row.passage,
    summary: row.summary,
    claim: row.claim,
    evidenceType: row.evidence_type as NonNullable<ResearchEvidenceDto['evidenceType']>,
    entities: decodeJson<string[]>(row.entities_json, []),
    numbers: decodeJson<NonNullable<ResearchEvidenceDto['numbers']>>(row.numbers_json, []),
    timeframe: row.timeframe,
    stance: row.stance as ResearchEvidenceDto['stance'],
    relevance: row.relevance,
    confidence: row.confidence,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
  }
}

export const researchEvidenceRepo = {
  upsertEvidence(input: UpsertResearchEvidenceInput): ResearchEvidenceDto {
    return getOrmDb().transaction((tx) => {
      const existing = tx
        .select()
        .from(research_evidence)
        .where(and(
          eq(research_evidence.run_id, input.runId),
          eq(research_evidence.idempotency_key, input.idempotencyKey),
        ))
        .get()
      if (existing) return mapResearchEvidence(existing)

      const id = uuidv4()
      tx.insert(research_evidence).values({
        id,
        run_id: input.runId,
        question_id: input.questionId,
        source_id: input.sourceId ?? '',
        snapshot_id: input.snapshotId,
        passage: input.passage,
        summary: input.summary,
        claim: input.claim ?? input.summary,
        evidence_type: input.evidenceType ?? 'uncertain',
        entities_json: encodeJson(input.entities ?? []),
        numbers_json: encodeJson(input.numbers ?? []),
        timeframe: input.timeframe ?? null,
        stance: input.stance,
        relevance: input.relevance ?? input.confidence,
        confidence: input.confidence,
        start_offset: input.startOffset,
        end_offset: input.endOffset,
        idempotency_key: input.idempotencyKey,
        created_at: Date.now(),
      }).run()

      return mapResearchEvidence(tx.select().from(research_evidence).where(eq(research_evidence.id, id)).get()!)
    })
  },

  list(runId: string): ResearchEvidenceDto[] {
    return getOrmDb()
      .select()
      .from(research_evidence)
      .where(eq(research_evidence.run_id, runId))
      .orderBy(asc(research_evidence.created_at))
      .all()
      .map(mapResearchEvidence)
  },
}
