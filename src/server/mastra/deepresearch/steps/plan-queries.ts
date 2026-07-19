import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import type { QueryPlanner, PlannedResearchQuery } from '../agents/query-planner'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'
import { RESEARCH_QUERY_INTENTS, createQueryDedupeKey, dedupeResearchQueryPlans, type ResearchQueryIntent } from '../query-strategy'

const inputSchema = z.object({ runId: z.string().min(1), brief: researchBriefSchema })
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

function isKnownIntent(intent: string): intent is ResearchQueryIntent {
  return (RESEARCH_QUERY_INTENTS as readonly string[]).includes(intent)
}

/** Normalizes model output, rejects unknown questions, and makes the server the source of truth for dedupe keys. */
export function prepareInitialQueryPlans(
  plans: readonly PlannedResearchQuery[],
  questionIds: readonly string[],
  existing: ReadonlyArray<{ questionId: string; dedupeKey?: string; query: string }>,
  remaining: number,
): PlannedResearchQuery[] {
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

  return roundRobinByQuestion(normalized, questionIds, Math.max(0, remaining))
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
        const remaining = Math.max(0, run.budget.maxSearchQueries - run.usage.searchQueries)
        const plans = prepareInitialQueryPlans(rawPlans, questions.map((question) => question.id), existing, remaining)
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
