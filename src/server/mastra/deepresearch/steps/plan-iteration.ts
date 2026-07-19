import { createStep } from '@mastra/core/workflows'
import type { GapAnalyst } from '../agents/gap-analyst'
import { deepResearchTelemetryContext, type DeepResearchRepositories } from '../workflow-context'
import { recordDeepResearchBudgetExhausted, recordDeepResearchNoMaterialGain, recordDeepResearchStopReason } from '@server/telemetry/metrics'
import { logWarning } from '@server/logger/logger'
import { decideIteration, type ResearchIterationQueryCandidate } from '@server/deepresearch/domain/iteration-decision'
import { createIterationQueryFingerprint } from '@server/deepresearch/domain/idempotency'
import type { ResearchBudgetReservationDto, ResearchLoopDecisionDto } from '@shared/deepresearch/contracts'
import { iterationContextSchema, type IterationContext } from './iteration-context'
import { assertWorkflowNotCancelled, getWorkflowExecution } from './checkpoint-replay'
import { RESEARCH_QUERY_INTENTS, createQueryDedupeKey, dedupeResearchQueryPlans, type PlannedTopicQuery, type ResearchQueryIntent } from '../query-strategy'


function isPublicQueryIntent(value: string | null | undefined): value is ResearchQueryIntent {
  return typeof value === 'string' && (RESEARCH_QUERY_INTENTS as readonly string[]).includes(value)
}

function sourceTargetKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

function containsInternalCoverageDiagnostic(query: string): boolean {
  return /required\s+evidence\s+category|(?:^|\s)(?:primary_source|independent_source|recent_update|market_data|counterevidence)(?:\s|$)/iu.test(query)
}

/**
 * Allows follow-up work only when it changes the public query intent or reaches an
 * untried source target. This provides a final server-side guard even when an LLM
 * planner returns duplicated or unsafe text.
 */
export function prepareGapQueryCandidates(
  candidates: readonly ResearchIterationQueryCandidate[],
  existingQueries: ReadonlyArray<{ questionId: string; query: string; intent?: string | null; sourceTargets?: string[]; dedupeKey?: string }>,
): ResearchIterationQueryCandidate[] {
  const normalized = candidates
    .filter((candidate) => candidate.questionId.trim() && candidate.query.trim() && isPublicQueryIntent(candidate.intent))
    .filter((candidate) => !containsInternalCoverageDiagnostic(candidate.query))
    .map((candidate) => ({
      ...candidate,
      questionId: candidate.questionId.trim(),
      query: candidate.query.trim(),
      intent: candidate.intent!,
      sourceTargets: [...new Set((candidate.sourceTargets ?? []).map((target) => target.trim()).filter(Boolean))],
      dedupeKey: createQueryDedupeKey(candidate.query),
    })) as Array<ResearchIterationQueryCandidate & PlannedTopicQuery>

  const uniqueCandidates = dedupeResearchQueryPlans(normalized)
  return uniqueCandidates.filter((candidate) => {
    const priorForQuestion = existingQueries.filter((query) => query.questionId === candidate.questionId)
    const priorWithIntent = priorForQuestion.filter((query) => query.intent === candidate.intent)
    if (priorWithIntent.length === 0) {
      // A different intent is complementary by definition; exact legacy duplicates
      // still cannot be replayed because their dedupe key remains authoritative.
      return !priorForQuestion.some((query) => (query.dedupeKey || createQueryDedupeKey(query.query)) === candidate.dedupeKey)
    }
    const triedTargets = new Set(priorWithIntent.flatMap((query) => query.sourceTargets ?? []).map(sourceTargetKey))
    return candidate.sourceTargets.some((target) => !triedTargets.has(sourceTargetKey(target)))
  })
}

function activeReservations(repositories: DeepResearchRepositories, runId: string): ResearchBudgetReservationDto[] {
  return repositories.researchIterationRepo!.list(runId)
    .filter((iteration) => iteration.status === 'planned' || iteration.status === 'executing' || iteration.status === 'assessed')
    .flatMap((iteration) => iteration.plan ? [iteration.plan.reservation] : [])
}

function materialGainFromIteration(iteration: { coverageAfter: Record<string, unknown> }): boolean | null {
  return typeof iteration.coverageAfter.materialGain === 'boolean' ? iteration.coverageAfter.materialGain : null
}

/** Replays must not create a second audit record for the same persisted loop stop. */
function persistStopDecision(repositories: DeepResearchRepositories, runId: string, stopReason: ResearchLoopDecisionDto): ResearchLoopDecisionDto {
  const existing = repositories.researchIterationRepo!.listStopDecisions(runId)
    .find((audit) => audit.decision.decision === stopReason.decision && audit.decision.matchedRule === stopReason.matchedRule)
  if (existing) return existing.decision
  return repositories.researchIterationRepo!.recordStopDecision({ runId, stopReason }).decision
}

