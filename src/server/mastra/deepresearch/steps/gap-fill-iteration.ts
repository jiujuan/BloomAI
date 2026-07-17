import { createStep } from '@mastra/core/workflows'
import type { SourceCurator } from '@server/services/deepresearch/source-curator'
import type { EvidenceService } from '@server/services/deepresearch/evidence-service'
import type { SearchExecution } from '@server/services/deepresearch/search-service'
import type { GapAnalyst } from '../agents/gap-analyst'
import type { ReturnTypeOfContentService, ReturnTypeOfSearchService } from './types'
import { areHighPriorityQuestionsCovered } from '@server/services/deepresearch/evidence-service'
import { gapLoopStateSchema } from './assess-coverage'
import type { DeepResearchRepositories } from '../workflow-context'
import { deepResearchTelemetryContext } from '../workflow-context'
import {
  recordDeepResearchEvidenceCount,
  recordDeepResearchFetchLatency,
  recordDeepResearchGapIterations,
  recordDeepResearchSearchLatency,
  recordDeepResearchSourcesSelected,
  setDeepResearchSpanCounts,
  traceDeepResearchPhase,
} from '@server/telemetry/metrics'

export interface GapFillStopState {
  coverageComplete: boolean
  marginalNewEvidenceCount: number
  cancelled: boolean
  iterations: number
  maxIterations: number
}

export function shouldStopGapFill(state: GapFillStopState): boolean {
  return state.coverageComplete
    || state.marginalNewEvidenceCount <= 0
    || state.cancelled
    || state.iterations >= state.maxIterations
}

