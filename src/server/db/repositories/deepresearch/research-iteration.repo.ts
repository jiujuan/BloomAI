import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { JsonObject, ResearchBudgetReservationDto, ResearchEventDto, ResearchIterationDto, ResearchIterationPlanDto, ResearchIterationStatus, ResearchLoopDecision, ResearchLoopDecisionDto } from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { publishResearchEvent } from '@server/deepresearch/research-event-publisher'
import { research_iterations, research_runs } from '../../schema'
import { appendResearchEventInTransaction, researchEventRepo } from './research-event.repo'
import { decodeJson, encodeJson, EMPTY_JSON_OBJECT, initialResearchUsage } from './repository-utils'
import { applyBudgetSettlementToUsage, createBudgetSnapshot, reserveBudget, settleBudgetReservation as settleReservation } from '@server/deepresearch/domain/budget-reservation'
import { ResearchDomainError } from '@server/deepresearch/domain/errors'

type TransactionExecutor = any

export interface ResearchIterationRecord extends ResearchIterationDto {
  coverageBefore: JsonObject
  coverageAfter: JsonObject
  plan: ResearchIterationPlanDto
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
export interface ReserveResearchIterationInput {
  runId: string
  plan: ResearchIterationPlanDto
  coverageBefore?: JsonObject
  createdAt?: number
}

export interface SettleResearchIterationReservationInput {
  actual: ResearchBudgetReservationDto
  status: Extract<ResearchIterationStatus, 'completed' | 'stopped'>
  decision?: ResearchLoopDecision
  stopReason?: ResearchLoopDecisionDto | null
  coverageAfter?: JsonObject
  limitations?: string[]
  completedAt?: number
}

export interface RecordResearchIterationStopDecisionInput {
  runId: string
  stopReason: ResearchLoopDecisionDto
  timestamp?: number
}

export interface ResearchIterationStopDecisionAuditRecord {
  runId: string
  sequence: number
  timestamp: number
  iteration: number | null
  decision: ResearchLoopDecisionDto
}

function isReservation(value: unknown): value is ResearchBudgetReservationDto {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['iterations', 'searchQueries', 'fetchedSources', 'modelTokens', 'providerCostUsd']
    .every((key) => typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0)
}

function readActiveReservations(rows: Array<typeof research_iterations.$inferSelect>, excludeId?: string): ResearchBudgetReservationDto[] {
  return rows
    .filter((row) => row.id !== excludeId && (row.status === 'planned' || row.status === 'executing' || row.status === 'assessed'))
    .flatMap((row) => {
      const plan = decodeJson<Record<string, unknown>>(row.plan_json, EMPTY_JSON_OBJECT)
      return isReservation(plan.reservation) ? [plan.reservation] : []
    })
}

function toJson(value: unknown): JsonObject {
  return value as JsonObject
}

function requireStopDecisionAudit(value: ResearchLoopDecisionDto | null | undefined): ResearchLoopDecisionDto {
  if (!value || value.decision === 'continue' || !value.matchedRule || !value.inputSummary) {
    throw new ResearchDomainError(
      'RESEARCH_VALIDATION_ERROR',
      'Stopped iterations require a structured stop decision audit with matchedRule and inputSummary.',
      false,
    )
  }
  return { ...value, limitations: value.limitations ?? [] }
}

function stopDecisionAuditPayload(iteration: number | null, stopReason: ResearchLoopDecisionDto): JsonObject {
  const audit = requireStopDecisionAudit(stopReason)
  return toJson({
    iteration,
    decision: audit.decision,
    matchedRule: audit.matchedRule,
    inputSummary: audit.inputSummary,
    limitations: audit.limitations ?? [],
    stopDecision: audit,
  })
}

function mapStopDecisionAudit(event: ResearchEventDto): ResearchIterationStopDecisionAuditRecord | null {
  if (event.type !== 'research.iteration.stop_decided' && event.type !== 'research.iteration.stopped') return null
  const payload = event.payload as Record<string, unknown>
  const stopReason = payload.stopDecision as ResearchLoopDecisionDto | undefined
  if (!stopReason) return null
  try {
    const audit = requireStopDecisionAudit(stopReason)
    return {
      runId: event.runId,
      sequence: event.sequence,
      timestamp: event.timestamp,
      iteration: typeof payload.iteration === 'number' ? payload.iteration : null,
      decision: audit,
    }
  } catch {
    // Historical stopped events did not contain the additive DR2-07 audit payload.
    return null
  }
}

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
    plan: decodeJson<ResearchIterationPlanDto>(row.plan_json, EMPTY_JSON_OBJECT as unknown as ResearchIterationPlanDto),
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

