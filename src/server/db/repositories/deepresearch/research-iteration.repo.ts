import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { JsonObject, ResearchIterationDto, ResearchIterationStatus, ResearchLoopDecision, ResearchLoopDecisionDto } from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { publishResearchEvent } from '@server/deepresearch/research-event-publisher'
import { research_iterations } from '../../schema'
import { appendResearchEventInTransaction } from './research-event.repo'
import { decodeJson, encodeJson, EMPTY_JSON_OBJECT } from './repository-utils'

type TransactionExecutor = any

export interface ResearchIterationRecord extends ResearchIterationDto {
  coverageBefore: JsonObject
  coverageAfter: JsonObject
  plan: JsonObject
  budgetBefore: JsonObject
  budgetAfter: JsonObject
  limitations: string[]
}

export interface CreateResearchIterationInput {
  runId: string
  ordinal?: number
  status?: ResearchIterationStatus
  decision?: ResearchLoopDecision | null
  targetQuestionIds?: string[]
  coverageBefore?: JsonObject
  coverageAfter?: JsonObject
  plan?: JsonObject
  plannedQueryCount?: number
  executedQueryCount?: number
  newSourceCount?: number
  newEvidenceCount?: number
  budgetBefore?: JsonObject
  budgetAfter?: JsonObject
  stopReason?: ResearchLoopDecisionDto | null
  limitations?: string[]
  createdAt?: number
}

export type UpdateResearchIterationInput = Omit<Partial<CreateResearchIterationInput>, 'runId' | 'ordinal' | 'createdAt'> & { completedAt?: number | null }

export function mapResearchIteration(row: typeof research_iterations.$inferSelect): ResearchIterationRecord {
  return {
    id: row.id,
    runId: row.run_id,
    ordinal: row.ordinal,
    status: row.status as ResearchIterationStatus,
    decision: row.decision as ResearchLoopDecision | null,
    targetQuestionIds: decodeJson<string[]>(row.target_question_ids_json, []),
    plannedQueryCount: row.planned_query_count,
    executedQueryCount: row.executed_query_count,
    newSourceCount: row.new_source_count,
    newEvidenceCount: row.new_evidence_count,
    stopReason: row.stop_reason_json ? decodeJson<ResearchLoopDecisionDto | null>(row.stop_reason_json, null) : null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    coverageBefore: decodeJson<JsonObject>(row.coverage_before_json, EMPTY_JSON_OBJECT),
    coverageAfter: decodeJson<JsonObject>(row.coverage_after_json, EMPTY_JSON_OBJECT),
    plan: decodeJson<JsonObject>(row.plan_json, EMPTY_JSON_OBJECT),
    budgetBefore: decodeJson<JsonObject>(row.budget_before_json, EMPTY_JSON_OBJECT),
    budgetAfter: decodeJson<JsonObject>(row.budget_after_json, EMPTY_JSON_OBJECT),
    limitations: decodeJson<string[]>(row.limitations_json, []),
  }
}

function nextOrdinal(executor: TransactionExecutor, runId: string): number {
  const row = executor.select({ ordinal: sql<number>`coalesce(max(${research_iterations.ordinal}), 0)` }).from(research_iterations)
    .where(eq(research_iterations.run_id, runId)).get()
  return Number(row?.ordinal ?? 0) + 1
}

