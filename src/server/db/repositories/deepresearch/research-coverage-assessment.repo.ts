import { and, desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type {
  ResearchCoverageAssessmentDto,
  ResearchCoverageAssessmentV2Dto,
  ResearchCoverageDto,
  ResearchEventDto,
  ResearchQuestionCoverageVerdictDto,
  ResearchQuestionDto,
} from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { publishResearchEvent } from '@server/deepresearch/research-event-publisher'
import {
  research_coverage_assessments,
  research_iterations,
  research_questions,
  research_run_attempts,
  research_runs,
} from '../../schema'
import { appendResearchCheckpointInTransaction, type AppendResearchCheckpointInput } from './research-checkpoint.repo'
import { appendResearchEventInTransaction } from './research-event.repo'
import { updateResearchQuestionCoverageInTransaction } from './research-question.repo'
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

export interface PersistResearchCoverageAssessmentInput {
  id?: string
  runId: string
  attemptId: string
  iterationId?: string | null
  iteration: number
  policyVersion: 'v2'
  inputFingerprint: string
  aggregateScore: number
  questionAssessments: ResearchCoverageAssessmentV2Dto[]
  coverageProjections: ResearchCoverageDto[]
  limitations: string[]
  checkpoint: Omit<AppendResearchCheckpointInput, 'runId' | 'attemptId' | 'createdAt'>
  createdAt?: number
}

export interface PersistResearchCoverageAssessmentResult {
  assessment: ResearchCoverageAssessmentDto
  created: boolean
}

function mapQuestionVerdict(assessment: ResearchCoverageAssessmentV2Dto): ResearchQuestionCoverageVerdictDto {
  return {
    questionId: assessment.questionId,
    score: assessment.score,
    verdict: assessment.verdict === 'blocked' ? 'limited' : assessment.verdict,
    gapCodes: assessment.gaps.map((gap) => gap.code),
    limitations: assessment.limitation ? [assessment.limitation] : [],
  }
}

export function mapResearchCoverageAssessment(row: typeof research_coverage_assessments.$inferSelect): ResearchCoverageAssessmentDto {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    iterationId: row.iteration_id,
    iteration: row.iteration_ordinal,
    policyVersion: row.policy_version,
    inputFingerprint: row.input_fingerprint,
    aggregateScore: row.aggregate_score,
    questionVerdicts: decodeJson<ResearchQuestionCoverageVerdictDto[]>(row.question_verdicts_json, []),
    questionAssessments: decodeJson<ResearchCoverageAssessmentV2Dto[]>(row.assessment_v2_json, []),
    coverageProjections: decodeJson<ResearchCoverageDto[]>(row.coverage_projections_json, []),
    limitations: decodeJson<string[]>(row.limitations_json, []),
    createdAt: row.created_at,
  }
}

function findIdempotent(executor: TransactionExecutor, input: Pick<SaveResearchCoverageAssessmentInput, 'runId' | 'iteration' | 'policyVersion' | 'inputFingerprint'>) {
  return executor.select().from(research_coverage_assessments).where(and(
    eq(research_coverage_assessments.run_id, input.runId),
    eq(research_coverage_assessments.iteration_ordinal, input.iteration),
    eq(research_coverage_assessments.policy_version, input.policyVersion),
    eq(research_coverage_assessments.input_fingerprint, input.inputFingerprint),
  )).get()
}

function assertConsistentProjection(input: PersistResearchCoverageAssessmentInput): void {
  const assessmentIds = new Set(input.questionAssessments.map((item) => item.questionId))
  const projectionIds = new Set(input.coverageProjections.map((item) => item.questionId))
  if (assessmentIds.size !== input.questionAssessments.length || projectionIds.size !== input.coverageProjections.length) {
    throw new Error('Deep Research assessment contains duplicate question projections.')
  }
  if (assessmentIds.size !== projectionIds.size || [...assessmentIds].some((id) => !projectionIds.has(id))) {
    throw new Error('Deep Research assessment and V1 question projections must address the same questions.')
  }
}