  /**
   * Atomically writes a planned iteration and its capacity reservation. Active
   * planned/executing/assessed reservations are included in the same transaction,
   * so concurrent planners cannot overbook a Run budget.
   */
  reserve(input: ReserveResearchIterationInput): ResearchIterationRecord {
    const result = getOrmDb().transaction((tx) => {
      const run = tx.select().from(research_runs).where(eq(research_runs.id, input.runId)).get()
      if (!run) throw new Error('Deep Research Run not found: ' + input.runId)
      const budget = decodeJson(run.budget_json, EMPTY_JSON_OBJECT) as unknown as import('@shared/deepresearch/contracts').ResearchBudgetDto
      const usage = decodeJson(run.usage_json, initialResearchUsage())
      const existing = tx.select().from(research_iterations).where(eq(research_iterations.run_id, input.runId)).all()
      const reservation = reserveBudget({
        budget,
        usage,
        existingReservations: readActiveReservations(existing),
        requested: input.plan.reservation,
      })
      if (!reservation.ok) {
        throw new ResearchDomainError(
          'RESEARCH_BUDGET_EXHAUSTED',
          'Deep Research iteration reservation exceeds: ' + reservation.exhausted.join(', '),
          false,
        )
      }

      const id = uuidv4()
      const createdAt = input.createdAt ?? Date.now()
      const ordinal = nextOrdinal(tx, input.runId)
      tx.insert(research_iterations).values({
        id,
        run_id: input.runId,
        ordinal,
        status: 'planned',
        decision: 'continue',
        target_question_ids_json: encodeJson([...new Set(input.plan.targets.map((target) => target.questionId))].sort()),
        coverage_before_json: encodeJson(input.coverageBefore ?? EMPTY_JSON_OBJECT),
        coverage_after_json: encodeJson(EMPTY_JSON_OBJECT),
        plan_json: encodeJson(toJson(input.plan)),
        planned_query_count: input.plan.targets.length,
        executed_query_count: 0,
        new_source_count: 0,
        new_evidence_count: 0,
        budget_before_json: encodeJson(toJson(reservation.before)),
        budget_after_json: encodeJson(EMPTY_JSON_OBJECT),
        stop_reason_json: null,
        limitations_json: encodeJson([]),
        created_at: createdAt,
        completed_at: null,
      }).run()
      const event = appendResearchEventInTransaction(tx, {
        runId: input.runId,
        type: 'research.iteration.planned',
        phase: 'gap_filling',
        timestamp: createdAt,
        payload: { iteration: ordinal, targetQuestionIds: [...new Set(input.plan.targets.map((target) => target.questionId))].sort() },
      })
      return { iteration: mapResearchIteration(tx.select().from(research_iterations).where(eq(research_iterations.id, id)).get()!), event }
    })
    publishResearchEvent(result.event)
    return result.iteration
  },

