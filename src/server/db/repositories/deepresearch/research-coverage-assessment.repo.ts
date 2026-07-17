import { and, desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ResearchCoverageAssessmentDto, ResearchQuestionCoverageVerdictDto } from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { publishResearchEvent } from '@server/deepresearch/research-event-publisher'
import { research_coverage_assessments } from '../../schema'
import { appendResearchEventInTransaction } from './research-event.repo'
import { decodeJson, encodeJson } from './repository-utils'

type TransactionExecutor = any

export interface SaveResearchCoverageAssessmentInput {
  id?: string
  runId: string
  iterationId?: string | null
  iteration: number
  policyVersion: string
  inputFingerprint: string
  aggregateScore: number
  questionVerdicts: ResearchQuestionCoverageVerdictDto[]
  limitations: string[]
  createdAt?: number
}

export function mapResearchCoverageAssessment(row: typeof research_coverage_assessments.$inferSelect): ResearchCoverageAssessmentDto {
  return {
    id: row.id,
    runId: row.run_id,
    iteration: row.iteration_ordinal,
    policyVersion: row.policy_version,
    inputFingerprint: row.input_fingerprint,
    aggregateScore: row.aggregate_score,
    questionVerdicts: decodeJson<ResearchQuestionCoverageVerdictDto[]>(row.question_verdicts_json, []),
    limitations: decodeJson<string[]>(row.limitations_json, []),
    createdAt: row.created_at,
  }
}

function findIdempotent(executor: TransactionExecutor, input: SaveResearchCoverageAssessmentInput) {
  return executor.select().from(research_coverage_assessments).where(and(
    eq(research_coverage_assessments.run_id, input.runId),
    eq(research_coverage_assessments.iteration_ordinal, input.iteration),
    eq(research_coverage_assessments.policy_version, input.policyVersion),
    eq(research_coverage_assessments.input_fingerprint, input.inputFingerprint),
  )).get()
}

export const researchCoverageAssessmentRepo = {
  save(input: SaveResearchCoverageAssessmentInput): ResearchCoverageAssessmentDto {
    const result = getOrmDb().transaction((tx) => {
      const existing = findIdempotent(tx, input)
      if (existing) return { assessment: mapResearchCoverageAssessment(existing), event: null }
      const id = input.id ?? uuidv4()
      const createdAt = input.createdAt ?? Date.now()
      tx.insert(research_coverage_assessments).values({
        id,
        run_id: input.runId,
        iteration_id: input.iterationId ?? null,
        iteration_ordinal: input.iteration,
        policy_version: input.policyVersion,
        input_fingerprint: input.inputFingerprint,
        aggregate_score: input.aggregateScore,
        question_verdicts_json: encodeJson(input.questionVerdicts),
        limitations_json: encodeJson(input.limitations),
        created_at: createdAt,
      }).run()
      const event = appendResearchEventInTransaction(tx, {
        runId: input.runId,
        type: 'research.coverage.assessment_completed',
        phase: 'assessing_coverage',
        timestamp: createdAt,
        payload: { id, policyVersion: input.policyVersion },
      })
      return { assessment: mapResearchCoverageAssessment(tx.select().from(research_coverage_assessments).where(eq(research_coverage_assessments.id, id)).get()!), event }
    })
    if (result.event) publishResearchEvent(result.event)
    return result.assessment
  },

  get(id: string): ResearchCoverageAssessmentDto | undefined {
    const row = getOrmDb().select().from(research_coverage_assessments).where(eq(research_coverage_assessments.id, id)).get()
    return row ? mapResearchCoverageAssessment(row) : undefined
  },

  getLatest(runId: string, iteration?: number): ResearchCoverageAssessmentDto | undefined {
    const conditions = [eq(research_coverage_assessments.run_id, runId)]
    if (iteration !== undefined) conditions.push(eq(research_coverage_assessments.iteration_ordinal, iteration))
    const row = getOrmDb().select().from(research_coverage_assessments).where(and(...conditions))
      .orderBy(desc(research_coverage_assessments.created_at)).get()
    return row ? mapResearchCoverageAssessment(row) : undefined
  },
}