export function createGapFillIterationStep({
  repositories,
  gapAnalyst,
  searchService,
  sourceCurator,
  contentService,
  evidenceService,
}: {
  repositories: DeepResearchRepositories
  gapAnalyst: GapAnalyst
  searchService: ReturnTypeOfSearchService
  sourceCurator: SourceCurator
  contentService: ReturnTypeOfContentService
  evidenceService: EvidenceService
}) {
  return createStep({
    id: 'deep-research-gap-fill-iteration',
    inputSchema: gapLoopStateSchema,
    outputSchema: gapLoopStateSchema,
    execute: async ({ inputData }) => {
      const run = repositories.researchRunRepo.get(inputData.runId)
      const cancelled = !run || repositories.researchRunRepo.get(inputData.runId)?.status === 'cancelled'
      if (!run || cancelled || inputData.coverageComplete || run.usage.iterations >= run.budget.maxIterations) {
        return {
          ...inputData,
          cancelled,
          iterations: run?.usage.iterations ?? inputData.iterations,
          maxIterations: run?.budget.maxIterations ?? inputData.maxIterations,
        }
      }

      const questions = repositories.researchQuestionRepo.list(run.id)
      const plans = await gapAnalyst.plan(run, questions)
      const remainingQueries = Math.max(0, run.budget.maxSearchQueries - run.usage.searchQueries)
      const existingQueries = new Set(repositories.researchQuestionRepo.listSearchQueries(run.id).map((query) => query.questionId + '\u0000' + query.query))
      const uniquePlans = plans
        .filter((plan) => !existingQueries.has(plan.questionId + '\u0000' + plan.query))
        .slice(0, remainingQueries)
      if (uniquePlans.length === 0) {
        return { ...inputData, marginalNewEvidenceCount: 0, cancelled: false, iterations: run.usage.iterations, maxIterations: run.budget.maxIterations }
      }

      const iteration = run.usage.iterations + 1
      repositories.researchEventRepo.append({
        runId: run.id,
        type: 'research.iteration.started',
        phase: 'gap_filling',
        payload: { iteration },
      })
      recordDeepResearchGapIterations(iteration, deepResearchTelemetryContext(run, { iterations: iteration }))
      const queryRecords = uniquePlans.map((plan, index) => repositories.researchQuestionRepo.createSearchQuery({
        runId: run.id,
        questionId: plan.questionId,
        iteration,
        query: plan.query,
        idempotencyKey: 'gap-query:v1:' + iteration + ':' + index + ':' + plan.questionId,
      }))
      for (const query of queryRecords) {
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.query.started', phase: 'gap_filling', payload: { id: query.id } })
      }
      const searchStartedAt = Date.now()
      const executions: SearchExecution[] = await traceDeepResearchPhase('gap_filling.search', deepResearchTelemetryContext(run, { queries: queryRecords.length, iterations: iteration }), async (span) => {
        const result = await searchService.search(
          run,
          queryRecords.map((query) => ({ id: query.id, query: query.query })),
          { isCancelled: () => repositories.researchRunRepo.get(run.id)?.status === 'cancelled' },
        )
        setDeepResearchSpanCounts(span, { queries: queryRecords.length, candidates: result.reduce((count, execution) => count + execution.candidates.length, 0), iterations: iteration })
        return result
      })
      recordDeepResearchSearchLatency(Date.now() - searchStartedAt, deepResearchTelemetryContext(run, { queries: queryRecords.length, iterations: iteration }))
      for (const execution of executions) {
        repositories.researchQuestionRepo.updateSearchQuery(execution.queryId, {
          provider: execution.provider,
          status: execution.error ? 'failed' : 'completed',
          resultCount: execution.candidates.length,
          error: execution.error,
          completedAt: Date.now(),
        })
        repositories.researchEventRepo.append(execution.error
          ? { runId: run.id, type: 'research.query.failed', phase: 'gap_filling', payload: { id: execution.queryId, errorCode: execution.error.code } }
          : { runId: run.id, type: 'research.query.completed', phase: 'gap_filling', payload: { id: execution.queryId, resultCount: execution.candidates.length } })
      }

      const curated = sourceCurator.curate(run, executions.flatMap((execution) => execution.candidates))
      const sourceIds: string[] = []
      let normalizedSourceCount = 0
      for (const candidate of curated.selected) {
        const existing = repositories.researchSourceRepo.getByCanonicalUrl(run.id, candidate.canonicalUrl)
        if (existing) {
          sourceIds.push(existing.id)
          continue
        }
        const source = repositories.researchSourceRepo.createSource({
          runId: run.id,
          canonicalUrl: candidate.canonicalUrl,
          domain: candidate.domain,
          title: candidate.title,
          sourceType: candidate.sourceType,
          selectionStatus: 'selected',
          scores: { finalScore: candidate.score, queryId: candidate.queryId },
        })
        normalizedSourceCount += 1
        sourceIds.push(source.id)
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.discovered', phase: 'gap_filling', payload: { id: source.id } })
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.selected', phase: 'gap_filling', payload: { id: source.id } })
      }
      recordDeepResearchSourcesSelected(sourceIds.length, deepResearchTelemetryContext(run, { sources: sourceIds.length, iterations: iteration }))
      const sources = sourceIds
        .map((id) => repositories.researchSourceRepo.getSource(id))
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
      const fetchStartedAt = Date.now()
      const fetched = await traceDeepResearchPhase('gap_filling.fetch', deepResearchTelemetryContext(run, { sources: sources.length, iterations: iteration }), async (span) => {
        const result = await contentService.fetch(run, sources, {
          isCancelled: () => repositories.researchRunRepo.get(run.id)?.status === 'cancelled',
        })
        setDeepResearchSpanCounts(span, { sources: sources.length, fetched: result.filter((item) => item.status === 'fetched').length, iterations: iteration })
        return result
      })
      recordDeepResearchFetchLatency(Date.now() - fetchStartedAt, deepResearchTelemetryContext(run, { sources: sources.length, iterations: iteration }))
      const fetchedCount = fetched.filter((item) => item.status === 'fetched').length
      repositories.researchEventRepo.append({
        runId: run.id,
        type: 'research.sources.fetched',
        phase: 'gap_filling',
        payload: {
          sourceIds: fetched.filter((item) => item.status === 'fetched').map((item) => item.sourceId),
          fetchedCount,
          failedCount: fetched.length - fetchedCount,
        },
      })

      const extraction = await evidenceService.extract(run, repositories.researchQuestionRepo.list(run.id))
      repositories.researchEventRepo.append({ runId: run.id, type: 'research.evidence.extracted', phase: 'gap_filling', payload: { count: extraction.createdCount } })
      recordDeepResearchEvidenceCount(extraction.createdCount, deepResearchTelemetryContext(run, { evidence: extraction.createdCount, iterations: iteration }))
      for (const coverage of extraction.coverage) {
        repositories.researchEventRepo.append({ runId: run.id, type: 'research.coverage.assessed', phase: 'gap_filling', payload: { id: coverage.questionId, score: coverage.score } })
      }

      const usage = {
        ...run.usage,
        iterations: iteration,
        searchQueries: run.usage.searchQueries + queryRecords.length,
        normalizedSources: run.usage.normalizedSources + normalizedSourceCount,
        fetchedSources: run.usage.fetchedSources + fetchedCount,
      }
      repositories.researchRunRepo.setUsage(run.id, usage)
      repositories.researchEventRepo.append({
        runId: run.id,
        type: 'research.iteration.completed',
        phase: 'gap_filling',
        payload: { iteration, newEvidenceCount: extraction.createdCount },
      })
      const updatedQuestions = repositories.researchQuestionRepo.list(run.id)
      return {
        runId: run.id,
        brief: inputData.brief,
        coverageComplete: areHighPriorityQuestionsCovered(updatedQuestions),
        marginalNewEvidenceCount: extraction.createdCount,
        cancelled: repositories.researchRunRepo.get(run.id)?.status === 'cancelled',
        iterations: usage.iterations,
        maxIterations: run.budget.maxIterations,
      }
    },
  })
}
