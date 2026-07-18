import type { ResearchRunDto, ResearchRunStatus } from '@shared/deepresearch/contracts'
import { ResearchDomainError } from '@server/deepresearch/domain/errors'
import { researchAttemptRepo } from '@server/db/repositories/deepresearch/research-attempt.repo'
import { researchCheckpointRepo } from '@server/db/repositories/deepresearch/research-checkpoint.repo'
import { researchCoverageAssessmentRepo } from '@server/db/repositories/deepresearch/research-coverage-assessment.repo'
import { researchEvidenceRepo } from '@server/db/repositories/deepresearch/research-evidence.repo'
import { researchEventRepo } from '@server/db/repositories/deepresearch/research-event.repo'
import { researchQuestionRepo } from '@server/db/repositories/deepresearch/research-question.repo'
import { researchReportRepo } from '@server/db/repositories/deepresearch/research-report.repo'
import { researchRunRepo } from '@server/db/repositories/deepresearch/research-run.repo'
import { researchSourceRepo } from '@server/db/repositories/deepresearch/research-source.repo'
import { deepResearchTraceAttributes, type DeepResearchTelemetryContext } from '@server/telemetry/metrics'

export interface DeepResearchRepositories {
  researchRunRepo: typeof researchRunRepo
  researchAttemptRepo: typeof researchAttemptRepo
  researchCheckpointRepo: typeof researchCheckpointRepo
  researchCoverageAssessmentRepo: typeof researchCoverageAssessmentRepo
  researchQuestionRepo: typeof researchQuestionRepo
  researchReportRepo: typeof researchReportRepo
  researchEventRepo: typeof researchEventRepo
  researchEvidenceRepo: typeof researchEvidenceRepo
  researchSourceRepo: typeof researchSourceRepo
}

export const defaultDeepResearchRepositories: DeepResearchRepositories = {
  researchRunRepo,
  researchAttemptRepo,
  researchCheckpointRepo,
  researchCoverageAssessmentRepo,
  researchQuestionRepo,
  researchReportRepo,
  researchEventRepo,
  researchEvidenceRepo,
  researchSourceRepo,
}

export function deepResearchTelemetryContext(run: ResearchRunDto, counts?: DeepResearchTelemetryContext['counts']): DeepResearchTelemetryContext {
  return {
    researchRunId: run.id,
    workflowRunId: run.workflowRunId,
    profile: run.profile,
    depth: run.depth,
    phase: run.phase,
    counts,
  }
}

export function deepResearchRunTraceAttributes(run: ResearchRunDto, counts?: DeepResearchTelemetryContext['counts']) {
  return deepResearchTraceAttributes(deepResearchTelemetryContext(run, counts))
}

export function assertRunnable(run: ResearchRunDto, allowedStatuses: readonly ResearchRunStatus[]): void {
  if (allowedStatuses.includes(run.status)) return

  throw new ResearchDomainError(
    'RESEARCH_NOT_RUNNABLE',
    'Deep Research Run is not runnable during ' + run.phase + ': ' + run.id,
    false,
    { status: run.status, phase: run.phase },
  )
}

export function assertBudgetAvailable(run: ResearchRunDto, now = Date.now()): void {
  const deadlineAt = run.usage.deadlineAt ?? (run.usage.startedAt === null ? null : run.usage.startedAt + run.budget.maxDurationMs)
  if (deadlineAt !== null && now >= deadlineAt) {
    throw new ResearchDomainError('RESEARCH_BUDGET_EXHAUSTED', 'Deep Research duration budget has been exhausted.', false)
  }

  type BoundedUsageKey =
    | 'questions'
    | 'iterations'
    | 'searchQueries'
    | 'normalizedSources'
    | 'fetchedSources'
  type BudgetLimitKey =
    | 'maxQuestions'
    | 'maxIterations'
    | 'maxSearchQueries'
    | 'maxNormalizedSources'
    | 'maxFetchedSources'

  const limits: ReadonlyArray<readonly [BoundedUsageKey, BudgetLimitKey]> = [
    ['questions', 'maxQuestions'],
    ['iterations', 'maxIterations'],
    ['searchQueries', 'maxSearchQueries'],
    ['normalizedSources', 'maxNormalizedSources'],
    ['fetchedSources', 'maxFetchedSources'],
  ]
  for (const [usageKey, budgetKey] of limits) {
    if (run.usage[usageKey] > run.budget[budgetKey]) {
      throw new ResearchDomainError('RESEARCH_BUDGET_EXHAUSTED', 'Deep Research budget has been exhausted: ' + usageKey, false)
    }
  }
}

export function loadRunnableRun(
  repositories: DeepResearchRepositories,
  runId: string,
  allowedStatuses: readonly ResearchRunStatus[],
): ResearchRunDto {
  const run = repositories.researchRunRepo.get(runId)
  if (!run) {
    throw new ResearchDomainError('RESEARCH_NOT_RUNNABLE', 'Deep Research Run not found: ' + runId, false)
  }

  assertRunnable(run, allowedStatuses)
  assertBudgetAvailable(run)
  return run
}
