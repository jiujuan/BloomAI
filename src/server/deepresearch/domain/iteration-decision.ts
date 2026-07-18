import type {
  ResearchBudgetDto,
  ResearchBudgetReservationDto,
  ResearchCoverageAssessmentV2Dto,
  ResearchIterationDecisionInputSummaryDto,
  ResearchIterationDto,
  ResearchIterationPlanDto,
  ResearchIterationPlanTargetDto,
  ResearchIterationStopRule,
  ResearchLoopDecision,
  ResearchLoopDecisionDto,
  ResearchUsageDto,
} from '@shared/deepresearch/contracts'
import { addBudgetReservations, emptyBudgetReservation, reserveBudget } from './budget-reservation'

const SEVERITY_VALUE: Record<ResearchIterationPlanTargetDto['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export interface ResearchIterationQueryCandidate {
  questionId: string
  query: string
  intent?: string | null
}

export interface ResearchIterationHistoryEntry extends Pick<ResearchIterationDto, 'ordinal' | 'status' | 'decision' | 'completedAt'> {
  /** Persisted assessment material-gain projection for this completed iteration. */
  materialGain?: boolean | null
}

export interface IterationDecisionInput {
  assessments: readonly ResearchCoverageAssessmentV2Dto[]
  previousAssessment: ResearchCoverageAssessmentV2Dto | null
  iterations: readonly ResearchIterationHistoryEntry[]
  budget: ResearchBudgetDto
  usage: ResearchUsageDto
  reservations: readonly ResearchBudgetReservationDto[]
  cancellationRequested: boolean
  queryCandidates: readonly ResearchIterationQueryCandidate[]
  estimates?: Partial<{
    fetchedSourcesPerQuery: number
    modelTokensPerQuery: number
    providerCostUsdPerQuery: number
  }>
}

export interface IterationDecisionResult {
  shouldCreateIteration: boolean
  decision: ResearchLoopDecisionDto
  plan: ResearchIterationPlanDto | null
  limitationCodes: string[]
  limitations: string[]
}