export const researchIterationRepo = {
  create(input: CreateResearchIterationInput): ResearchIterationRecord {
    const result = getOrmDb().transaction((tx) => {
      const id = uuidv4()
      const createdAt = input.createdAt ?? Date.now()
      const ordinal = input.ordinal ?? nextOrdinal(tx, input.runId)
      tx.insert(research_iterations).values({
        id,
        run_id: input.runId,
        ordinal,
        status: input.status ?? 'planned',
        decision: input.decision ?? null,
        target_question_ids_json: encodeJson(input.targetQuestionIds ?? []),
        coverage_before_json: encodeJson(input.coverageBefore ?? EMPTY_JSON_OBJECT),
        coverage_after_json: encodeJson(input.coverageAfter ?? EMPTY_JSON_OBJECT),
        plan_json: encodeJson(input.plan ?? EMPTY_JSON_OBJECT),
        planned_query_count: input.plannedQueryCount ?? 0,
        executed_query_count: input.executedQueryCount ?? 0,
        new_source_count: input.newSourceCount ?? 0,
        new_evidence_count: input.newEvidenceCount ?? 0,
        budget_before_json: encodeJson(input.budgetBefore ?? EMPTY_JSON_OBJECT),
        budget_after_json: encodeJson(input.budgetAfter ?? EMPTY_JSON_OBJECT),
        stop_reason_json: input.stopReason ? encodeJson(input.stopReason) : null,
        limitations_json: encodeJson(input.limitations ?? []),
        created_at: createdAt,
        completed_at: null,
      }).run()
      const event = appendResearchEventInTransaction(tx, {
        runId: input.runId,
        type: 'research.iteration.planned',
        phase: 'gap_filling',
        timestamp: createdAt,
        payload: { iteration: ordinal, targetQuestionIds: input.targetQuestionIds ?? [] },
      })
      return { iteration: mapResearchIteration(tx.select().from(research_iterations).where(eq(research_iterations.id, id)).get()!), event }
    })
    publishResearchEvent(result.event)
    return result.iteration
  },

  get(id: string): ResearchIterationRecord | undefined {
    const row = getOrmDb().select().from(research_iterations).where(eq(research_iterations.id, id)).get()
    return row ? mapResearchIteration(row) : undefined
  },

  list(runId: string): ResearchIterationRecord[] {
    return getOrmDb().select().from(research_iterations).where(eq(research_iterations.run_id, runId))
      .orderBy(asc(research_iterations.ordinal)).all().map(mapResearchIteration)
  },

  update(id: string, input: UpdateResearchIterationInput): ResearchIterationRecord | undefined {
    const result = getOrmDb().transaction((tx) => {
      const current = tx.select().from(research_iterations).where(eq(research_iterations.id, id)).get()
      if (!current) return undefined
      const updates: Record<string, unknown> = {}
      if (input.status !== undefined) updates.status = input.status
      if (input.decision !== undefined) updates.decision = input.decision
      if (input.targetQuestionIds !== undefined) updates.target_question_ids_json = encodeJson(input.targetQuestionIds)
      if (input.coverageBefore !== undefined) updates.coverage_before_json = encodeJson(input.coverageBefore)
      if (input.coverageAfter !== undefined) updates.coverage_after_json = encodeJson(input.coverageAfter)
      if (input.plan !== undefined) updates.plan_json = encodeJson(input.plan)
      if (input.plannedQueryCount !== undefined) updates.planned_query_count = input.plannedQueryCount
      if (input.executedQueryCount !== undefined) updates.executed_query_count = input.executedQueryCount
      if (input.newSourceCount !== undefined) updates.new_source_count = input.newSourceCount
      if (input.newEvidenceCount !== undefined) updates.new_evidence_count = input.newEvidenceCount
      if (input.budgetBefore !== undefined) updates.budget_before_json = encodeJson(input.budgetBefore)
      if (input.budgetAfter !== undefined) updates.budget_after_json = encodeJson(input.budgetAfter)
      if (input.stopReason !== undefined) updates.stop_reason_json = input.stopReason ? encodeJson(input.stopReason) : null
      if (input.limitations !== undefined) updates.limitations_json = encodeJson(input.limitations)
      const terminal = input.status === 'completed' || input.status === 'stopped'
      if (input.completedAt !== undefined) updates.completed_at = input.completedAt
      else if (terminal) updates.completed_at = Date.now()
      if (Object.keys(updates).length) tx.update(research_iterations).set(updates as typeof research_iterations.$inferInsert).where(eq(research_iterations.id, id)).run()
      const updated = tx.select().from(research_iterations).where(eq(research_iterations.id, id)).get()!
      const event = input.status === 'stopped'
        ? appendResearchEventInTransaction(tx, {
          runId: current.run_id,
          type: 'research.iteration.stopped',
          phase: 'gap_filling',
          payload: { iteration: current.ordinal, decision: input.decision ?? current.decision ?? 'stop_no_actionable_gaps' },
        })
        : null
      return { iteration: mapResearchIteration(updated), event }
    })
    if (result?.event) publishResearchEvent(result.event)
    return result?.iteration
  },
}