export const researchCoverageAssessmentRepo = {
  /**
   * Legacy audit-only write retained for compatibility. New workflow writes must
   * use persistAndProject so assessment, V1 projection, event and checkpoint are
   * committed atomically.
   */
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

  /**
   * Persists one complete V2 assessment and its V1 question projections as one
   * transaction. Events and checkpoint are appended only after those business
   * writes succeed; a matching fingerprint returns the previous committed result.
   */
  persistAndProject(input: PersistResearchCoverageAssessmentInput): PersistResearchCoverageAssessmentResult {
    assertConsistentProjection(input)
    const result = getOrmDb().transaction((tx) => {
      const attempt = tx.select().from(research_run_attempts)
        .where(eq(research_run_attempts.id, input.attemptId)).get()
      if (!attempt || attempt.run_id !== input.runId) {
        throw new Error('Deep Research Attempt does not belong to coverage assessment Run: ' + input.attemptId)
      }
      if (input.iterationId) {
        const iteration = tx.select().from(research_iterations)
          .where(eq(research_iterations.id, input.iterationId)).get()
        if (!iteration || iteration.run_id !== input.runId) {
          throw new Error('Deep Research Iteration does not belong to coverage assessment Run: ' + input.iterationId)
        }
      }

      const existing = findIdempotent(tx, input)
      if (existing) return { assessment: mapResearchCoverageAssessment(existing), created: false, events: [] as ResearchEventDto[] }

      const createdAt = input.createdAt ?? Date.now()
      const id = input.id ?? uuidv4()
      const questions = tx.select().from(research_questions)
        .where(eq(research_questions.run_id, input.runId)).all()
      const questionById = new Map(questions.map((question) => [question.id, question]))
      for (const projection of input.coverageProjections) {
        if (!questionById.has(projection.questionId)) {
          throw new Error('Deep Research Question not found for coverage projection: ' + projection.questionId)
        }
      }

      const questionVerdicts = input.questionAssessments.map(mapQuestionVerdict)
      tx.insert(research_coverage_assessments).values({
        id,
        run_id: input.runId,
        attempt_id: input.attemptId,
        iteration_id: input.iterationId ?? null,
        iteration_ordinal: input.iteration,
        policy_version: input.policyVersion,
        input_fingerprint: input.inputFingerprint,
        aggregate_score: input.aggregateScore,
        question_verdicts_json: encodeJson(questionVerdicts),
        assessment_v2_json: encodeJson(input.questionAssessments),
        coverage_projections_json: encodeJson(input.coverageProjections),
        limitations_json: encodeJson(input.limitations),
        created_at: createdAt,
      }).run()

      for (const projection of input.coverageProjections) {
        const verdict = input.questionAssessments.find((item) => item.questionId === projection.questionId)!
        const status: ResearchQuestionDto['status'] = verdict.verdict === 'covered'
          ? 'covered'
          : verdict.verdict === 'uncovered'
            ? 'researching'
            : 'limited'
        updateResearchQuestionCoverageInTransaction(tx, projection.questionId, { coverage: projection, status, updatedAt: createdAt })
      }

      const assessment = mapResearchCoverageAssessment(tx.select().from(research_coverage_assessments).where(eq(research_coverage_assessments.id, id)).get()!)
      const appended = appendResearchCheckpointInTransaction(tx, {
        ...input.checkpoint,
        runId: input.runId,
        attemptId: input.attemptId,
        createdAt,
      })
      tx.update(research_runs).set({
        current_attempt_id: input.attemptId,
        last_checkpoint_sequence: appended.checkpoint.sequence,
        resume_phase: appended.checkpoint.resumeCursor.nextPhase,
        updated_at: createdAt,
      }).where(eq(research_runs.id, input.runId)).run()

      // Coverage events are appended only after every business write succeeds.
      const events: ResearchEventDto[] = [appendResearchEventInTransaction(tx, {
        runId: input.runId,
        type: 'research.coverage.assessment_completed',
        phase: 'assessing_coverage',
        timestamp: createdAt,
        payload: { id, policyVersion: input.policyVersion },
      })]
      for (const verdict of questionVerdicts.filter((item) => item.gapCodes.length > 0)) {
        events.push(appendResearchEventInTransaction(tx, {
          runId: input.runId,
          type: 'research.coverage.gap_detected',
          phase: 'assessing_coverage',
          timestamp: createdAt,
          payload: { questionId: verdict.questionId, gapCodes: verdict.gapCodes },
        }))
      }
      if (appended.created) {
        events.push(appendResearchEventInTransaction(tx, {
          runId: input.runId,
          type: 'research.checkpoint.completed',
          phase: appended.checkpoint.phase,
          timestamp: createdAt,
          payload: { id: appended.checkpoint.id, checkpointKey: appended.checkpoint.checkpointKey, sequence: appended.checkpoint.sequence },
        }))
      }
      return { assessment, created: true, events }
    })
    for (const event of result.events) publishResearchEvent(event)
    return { assessment: result.assessment, created: result.created }
  },

  get(id: string): ResearchCoverageAssessmentDto | undefined {
    const row = getOrmDb().select().from(research_coverage_assessments).where(eq(research_coverage_assessments.id, id)).get()
    return row ? mapResearchCoverageAssessment(row) : undefined
  },

  getLatest(runId: string, iteration?: number): ResearchCoverageAssessmentDto | undefined {
    const conditions = [eq(research_coverage_assessments.run_id, runId)]
    if (iteration !== undefined) conditions.push(eq(research_coverage_assessments.iteration_ordinal, iteration))
    const row = getOrmDb().select().from(research_coverage_assessments).where(and(...conditions))
      .orderBy(desc(research_coverage_assessments.created_at), desc(research_coverage_assessments.id)).get()
    return row ? mapResearchCoverageAssessment(row) : undefined
  },

  list(runId: string): ResearchCoverageAssessmentDto[] {
    return getOrmDb().select().from(research_coverage_assessments).where(eq(research_coverage_assessments.run_id, runId))
      .orderBy(desc(research_coverage_assessments.created_at), desc(research_coverage_assessments.id)).all().map(mapResearchCoverageAssessment)
  },
}
