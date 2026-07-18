import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { QueryPlanner } from '../agents/query-planner'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution, isReplayPastPhase } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'

const inputSchema = z.object({ runId: z.string().min(1), brief: z.object({ title: z.string(), objective: z.string().nullable(), audience: z.string().nullable(), scope: z.string(), assumptions: z.array(z.string()), plannedSections: z.array(z.string()), criticalClarificationIds: z.array(z.string()) }) })
const querySchema = z.object({ questionId: z.string().min(1), query: z.string().trim().min(1) })

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
        const plans = z.array(querySchema).parse(await planner.plan(run, questions, { signal: getWorkflowExecution(run.id)?.signal }))
        assertWorkflowNotCancelled(repositories, run.id)
        const remaining = Math.max(0, run.budget.maxSearchQueries - run.usage.searchQueries)
        const created = plans.slice(0, remaining).map((plan, index) => repositories.researchQuestionRepo.createSearchQuery({
          runId: run.id,
          questionId: plan.questionId,
          iteration: run.usage.iterations,
          query: plan.query,
          idempotencyKey: 'initial-query:v1:' + index + ':' + plan.questionId,
        }))
        repositories.researchRunRepo.setUsage(run.id, { ...run.usage, searchQueries: run.usage.searchQueries + created.length })
        for (const query of created) {
          repositories.researchEventRepo.append({
            runId: run.id,
            type: 'research.query.started',
            phase: 'planning',
            payload: { id: query.id },
          })
        }
      }
      checkpointWorkflowPhase(repositories, run, 'plan_queries', 'searching')
      return inputData
    },
  })
}