function appendStopCheckpoint(repositories: DeepResearchRepositories, runId: string, attemptId: string | null | undefined, iteration: number, decision: ResearchLoopDecisionDto): void {
  if (!attemptId) return
  repositories.researchCheckpointRepo.append({
    runId,
    attemptId,
    checkpointKey: `iteration:stop:${decision.decision}`,
    phase: 'gap_filling',
    status: 'completed',
    resumeCursor: { version: 1, nextPhase: 'building_outline', iteration },
    inputFingerprint: `iteration:stop:${decision.decision}:${decision.matchedRule}:${iteration}`,
    outputFingerprint: decision.reason,
    replayPolicy: 'reuse',
  })
}

function recordIterationStop(run: Parameters<typeof deepResearchTelemetryContext>[0], decision: ResearchLoopDecisionDto): void {
  if (decision.decision === 'continue') return
  recordDeepResearchStopReason(decision.decision, deepResearchTelemetryContext(run))
  if (decision.decision === 'stop_budget') {
    recordDeepResearchBudgetExhausted(deepResearchTelemetryContext(run))
    logWarning('deep-research.budget-limit', 'Deep Research stopped because a configured resource budget was exhausted.', {
      runId: run.id,
      depth: run.depth,
      phase: run.phase,
      decision: decision.decision,
      matchedRule: decision.matchedRule,
      usage: run.usage,
      budget: run.budget,
    })
  }
  if (decision.decision === 'stop_no_material_gain') recordDeepResearchNoMaterialGain(deepResearchTelemetryContext(run))
}

function appendPlanCheckpoint(repositories: DeepResearchRepositories, runId: string, attemptId: string | null | undefined, iteration: { id: string; ordinal: number }, queryIds: string[]): void {
  if (!attemptId) return
  const sortedQueryIds = [...queryIds].sort()
  repositories.researchCheckpointRepo.append({
    runId,
    attemptId,
    checkpointKey: `iteration:${iteration.ordinal}:retrieval-planned`,
    phase: 'gap_filling',
    status: 'completed',
    resumeCursor: { version: 1, nextPhase: 'gap_filling', iteration: iteration.ordinal, pendingQueryIds: sortedQueryIds },
    inputFingerprint: `iteration:${iteration.id}:plan:${sortedQueryIds.join(',')}`,
    outputFingerprint: iteration.id,
    replayPolicy: 'retry_incomplete',
  })
}

function stoppedContext(input: IterationContext, runId: string, run: { usage: { iterations: number }; budget: { maxIterations: number } }, decision: ResearchLoopDecisionDto): IterationContext {
  const stopReason = decision.decision === 'stop_covered'
  return {
    ...input,
    coverageComplete: input.coverageComplete || stopReason,
    marginalNewEvidenceCount: 0,
    cancelled: decision.decision === 'stop_cancelled',
    iterations: run.usage.iterations,
    maxIterations: run.budget.maxIterations,
    iterationId: null,
    queryIds: [],
    sourceIds: [],
    stopDecision: decision.decision === 'continue' ? null : decision.decision,
    limitations: decision.limitations ?? [],
  }
}

