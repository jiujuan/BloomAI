import { and, asc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ResearchEvidenceDto } from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { research_evidence } from '../../schema'

export interface UpsertResearchEvidenceInput {
  runId: string
  questionId: string
  snapshotId: string
  passage: string
  summary: string
  stance: ResearchEvidenceDto['stance']
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
    snapshotId: row.snapshot_id,
    passage: row.passage,
    summary: row.summary,
    stance: row.stance as ResearchEvidenceDto['stance'],
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
        snapshot_id: input.snapshotId,
        passage: input.passage,
        summary: input.summary,
        stance: input.stance,
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
