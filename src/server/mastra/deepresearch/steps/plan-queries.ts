import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import type { QueryPlanner, PlannedResearchQuery } from '../agents/query-planner'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'
import { RESEARCH_QUERY_INTENTS, createQueryDedupeKey, dedupeResearchQueryPlans, type ResearchQueryIntent } from '../query-strategy'
import { logWarning } from '@server/logger/logger'

const inputSchema = z.object({ runId: z.string().min(1), brief: researchBriefSchema })

/** A single subtopic gets a small, predictable initial search budget. */
export const MAX_INITIAL_SEARCH_QUERIES_PER_SUBTOPIC = 3
const querySchema = z.object({
  questionId: z.string().min(1),
  query: z.string().trim().min(1),
  intent: z.enum(RESEARCH_QUERY_INTENTS),
  sourceTargets: z.array(z.string().trim().min(1)).min(1).max(5),
  // Accept the optional adapter field for deterministic planners, but overwrite it before persistence.
  dedupeKey: z.string().optional(),
}).strict()

function roundRobinByQuestion(plans: readonly PlannedResearchQuery[], questionIds: readonly string[], limit: number): PlannedResearchQuery[] {
  const byQuestion = new Map(questionIds.map((id) => [id, [] as PlannedResearchQuery[]]))
  for (const plan of plans) byQuestion.get(plan.questionId)?.push(plan)
  const selected: PlannedResearchQuery[] = []
  for (let depth = 0; selected.length < limit; depth += 1) {
    let added = false
    for (const questionId of questionIds) {
      const plan = byQuestion.get(questionId)?.[depth]
      if (!plan) continue
      selected.push(plan)
      added = true
      if (selected.length === limit) break
    }
    if (!added) break
  }
  return selected
}

function capPlansPerQuestion(plans: readonly PlannedResearchQuery[], maxPerQuestion: number): PlannedResearchQuery[] {
  const counts = new Map<string, number>()
  return plans.filter((plan) => {
    const count = counts.get(plan.questionId) ?? 0
    if (count >= maxPerQuestion) return false
    counts.set(plan.questionId, count + 1)
    return true
  })
}

function isKnownIntent(intent: string): intent is ResearchQueryIntent {
  return (RESEARCH_QUERY_INTENTS as readonly string[]).includes(intent)
}

/** Normalizes model output, rejects unknown questions, and makes the server the source of truth for dedupe keys. */
type InitialQueryPlanSelection = {
  plans: PlannedResearchQuery[]
  cappedPerSubtopicCount: number
  cappedByGlobalBudgetCount: number
}

function selectInitialQueryPlans(
  plans: readonly PlannedResearchQuery[],
  questionIds: readonly string[],
  existing: ReadonlyArray<{ questionId: string; dedupeKey?: string; query: string }>,
  remaining: number,
): InitialQueryPlanSelection {
  const knownQuestionIds = new Set(questionIds)
  const existingByQuestion = new Map<string, Set<string>>()
  for (const query of existing) {
    const keys = existingByQuestion.get(query.questionId) ?? new Set<string>()
    keys.add(query.dedupeKey || createQueryDedupeKey(query.query))
    existingByQuestion.set(query.questionId, keys)
  }

  const normalized = dedupeResearchQueryPlans(plans
    .filter((plan) => knownQuestionIds.has(plan.questionId) && isKnownIntent(plan.intent))
    .map((plan) => ({
      ...plan,
      query: plan.query.trim(),
      sourceTargets: [...new Set(plan.sourceTargets.map((target) => target.trim()).filter(Boolean))],
      dedupeKey: createQueryDedupeKey(plan.query),
    }))
    .filter((plan) => plan.sourceTargets.length > 0)
    .filter((plan) => !existingByQuestion.get(plan.questionId)?.has(plan.dedupeKey)))

  const perSubtopicCapped = capPlansPerQuestion(normalized, MAX_INITIAL_SEARCH_QUERIES_PER_SUBTOPIC)
  const selected = roundRobinByQuestion(perSubtopicCapped, questionIds, Math.max(0, remaining))
  return {
    plans: selected,
    cappedPerSubtopicCount: normalized.length - perSubtopicCapped.length,
    cappedByGlobalBudgetCount: Math.max(0, perSubtopicCapped.length - selected.length),
  }
}

export function prepareInitialQueryPlans(
  plans: readonly PlannedResearchQuery[],
  questionIds: readonly string[],
  existing: ReadonlyArray<{ questionId: string; dedupeKey?: string; query: string }>,
  remaining: number,
): PlannedResearchQuery[] {
  return selectInitialQueryPlans(plans, questionIds, existing, remaining).plans
}

export function createPlanQueriesStep({ repositories, planner }: { repositories: DeepResearchRepositories; planner: QueryPlanner }) {
  return createStep({
    id: 'deep-research-plan-queries',
    inputSchema,
    outputSchema: inputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      const questions = repositories.researchQuestionRepo.list(run.id)
      const existing = repositories.researchQuestionRepo.listSearchQueries(run.id)
      if (existing.length === 0) {
        assertWorkflowNotCancelled(repositories, run.id)
        const rawPlans = z.array(querySchema).parse(await planner.plan(run, questions, { signal: getWorkflowExecution(run.id)?.signal }))
        assertWorkflowNotCancelled(repositories, run.id)
        const remainingGlobalBudget = Math.max(0, run.budget.maxSearchQueries - run.usage.searchQueries)
        const topicAwareLimit = questions.length * MAX_INITIAL_SEARCH_QUERIES_PER_SUBTOPIC
        const remaining = Math.min(remainingGlobalBudget, topicAwareLimit)
        const selection = selectInitialQueryPlans(rawPlans, questions.map((question) => question.id), existing, remaining)
        const plans = selection.plans
        if (selection.cappedPerSubtopicCount > 0 || selection.cappedByGlobalBudgetCount > 0) {
          logWarning('deep-research.search-limit', 'Deep Research initial search plan was capped by the configured search budget.', {
            runId: run.id,
            depth: run.depth,
            plannedSubtopicCount: questions.length,
            requestedQueryCount: rawPlans.length,
            maxQueriesPerSubtopic: MAX_INITIAL_SEARCH_QUERIES_PER_SUBTOPIC,
            topicAwareLimit,
            remainingGlobalBudget,
            acceptedQueryCount: plans.length,
            cappedPerSubtopicCount: selection.cappedPerSubtopicCount,
            cappedByGlobalBudgetCount: selection.cappedByGlobalBudgetCount,
          })
        }
        const created = plans.map((plan) => repositories.researchQuestionRepo.createSearchQuery({
          runId: run.id,
          questionId: plan.questionId,
          iteration: run.usage.iterations,
          query: plan.query,
          intent: plan.intent,
          sourceTargets: plan.sourceTargets,
          dedupeKey: plan.dedupeKey,
          idempotencyKey: `initial-query:v2:${plan.questionId}:${plan.dedupeKey}`,
        }))
        repositories.researchRunRepo.setUsage(run.id, { ...run.usage, searchQueries: run.usage.searchQueries + created.length })
        for (const query of created) {
          repositories.researchEventRepo.append({
            runId: run.id,
            type: 'research.query.started',
            phase: 'planning',
            payload: { id: query.id, questionId: query.questionId, intent: query.intent ?? null, dedupeKey: query.dedupeKey ?? null },
          })
        }
      }
      checkpointWorkflowPhase(repositories, run, 'plan_queries', 'searching')
      return inputData
    },
  })
}