export async function planIteration(
  input: IterationContext,
  dependencies: { repositories: DeepResearchRepositories; gapAnalyst: GapAnalyst },
): Promise<IterationContext> {
  const { repositories, gapAnalyst } = dependencies
  const run = repositories.researchRunRepo.get(input.runId)
  if (!run) return { ...input, cancelled: true, iterationId: null, queryIds: [], sourceIds: [], stopDecision: 'stop_cancelled', limitations: ['The research run is no longer available.'] }

  const latest = repositories.researchCoverageAssessmentRepo.getLatest(run.id)
  const history = repositories.researchIterationRepo!.list(run.id).map((iteration) => ({
    ordinal: iteration.ordinal,
    status: iteration.status,
    decision: iteration.decision,
    completedAt: iteration.completedAt,
    // Coverage Policy V2, not raw evidence count, is the loop gain authority.
    materialGain: materialGainFromIteration(iteration),
  }))
  const decisionInput = {
    assessments: latest?.questionAssessments ?? [],
    previousAssessment: null,
    iterations: history,
    budget: run.budget,
    usage: run.usage,
    reservations: activeReservations(repositories, run.id),
    cancellationRequested: run.status === 'cancelling' || run.status === 'cancelled',
  }

  const existing = repositories.researchIterationRepo!.list(run.id)
    .find((iteration) => (iteration.status === 'planned' || iteration.status === 'executing' || iteration.status === 'assessed') && iteration.plan)

  // A persisted terminal decision is the replay boundary for the loop. Do not call
  // the GapAnalyst again after a prior stop (especially no-actionable-gaps), because
  // a resumed/replayed workflow must reuse durable audit state rather than create
  // another expensive provider side effect.
  const persistedStop = repositories.researchIterationRepo!.listStopDecisions(run.id)
    .at(-1)?.decision
  if (persistedStop && persistedStop.decision !== 'continue') {
    return stoppedContext(input, run.id, run, persistedStop)
  }

  // A reservation belongs to an in-progress iteration. Reuse it before evaluating
  // max-iteration capacity so recovery replays only incomplete durable work rather
  // than creating another plan or reissuing its provider calls. Cancellation still
  // wins and is audited below.
  if (existing && !decisionInput.cancellationRequested) {
    const queries = repositories.researchQuestionRepo.listSearchQueries(run.id).filter((query) => query.iteration === existing.ordinal)
    return { ...input, iterationId: existing.id, queryIds: queries.map((query) => query.id), iterations: run.usage.iterations, maxIterations: run.budget.maxIterations, stopDecision: null, limitations: [] }
  }

  // Evaluate hard stops before calling GapAnalyst (which may involve an expensive model).
  // An empty candidate list is only a preflight sentinel; the no-actionable result is
  // resolved after the real deterministic candidate plan is available.
  const preflight = decideIteration({ ...decisionInput, queryCandidates: [] })
  if (preflight.decision.decision !== 'stop_no_actionable_gaps') {
    const persisted = persistStopDecision(repositories, run.id, preflight.decision)
    recordIterationStop(run, persisted)
    appendStopCheckpoint(repositories, run.id, run.currentAttemptId, run.usage.iterations, persisted)
    return stoppedContext(input, run.id, run, persisted)
  }

  const questions = repositories.researchQuestionRepo.list(run.id)
  const existingQueries = repositories.researchQuestionRepo.listSearchQueries(run.id)
  assertWorkflowNotCancelled(repositories, run.id)
  const rawCandidates = await gapAnalyst.plan(run, questions, { signal: getWorkflowExecution(run.id)?.signal })
  assertWorkflowNotCancelled(repositories, run.id)
  const candidates = prepareGapQueryCandidates(rawCandidates, existingQueries)
  const decision = decideIteration({ ...decisionInput, queryCandidates: candidates })
  if (!decision.shouldCreateIteration || !decision.plan) {
    const persisted = persistStopDecision(repositories, run.id, decision.decision)
    recordIterationStop(run, persisted)
    appendStopCheckpoint(repositories, run.id, run.currentAttemptId, run.usage.iterations, persisted)
    return stoppedContext(input, run.id, run, persisted)
  }

  const iteration = repositories.researchIterationRepo!.reserve({ runId: run.id, plan: decision.plan, coverageBefore: { aggregateScore: latest?.aggregateScore ?? 0 } })
  repositories.researchEventRepo.append({ runId: run.id, type: 'research.iteration.started', phase: 'gap_filling', payload: { iteration: iteration.ordinal, iterationId: iteration.id } })
  const queries = decision.plan.targets.map((target) => repositories.researchQuestionRepo.createSearchQuery({
    runId: run.id,
    questionId: target.questionId,
    iteration: iteration.ordinal,
    query: target.query,
    intent: target.intent ?? null,
    sourceTargets: target.sourceTargets ?? [],
    dedupeKey: target.dedupeKey ?? createQueryDedupeKey(target.query),
    idempotencyKey: createIterationQueryFingerprint({
      runId: run.id,
      iterationId: iteration.id,
      questionId: target.questionId,
      intent: target.intent ?? target.searchIntent,
      query: target.query,
      profile: run.profile,
      timeScope: null,
      policyVersion: 'v2',
    }),
  }))
  for (const query of queries) repositories.researchEventRepo.append({ runId: run.id, type: 'research.query.started', phase: 'gap_filling', payload: { id: query.id, iterationId: iteration.id } })
  repositories.researchIterationRepo!.update(iteration.id, { status: 'executing' })
  appendPlanCheckpoint(repositories, run.id, run.currentAttemptId, iteration, queries.map((query) => query.id))
  return { ...input, iterationId: iteration.id, queryIds: queries.map((query) => query.id), iterations: run.usage.iterations, maxIterations: run.budget.maxIterations, stopDecision: null, limitations: [] }
}

export function createPlanIterationStep(dependencies: { repositories: DeepResearchRepositories; gapAnalyst: GapAnalyst }) {
  return createStep({
    id: 'deep-research-plan-iteration',
    inputSchema: iterationContextSchema,
    outputSchema: iterationContextSchema,
    execute: async ({ inputData }) => planIteration(inputData, dependencies),
  })
}
