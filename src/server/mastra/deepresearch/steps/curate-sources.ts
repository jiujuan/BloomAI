import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import type { SourceCurator } from '@server/services/deepresearch/source-curator'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase, isReplayPastPhase } from './checkpoint-replay'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchSourcesSelected } from '@server/telemetry/metrics'

const briefSchema = researchBriefSchema
const candidateSchema = z.object({ queryId: z.string(), title: z.string(), url: z.string(), snippet: z.string() })
const inputSchema = z.object({ runId: z.string().min(1), brief: briefSchema, candidates: z.array(candidateSchema) })
const outputSchema = z.object({ runId: z.string().min(1), brief: briefSchema, sourceIds: z.array(z.string()) })

export function createCurateSourcesStep({ repositories, curator }: { repositories: DeepResearchRepositories; curator: SourceCurator }) {
  return createStep({
    id: 'deep-research-curate-sources', inputSchema, outputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      if (isReplayPastPhase(run.id, 'curating_sources')) {
        const sourceIds = repositories.researchSourceRepo.listSources(run.id).map((source) => source.id)
        checkpointWorkflowPhase(repositories, run, 'curating_sources', 'fetching', { pendingSourceIds: sourceIds })
        return { runId: run.id, brief: inputData.brief, sourceIds }
      }
      const curated = curator.curate(run, inputData.candidates)
      const newlyDiscoveredIds: string[] = []
      const sourceIds = curated.selected.map((source) => {
        const existing = repositories.researchSourceRepo.getByCanonicalUrl(run.id, source.canonicalUrl)
        if (existing) return existing.id
        const created = repositories.researchSourceRepo.createSource({ runId: run.id, canonicalUrl: source.canonicalUrl, originalUrl: source.url, domain: source.domain, title: source.title, sourceType: source.sourceType, selectionStatus: 'selected', scores: { finalScore: source.score, queryId: source.queryId } })
        newlyDiscoveredIds.push(created.id)
        return created.id
      })
      repositories.researchRunRepo.setUsage(run.id, { ...run.usage, normalizedSources: run.usage.normalizedSources + newlyDiscoveredIds.length })
      for (const sourceId of newlyDiscoveredIds) {
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.discovered', phase: 'curating_sources', payload: { id: sourceId } })
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.selected', phase: 'curating_sources', payload: { id: sourceId } })
      }
      recordDeepResearchSourcesSelected(sourceIds.length, deepResearchTelemetryContext(run, { sources: sourceIds.length }))
      checkpointWorkflowPhase(repositories, run, 'curating_sources', 'fetching', { pendingSourceIds: sourceIds })
      return { runId: run.id, brief: inputData.brief, sourceIds }
    },
  })
}
