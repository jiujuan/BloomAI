import { createStep } from '@mastra/core/workflows'
import type { SourceCurator } from '@server/services/deepresearch/source-curator'
import type { ReturnTypeOfContentService, ReturnTypeOfSearchService } from './types'
import type { DeepResearchRepositories } from '../workflow-context'
import { iterationContextSchema, type IterationContext } from './iteration-context'
import { assertWorkflowNotCancelled, getWorkflowExecution } from './checkpoint-replay'

export async function executeIterationRetrieval(
  input: IterationContext,
  dependencies: { repositories: DeepResearchRepositories; searchService: ReturnTypeOfSearchService; sourceCurator: SourceCurator; contentService: ReturnTypeOfContentService; afterSearchPersisted?: () => void | Promise<void> },
): Promise<IterationContext> {
  if (!input.iterationId) return input
  const { repositories, searchService, sourceCurator, contentService } = dependencies
  const run = repositories.researchRunRepo.get(input.runId)
  const iteration = repositories.researchIterationRepo!.get(input.iterationId)
  if (!run || !iteration || run.status === 'cancelled' || run.status === 'cancelling') return { ...input, cancelled: Boolean(run && run.status !== 'researching') }

  const isCancellationRequested = () => {
    const current = repositories.researchRunRepo.get(run.id)
    return current?.status === 'cancelling' || current?.status === 'cancelled' || current?.cancellation?.requestedAt != null
  }
  const signal = getWorkflowExecution(run.id)?.signal
  assertWorkflowNotCancelled(repositories, run.id)

  const queries = repositories.researchQuestionRepo.listSearchQueries(run.id).filter((query) => query.iteration === iteration.ordinal)
  const incomplete = queries.filter((query) => query.status !== 'completed')
  if (incomplete.length) {
    await searchService.search(run, incomplete.map((query) => ({ id: query.id, query: query.query, idempotencyKey: query.idempotencyKey ?? query.id })), {
      signal,
      isCancelled: isCancellationRequested,
      onExecution: (execution) => {
        assertWorkflowNotCancelled(repositories, run.id)
        const cachedCandidates = execution.candidates.map((candidate) => ({ title: candidate.title, url: candidate.url, snippet: candidate.snippet }))
        repositories.researchQuestionRepo.updateSearchQuery(execution.queryId, {
          provider: execution.provider,
          status: execution.error ? 'failed' : 'completed',
          resultCount: execution.candidates.length,
          error: execution.error,
          completedAt: Date.now(),
          candidates: cachedCandidates,
        })
        repositories.researchEventRepo.append(execution.error
          ? { runId: run.id, type: 'research.query.failed', phase: 'gap_filling', payload: { id: execution.queryId, errorCode: execution.error.code } }
          : { runId: run.id, type: 'research.query.completed', phase: 'gap_filling', payload: { id: execution.queryId, resultCount: execution.candidates.length } })
      },
    })
    await dependencies.afterSearchPersisted?.()
    assertWorkflowNotCancelled(repositories, run.id)
  }

  const completed = repositories.researchQuestionRepo.listSearchQueries(run.id).filter((query) => query.iteration === iteration.ordinal && query.status === 'completed')
  const fetchReservation = iteration.plan?.reservation.fetchedSources
  if (!Number.isInteger(fetchReservation) || fetchReservation < 0) {
    throw new Error('Active Deep Research iteration is missing a valid fetched-source reservation.')
  }
  const curated = sourceCurator.curate(
    run,
    completed.flatMap((query) => query.candidates.map((candidate) => ({ ...candidate, queryId: query.id }))),
    { maxSources: fetchReservation },
  )
  const sourceIds: string[] = []
  let newSourceCount = 0
  for (const candidate of curated.selected) {
    const existing = repositories.researchSourceRepo.getByCanonicalUrl(run.id, candidate.canonicalUrl)
    if (existing) { sourceIds.push(existing.id); continue }
    const source = repositories.researchSourceRepo.createSource({
      runId: run.id,
      canonicalUrl: candidate.canonicalUrl,
      originalUrl: candidate.url,
      domain: candidate.domain,
      title: candidate.title,
      sourceType: candidate.sourceType,
      selectionStatus: 'selected',
      scores: { finalScore: candidate.score, queryId: candidate.queryId },
    })
    sourceIds.push(source.id)
    newSourceCount += 1
    repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.discovered', phase: 'gap_filling', payload: { id: source.id } })
    repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.selected', phase: 'gap_filling', payload: { id: source.id } })
  }
  const sources = sourceIds.map((id) => repositories.researchSourceRepo.getSource(id)).filter((source): source is NonNullable<typeof source> => Boolean(source))
  assertWorkflowNotCancelled(repositories, run.id)
  const fetched = await contentService.fetch(run, sources, { signal, isCancelled: isCancellationRequested })
  assertWorkflowNotCancelled(repositories, run.id)
  repositories.researchEventRepo.append({
    runId: run.id,
    type: 'research.sources.fetched',
    phase: 'gap_filling',
    payload: { sourceIds: fetched.filter((outcome) => outcome.status === 'fetched').map((outcome) => outcome.sourceId), fetchedCount: fetched.filter((outcome) => outcome.status === 'fetched').length, failedCount: fetched.filter((outcome) => outcome.status !== 'fetched').length },
  })
  repositories.researchIterationRepo!.update(iteration.id, { executedQueryCount: completed.length, newSourceCount })
  return { ...input, queryIds: completed.map((query) => query.id), sourceIds, cancelled: isCancellationRequested() }
}

export function createExecuteIterationRetrievalStep(dependencies: { repositories: DeepResearchRepositories; searchService: ReturnTypeOfSearchService; sourceCurator: SourceCurator; contentService: ReturnTypeOfContentService }) {
  return createStep({
    id: 'deep-research-execute-iteration-retrieval',
    inputSchema: iterationContextSchema,
    outputSchema: iterationContextSchema,
    execute: async ({ inputData }) => executeIterationRetrieval(inputData, dependencies),
  })
}
