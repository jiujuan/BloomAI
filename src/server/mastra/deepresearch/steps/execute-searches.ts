import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import type { SearchExecution } from '@server/services/deepresearch/search-service'
import type { ReturnTypeOfSearchService } from './types'
import type { DeepResearchRepositories } from '../workflow-context'
import { assertWorkflowNotCancelled, checkpointWorkflowPhase, getWorkflowExecution, isReplayPastPhase } from './checkpoint-replay'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchSearchLatency, setDeepResearchSpanCounts, traceDeepResearchPhase } from '@server/telemetry/metrics'

const briefSchema = researchBriefSchema
const inputSchema = z.object({ runId: z.string().min(1), brief: briefSchema })
const candidateSchema = z.object({ queryId: z.string(), title: z.string(), url: z.string(), snippet: z.string() })
const outputSchema = z.object({ runId: z.string().min(1), brief: briefSchema, candidates: z.array(candidateSchema) })

export function createExecuteSearchesStep({ repositories, searchService }: { repositories: DeepResearchRepositories; searchService: ReturnTypeOfSearchService }) {
  return createStep({
    id: 'deep-research-execute-searches', inputSchema, outputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      const allQueries = repositories.researchQuestionRepo.listSearchQueries(run.id)
      if (isReplayPastPhase(run.id, 'searching')) {
        checkpointWorkflowPhase(repositories, run, 'searching', 'curating_sources')
        return { ...inputData, candidates: [] }
      }
      const queries = allQueries.filter((query) => query.status === 'queued')
      const persistExecution = (execution: SearchExecution): void => {
        repositories.researchQuestionRepo.updateSearchQuery(execution.queryId, {
          provider: execution.provider,
          status: execution.error ? 'failed' : 'completed',
          resultCount: execution.candidates.length,
          error: execution.error,
          completedAt: Date.now(),
        })
      }
      const startedAt = Date.now()
      const executions: SearchExecution[] = await traceDeepResearchPhase('searching', deepResearchTelemetryContext(run, { queries: queries.length }), async (span) => {
        const result = await searchService.search(
          run,
          queries.map((query) => ({ id: query.id, query: query.query })),
          {
            signal: getWorkflowExecution(run.id)?.signal,
            isCancelled: () => { const current = repositories.researchRunRepo.get(run.id); return current?.status === 'cancelling' || current?.status === 'cancelled' || current?.cancellation?.requestedAt != null },
            onExecution: persistExecution,
          },
        )
        setDeepResearchSpanCounts(span, { queries: queries.length, candidates: result.reduce((count, execution) => count + execution.candidates.length, 0) })
        return result
      })
      assertWorkflowNotCancelled(repositories, run.id)
      recordDeepResearchSearchLatency(Date.now() - startedAt, deepResearchTelemetryContext(run, { queries: queries.length }))
      const candidates = executions.flatMap((execution) => execution.candidates)
      for (const execution of executions) {
        repositories.researchEventRepo.append(execution.error
          ? {
              runId: run.id,
              type: 'research.query.failed',
              phase: 'searching',
              payload: { id: execution.queryId, errorCode: execution.error.code },
            }
          : {
              runId: run.id,
              type: 'research.query.completed',
              phase: 'searching',
              payload: { id: execution.queryId, resultCount: execution.candidates.length },
            })
      }
      checkpointWorkflowPhase(repositories, run, 'searching', 'curating_sources')
      return { ...inputData, candidates }
    },
  })
}