interface ActionableGap {
  assessment: ResearchCoverageAssessmentV2Dto
  gap: ResearchCoverageAssessmentV2Dto['gaps'][number]
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isCovered(assessment: ResearchCoverageAssessmentV2Dto): boolean {
  return assessment.verdict === 'covered'
}

function isBlockedOrUnrecoverable(assessment: ResearchCoverageAssessmentV2Dto): boolean {
  return assessment.verdict === 'blocked' || assessment.gaps.every((gap) => !gap.remediable || gap.remediation === 'disclose_limitation')
}

function countConsecutiveNoMaterialGain(iterations: readonly ResearchIterationHistoryEntry[]): number {
  let count = 0
  for (const iteration of [...iterations].sort((left, right) => right.ordinal - left.ordinal)) {
    if (iteration.status !== 'completed' && iteration.status !== 'assessed' && iteration.status !== 'stopped') continue
    if (iteration.materialGain === false) count += 1
    else break
  }
  return count
}

function createInputSummary(input: IterationDecisionInput, actionableGapCount: number, actionableQueryCount: number): ResearchIterationDecisionInputSummaryDto {
  return {
    assessmentFingerprints: input.assessments.map((item) => item.inputFingerprint).sort(compareText),
    previousAssessmentFingerprint: input.previousAssessment?.inputFingerprint ?? null,
    historyIterationCount: input.iterations.length,
    consecutiveNoMaterialGain: countConsecutiveNoMaterialGain(input.iterations),
    actionableGapCount,
    actionableQueryCount,
    cancellationRequested: input.cancellationRequested,
    usage: { ...input.usage },
    activeReservation: addBudgetReservations(input.reservations),
  }
}

function stopped(
  decision: Exclude<ResearchLoopDecision, 'continue'>,
  matchedRule: ResearchIterationStopRule,
  reason: string,
  limitationCodes: string[],
  limitations: string[],
  inputSummary: ResearchIterationDecisionInputSummaryDto,
): IterationDecisionResult {
  return {
    shouldCreateIteration: false,
    plan: null,
    limitationCodes,
    limitations,
    decision: { decision, matchedRule, reason, limitationCodes, limitations, inputSummary },
  }
}

function actionableGaps(assessments: readonly ResearchCoverageAssessmentV2Dto[]): ActionableGap[] {
  return assessments
    .filter((assessment) => assessment.verdict !== 'covered' && assessment.verdict !== 'blocked')
    .flatMap((assessment) => assessment.gaps
      .filter((gap) => gap.remediable && gap.remediation !== 'disclose_limitation' && Boolean(gap.recommendedSearchIntent))
      .map((gap) => ({ assessment, gap })))
    .sort((left, right) => (
      SEVERITY_VALUE[right.gap.severity] - SEVERITY_VALUE[left.gap.severity]
      || compareText(left.assessment.questionId, right.assessment.questionId)
      || compareText(left.gap.code, right.gap.code)
      || compareText(left.gap.recommendedSearchIntent ?? '', right.gap.recommendedSearchIntent ?? '')
    ))
}

function planTargets(gaps: readonly ActionableGap[], candidates: readonly ResearchIterationQueryCandidate[]): ResearchIterationPlanTargetDto[] {
  const cleanCandidates = candidates
    .filter((candidate) => candidate.questionId.trim() && candidate.query.trim())
    .map((candidate) => ({ ...candidate, questionId: candidate.questionId.trim(), query: candidate.query.trim(), intent: candidate.intent?.trim() || null }))
    .sort((left, right) => compareText(left.questionId, right.questionId) || compareText(left.query, right.query) || compareText(left.intent ?? '', right.intent ?? ''))

  const targets: ResearchIterationPlanTargetDto[] = []
  const seen = new Set<string>()
  for (const { assessment, gap } of gaps) {
    const intent = gap.recommendedSearchIntent!
    for (const candidate of cleanCandidates) {
      if (candidate.questionId !== assessment.questionId) continue
      if (candidate.intent && candidate.intent !== intent) continue
      const identity = [assessment.questionId, gap.code, intent, candidate.query].join('\u0000')
      if (seen.has(identity)) continue
      seen.add(identity)
      targets.push({
        questionId: assessment.questionId,
        gapCode: gap.code,
        severity: gap.severity,
        remediation: gap.remediation,
        searchIntent: intent,
        query: candidate.query,
        expectedValue: SEVERITY_VALUE[gap.severity] + (gap.remediation === 'search_primary' || gap.remediation === 'search_independent' ? 0.5 : 0),
      })
    }
  }
  return targets.sort((left, right) => (
    SEVERITY_VALUE[right.severity] - SEVERITY_VALUE[left.severity]
    || compareText(left.questionId, right.questionId)
    || compareText(left.query, right.query)
    || compareText(left.gapCode, right.gapCode)
  ))
}

function exhaustedHardBudgetLimits(input: IterationDecisionInput): string[] {
  const exhausted: string[] = []
  // A persisted deadline is authoritative. Legacy/frozen fixtures may only have
  // startedAt, so deriving a wall-clock deadline here would make this pure decision
  // nondeterministic and could incorrectly stop historical runs.
  if (input.usage.deadlineAt !== null && Date.now() >= input.usage.deadlineAt) exhausted.push('duration')
  if (input.usage.searchQueries >= input.budget.maxSearchQueries) exhausted.push('searchQueries')
  if (input.usage.normalizedSources >= input.budget.maxNormalizedSources) exhausted.push('normalizedSources')
  if (input.usage.fetchedSources >= input.budget.maxFetchedSources) exhausted.push('fetchedSources')
  if (input.budget.maxTokens !== undefined && input.usage.tokens >= input.budget.maxTokens) exhausted.push('modelTokens')
  if (input.budget.maxProviderCostUsd !== undefined && input.usage.providerCostUsd >= input.budget.maxProviderCostUsd) exhausted.push('providerCostUsd')
  return exhausted
}

function reservationFor(targets: readonly ResearchIterationPlanTargetDto[], estimates: IterationDecisionInput['estimates']): ResearchBudgetReservationDto {
  const fetchedSourcesPerQuery = estimates?.fetchedSourcesPerQuery ?? 1
  const modelTokensPerQuery = estimates?.modelTokensPerQuery ?? 100
  const providerCostUsdPerQuery = estimates?.providerCostUsdPerQuery ?? 0
  return {
    iterations: 1,
    searchQueries: targets.length,
    fetchedSources: targets.length * fetchedSourcesPerQuery,
    modelTokens: targets.length * modelTokensPerQuery,
    providerCostUsd: targets.length * providerCostUsdPerQuery,
  }
}

/**
 * Deterministically produces either a bounded, budget-reserved iteration plan or a
 * structured stop decision. It has no persistence or provider side effects.
 */
export function decideIteration(input: IterationDecisionInput): IterationDecisionResult {
  const gaps = actionableGaps(input.assessments)
  const targets = planTargets(gaps, input.queryCandidates)
  const inputSummary = createInputSummary(input, gaps.length, targets.length)

  if (input.cancellationRequested) {
    return stopped('stop_cancelled', 'cancellation_requested', 'Cancellation was requested before another iteration could be dispatched.', ['CANCELLATION_REQUESTED'], ['Research was stopped because cancellation was requested.'], inputSummary)
  }

  if (input.assessments.length > 0 && input.assessments.every(isCovered)) {
    return stopped('stop_covered', 'coverage_reached', 'All assessed questions meet the coverage threshold.', [], [], inputSummary)
  }

  const historicalIterationCount = input.iterations.reduce((max, iteration) => Math.max(max, iteration.ordinal), 0)
  if (Math.max(input.usage.iterations, historicalIterationCount) + inputSummary.activeReservation.iterations >= input.budget.maxIterations) {
    return stopped('stop_max_iterations', 'max_iterations', 'The hard maximum iteration budget has been reached or reserved.', ['MAX_ITERATIONS_REACHED'], ['Further research was not dispatched because the maximum number of iterations was reached.'], inputSummary)
  }

  const hardBudgetLimits = exhaustedHardBudgetLimits(input)
  if (hardBudgetLimits.length > 0) {
    return stopped('stop_budget', 'budget_exhausted', `A hard budget was exhausted: ${hardBudgetLimits.join(', ')}.`, ['BUDGET_EXHAUSTED', ...hardBudgetLimits.map((item) => `BUDGET_${item}`)], ['Remaining gaps could not be researched within the available budget.'], inputSummary)
  }

  if (inputSummary.consecutiveNoMaterialGain >= 2) {
    return stopped('stop_no_material_gain', 'no_material_gain', 'The two most recent completed iterations produced no material coverage gain.', ['NO_MATERIAL_GAIN'], ['Further research was stopped after two consecutive iterations without material coverage gain.'], inputSummary)
  }

  const unresolved = input.assessments.filter((assessment) => !isCovered(assessment))
  if (unresolved.length > 0 && unresolved.every(isBlockedOrUnrecoverable)) {
    return stopped('stop_blocked', 'blocked_unrecoverable', 'All remaining assessment gaps are blocked or not remediable.', ['BLOCKED_OR_UNRECOVERABLE'], unresolved.flatMap((assessment) => assessment.limitation ? [assessment.limitation] : []).sort(compareText), inputSummary)
  }

  if (gaps.length === 0 || targets.length === 0) {
    return stopped('stop_no_actionable_gaps', 'no_actionable_gaps', 'No executable query could be derived for the remaining gaps.', ['NO_ACTIONABLE_GAPS'], ['Remaining gaps have no executable search query and are disclosed as limitations.'], inputSummary)
  }

  const reservation = reservationFor(targets, input.estimates)
  const reserved = reserveBudget({ budget: input.budget, usage: input.usage, existingReservations: input.reservations, requested: reservation })
  if (!reserved.ok) {
    return stopped('stop_budget', 'budget_exhausted', `The planned iteration exceeds ${reserved.exhausted.join(', ')} budget.`, ['BUDGET_EXHAUSTED', ...reserved.exhausted.map((item) => `BUDGET_${item}`)], ['Remaining gaps could not be researched within the available budget.'], inputSummary)
  }

  const plan: ResearchIterationPlanDto = {
    version: 1,
    targets,
    reservation,
    inputSummary,
  }
  return {
    shouldCreateIteration: true,
    plan,
    limitationCodes: [],
    limitations: [],
    decision: { decision: 'continue', reason: 'Actionable gaps were prioritized and budget was reserved.', limitationCodes: [], inputSummary },
  }
}

export function initialReservation(): ResearchBudgetReservationDto {
  return emptyBudgetReservation()
}