  /**
   * Settles the actual cost of a reservation. The unused capacity is released by
   * moving the iteration out of the active reservation states in the same
   * transaction that persists actual Run usage and the stop audit record.
   */
  settleReservation(id: string, input: SettleResearchIterationReservationInput): ResearchIterationRecord | undefined {
    const result = getOrmDb().transaction((tx) => {
      const current = tx.select().from(research_iterations).where(eq(research_iterations.id, id)).get()
      if (!current) return undefined
      if (current.status !== 'planned' && current.status !== 'executing' && current.status !== 'assessed') {
        throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Only an active iteration reservation can be settled.', false)
      }
      const persistedStopReason = current.stop_reason_json
        ? decodeJson<ResearchLoopDecisionDto | null>(current.stop_reason_json, null)
        : null
      const stopDecisionAudit = input.status === 'stopped'
        ? requireStopDecisionAudit(input.stopReason === undefined ? persistedStopReason : input.stopReason)
        : null
      const plan = decodeJson<Record<string, unknown>>(current.plan_json, EMPTY_JSON_OBJECT)
      if (!isReservation(plan.reservation)) {
        throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', 'Iteration has no valid budget reservation.', false)
      }
      const settlement = settleReservation(plan.reservation, input.actual)
      const run = tx.select().from(research_runs).where(eq(research_runs.id, current.run_id)).get()
      if (!run) throw new Error('Deep Research Run not found: ' + current.run_id)
      const budget = decodeJson(run.budget_json, EMPTY_JSON_OBJECT) as unknown as import('@shared/deepresearch/contracts').ResearchBudgetDto
      const usage = decodeJson(run.usage_json, initialResearchUsage())
      const nextUsage = applyBudgetSettlementToUsage(usage, settlement)
      const allIterations = tx.select().from(research_iterations).where(eq(research_iterations.run_id, current.run_id)).all()
      const after = createBudgetSnapshot(budget, nextUsage, readActiveReservations(allIterations, id))
      const completedAt = input.completedAt ?? Date.now()
      const nextPlan: ResearchIterationPlanDto = {
        ...(plan as unknown as ResearchIterationPlanDto),
        reservation: plan.reservation,
        settlement,
      }
      tx.update(research_runs).set({
        usage_json: encodeJson(nextUsage),
        updated_at: completedAt,
      }).where(eq(research_runs.id, current.run_id)).run()
      tx.update(research_iterations).set({
        status: input.status,
        decision: input.status === 'stopped' ? (input.decision ?? stopDecisionAudit!.decision) : (input.decision ?? current.decision),
        coverage_after_json: input.coverageAfter === undefined ? current.coverage_after_json : encodeJson(input.coverageAfter),
        plan_json: encodeJson(toJson(nextPlan)),
        budget_after_json: encodeJson(toJson(after)),
        stop_reason_json: input.status === 'stopped' ? encodeJson(stopDecisionAudit!) : (input.stopReason === undefined ? current.stop_reason_json : input.stopReason ? encodeJson(input.stopReason) : null),
        limitations_json: input.status === 'stopped' ? encodeJson(input.limitations ?? stopDecisionAudit!.limitations ?? []) : (input.limitations === undefined ? current.limitations_json : encodeJson(input.limitations)),
        completed_at: completedAt,
      }).where(eq(research_iterations.id, id)).run()
      const updated = tx.select().from(research_iterations).where(eq(research_iterations.id, id)).get()!
      const event = input.status === 'stopped'
        ? appendResearchEventInTransaction(tx, {
          runId: current.run_id,
          type: 'research.iteration.stopped',
          phase: 'gap_filling',
          timestamp: completedAt,
          payload: stopDecisionAuditPayload(current.ordinal, stopDecisionAudit!),
        })
        : null
      return { iteration: mapResearchIteration(updated), event }
    })
    if (result?.event) publishResearchEvent(result.event)
    return result?.iteration
  },
  get(id: string): ResearchIterationRecord | undefined {
    const row = getOrmDb().select().from(research_iterations).where(eq(research_iterations.id, id)).get()
    return row ? mapResearchIteration(row) : undefined
  },

  list(runId: string): ResearchIterationRecord[] {
    return getOrmDb().select().from(research_iterations).where(eq(research_iterations.run_id, runId))
      .orderBy(asc(research_iterations.ordinal)).all().map(mapResearchIteration)
  },

  recordStopDecision(input: RecordResearchIterationStopDecisionInput): ResearchIterationStopDecisionAuditRecord {
    const audit = requireStopDecisionAudit(input.stopReason)
    const event = researchEventRepo.append({
      runId: input.runId,
      type: 'research.iteration.stop_decided',
      phase: 'gap_filling',
      timestamp: input.timestamp,
      payload: stopDecisionAuditPayload(null, audit),
    })
    const record = mapStopDecisionAudit(event)
    if (!record) throw new Error('Unable to map persisted iteration stop decision audit.')
    return record
  },

  listStopDecisions(runId: string): ResearchIterationStopDecisionAuditRecord[] {
    return researchEventRepo.list(runId).flatMap((event) => {
      const audit = mapStopDecisionAudit(event)
      return audit ? [audit] : []
    })
  },

  update(id: string, input: UpdateResearchIterationInput): ResearchIterationRecord | undefined {
    const result = getOrmDb().transaction((tx) => {
      const current = tx.select().from(research_iterations).where(eq(research_iterations.id, id)).get()
      if (!current) return undefined
      const persistedStopReason = current.stop_reason_json
        ? decodeJson<ResearchLoopDecisionDto | null>(current.stop_reason_json, null)
        : null
      const stopDecisionAudit = input.status === 'stopped'
        ? requireStopDecisionAudit(input.stopReason === undefined ? persistedStopReason : input.stopReason)
        : null
      const updates: Record<string, unknown> = {}
      if (input.status !== undefined) updates.status = input.status
      if (input.status === 'stopped') updates.decision = input.decision ?? stopDecisionAudit!.decision
      else if (input.decision !== undefined) updates.decision = input.decision
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
      if (input.status === 'stopped') updates.stop_reason_json = encodeJson(stopDecisionAudit!)
      else if (input.stopReason !== undefined) updates.stop_reason_json = input.stopReason ? encodeJson(input.stopReason) : null
      if (input.status === 'stopped') updates.limitations_json = encodeJson(input.limitations ?? stopDecisionAudit!.limitations ?? [])
      else if (input.limitations !== undefined) updates.limitations_json = encodeJson(input.limitations)
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
          payload: stopDecisionAuditPayload(current.ordinal, stopDecisionAudit!),
        })
        : null
      return { iteration: mapResearchIteration(updated), event }
    })
    if (result?.event) publishResearchEvent(result.event)
    return result?.iteration
  },
}
