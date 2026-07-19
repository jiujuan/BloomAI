import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import type { JsonValue } from '@shared/deepresearch/contracts'
import { assessCandidateSourceQuality } from '@server/deepresearch/domain/source-quality'
import type { SourceCurator, SourceQueryContext } from '@server/services/deepresearch/source-curator'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase, isReplayPastPhase } from './checkpoint-replay'
import { deepResearchTelemetryContext, loadRunnableRun } from '../workflow-context'
import { recordDeepResearchSourcesSelected } from '@server/telemetry/metrics'

const briefSchema = researchBriefSchema
const candidateSchema = z.object({ queryId: z.string(), title: z.string(), url: z.string(), snippet: z.string() })
const inputSchema = z.object({ runId: z.string().min(1), brief: briefSchema, candidates: z.array(candidateSchema) })
const outputSchema = z.object({ runId: z.string().min(1), brief: briefSchema, sourceIds: z.array(z.string()) })

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function buildQueryContexts(repositories: DeepResearchRepositories, runId: string): Record<string, SourceQueryContext> {
  const questionsById = new Map(repositories.researchQuestionRepo.list(runId).map((question) => [question.id, question]))
  return Object.fromEntries(repositories.researchQuestionRepo.listSearchQueries(runId).flatMap((query) => {
    const question = questionsById.get(query.questionId)
    if (!question) return []
    return [[query.id, {
      questionId: question.id,
      question: question.question,
      plannedQuery: query.query,
      intent: query.intent ?? question.intent,
      sourceTargets: query.sourceTargets ?? question.sourceTargets,
      needPrimarySource: question.needPrimarySource,
      needQuantitativeEvidence: question.needQuantitativeEvidence,
    } satisfies SourceQueryContext]]
  }))
}

function recordCandidateAssessments(
  repositories: DeepResearchRepositories,
  runId: string,
  contexts: Readonly<Record<string, SourceQueryContext>>,
  selected: ReadonlyArray<{ queryId: string; title: string; url: string; snippet: string; canonicalUrl: string; domain: string }>,
  rejected: ReadonlyArray<{ queryId: string; title: string; url: string; snippet: string; canonicalUrl?: string; domain?: string }> = [],
): void {
  const existingDomains = selected.map((candidate) => candidate.domain)
  for (const [selectionStatus, candidates] of [['selected', selected], ['rejected', rejected]] as const) {
    for (const candidate of candidates) {
      const context = contexts[candidate.queryId]
      if (!context) continue
      const domain = candidate.domain ?? ''
      repositories.researchSourceRepo.recordCandidateAssessment({
        runId,
        questionId: context.questionId,
        queryId: candidate.queryId,
        canonicalUrl: candidate.canonicalUrl,
        originalUrl: candidate.url,
        domain,
        title: candidate.title,
        snippet: candidate.snippet,
        selectionStatus,
        assessment: assessCandidateSourceQuality({
          question: context.question,
          plannedQuery: context.plannedQuery,
          sourceTargets: context.sourceTargets,
          url: candidate.url,
          domain,
          title: candidate.title,
          snippet: candidate.snippet,
          existingDomains,
        }),
      })
    }
  }
}
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
      const queryContexts = buildQueryContexts(repositories, run.id)
      const curated = curator.curate(run, inputData.candidates, { queryContexts })
      const curationRejections = curated.rejected ?? []
      recordCandidateAssessments(repositories, run.id, queryContexts, curated.selected, curationRejections)
      const newlyDiscoveredIds: string[] = []
      const sourceIds = curated.selected.map((source) => {
        const existing = repositories.researchSourceRepo.getByCanonicalUrl(run.id, source.canonicalUrl)
        if (existing) return existing.id
        const created = repositories.researchSourceRepo.createSource({
          runId: run.id,
          canonicalUrl: source.canonicalUrl,
          originalUrl: source.url,
          domain: source.domain,
          title: source.title,
          sourceType: source.sourceType,
          selectionStatus: 'selected',
          scores: {
            finalScore: source.score,
            queryId: source.queryId,
            sourceType: source.sourceType,
            breakdown: toJson(source.scoreBreakdown),
            diagnostics: toJson(source.diagnostics),
          },
        })
        newlyDiscoveredIds.push(created.id)
        return created.id
      })
      repositories.researchRunRepo.setUsage(run.id, { ...run.usage, normalizedSources: run.usage.normalizedSources + newlyDiscoveredIds.length })
      for (const sourceId of newlyDiscoveredIds) {
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.discovered', phase: 'curating_sources', payload: { id: sourceId } })
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.selected', phase: 'curating_sources', payload: { id: sourceId } })
      }
      for (const rejected of curationRejections) {
        repositories.researchEventRepo.append({
          runId: run.id,
          type: 'research.source.rejected',
          phase: 'curating_sources',
          payload: {
            queryId: rejected.queryId,
            url: rejected.url,
            canonicalUrl: rejected.canonicalUrl ?? null,
            domain: rejected.domain ?? null,
            sourceType: rejected.sourceType ?? null,
            score: rejected.score ?? null,
            reason: rejected.reason,
            scoreBreakdown: rejected.scoreBreakdown ? toJson(rejected.scoreBreakdown) : null,
            diagnostics: rejected.diagnostics ? toJson(rejected.diagnostics) : null,
          },
        })
      }
      recordDeepResearchSourcesSelected(sourceIds.length, deepResearchTelemetryContext(run, { sources: sourceIds.length }))
      checkpointWorkflowPhase(repositories, run, 'curating_sources', 'fetching', {
        pendingSourceIds: sourceIds,
      })
      return { runId: run.id, brief: inputData.brief, sourceIds }
    },
  })
}
