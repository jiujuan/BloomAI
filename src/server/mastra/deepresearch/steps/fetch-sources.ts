import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { ReturnTypeOfContentService } from './types'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase, isReplayPastPhase } from './checkpoint-replay'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchFetchLatency, setDeepResearchSpanCounts, traceDeepResearchPhase } from '@server/telemetry/metrics'

const briefSchema = z.object({ title: z.string(), objective: z.string().nullable(), audience: z.string().nullable(), scope: z.string(), assumptions: z.array(z.string()), plannedSections: z.array(z.string()), criticalClarificationIds: z.array(z.string()) })
const inputSchema = z.object({ runId: z.string().min(1), brief: briefSchema, sourceIds: z.array(z.string()) })
const outputSchema = z.object({ runId: z.string().min(1), brief: briefSchema })

export function createFetchSourcesStep({ repositories, contentService }: { repositories: DeepResearchRepositories; contentService: ReturnTypeOfContentService }) {
  return createStep({
    id: 'deep-research-fetch-sources', inputSchema, outputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      if (isReplayPastPhase(run.id, 'fetching')) {
        checkpointWorkflowPhase(repositories, run, 'fetching', 'extracting_evidence')
        return { runId: run.id, brief: inputData.brief }
      }
      const sources = inputData.sourceIds.map((id) => repositories.researchSourceRepo.getSource(id)).filter((source): source is NonNullable<typeof source> => Boolean(source))
      const startedAt = Date.now()
      const outcomes = await traceDeepResearchPhase('fetching', deepResearchTelemetryContext(run, { sources: sources.length }), async (span) => {
        const result = await contentService.fetch(run, sources, {
          isCancelled: () => repositories.researchRunRepo.get(run.id)?.status === 'cancelled',
        })
        setDeepResearchSpanCounts(span, { sources: sources.length, fetched: result.filter((outcome) => outcome.status === 'fetched').length })
        return result
      })
      recordDeepResearchFetchLatency(Date.now() - startedAt, deepResearchTelemetryContext(run, { sources: sources.length }))
      const fetchedCount = outcomes.filter((outcome) => outcome.status === 'fetched').length
      repositories.researchRunRepo.setUsage(run.id, { ...run.usage, fetchedSources: run.usage.fetchedSources + fetchedCount })
      repositories.researchEventRepo.append({
        runId: run.id,
        type: 'research.sources.fetched',
        phase: 'fetching',
        payload: {
          sourceIds: outcomes.filter((outcome) => outcome.status === 'fetched').map((outcome) => outcome.sourceId),
          fetchedCount,
          failedCount: outcomes.length - fetchedCount,
        },
      })
      checkpointWorkflowPhase(repositories, run, 'fetching', 'extracting_evidence')
      return { runId: run.id, brief: inputData.brief }
    },
  })
}
