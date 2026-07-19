import { createStep } from '@mastra/core/workflows'
import type { JsonValue } from '@shared/deepresearch/contracts'
import { assessCandidateSourceQuality } from '@server/deepresearch/domain/source-quality'
import type { SourceCurator, SourceQueryContext } from '@server/services/deepresearch/source-curator'
import type { ReturnTypeOfContentService, ReturnTypeOfSearchService } from './types'
import type { DeepResearchRepositories } from '../workflow-context'
import { iterationContextSchema, type IterationContext } from './iteration-context'
import { assertWorkflowNotCancelled, getWorkflowExecution } from './checkpoint-replay'
import { recordProductionRunDiagnosticEvents, type ProductionDiagnosticSignal } from '@server/deepresearch/run-diagnostics'

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function buildQueryContexts(repositories: DeepResearchRepositories, runId: string, queryIds: ReadonlySet<string>): Record<string, SourceQueryContext> {
  const questionsById = new Map(repositories.researchQuestionRepo.list(runId).map((question) => [question.id, question]))
  return Object.fromEntries(repositories.researchQuestionRepo.listSearchQueries(runId).flatMap((query) => {
    if (!queryIds.has(query.id)) return []
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
  const queryContexts = buildQueryContexts(repositories, run.id, new Set(completed.map((query) => query.id)))
  const curated = sourceCurator.curate(
    run,
    completed.flatMap((query) => query.candidates.map((candidate) => ({ ...candidate, queryId: query.id }))),
    { maxSources: fetchReservation, queryContexts },
  )
  const curationRejections = curated.rejected ?? []
      recordCandidateAssessments(repositories, run.id, queryContexts, curated.selected, curationRejections)
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
      scores: {
        finalScore: candidate.score,
        queryId: candidate.queryId,
        sourceType: candidate.sourceType,
        breakdown: toJson(candidate.scoreBreakdown),
        diagnostics: toJson(candidate.diagnostics),
      },
    })
    sourceIds.push(source.id)
    newSourceCount += 1
    repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.discovered', phase: 'gap_filling', payload: { id: source.id } })
    repositories.researchEventRepo.append({ runId: run.id, type: 'research.source.selected', phase: 'gap_filling', payload: { id: source.id } })
  }
  for (const rejected of curationRejections) {
    repositories.researchEventRepo.append({
      runId: run.id,
      type: 'research.source.rejected',
      phase: 'gap_filling',
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
  const diagnosticSignals: ProductionDiagnosticSignal[] = [{ kind: 'gap_fill_no_new_sources', iteration: iteration.ordinal, newSourceCount }]
  const selectedScores = curated.selected.map((candidate) => candidate.score).filter((score): score is number => Number.isFinite(score))
  if (selectedScores.length >= 2) diagnosticSignals.push({ kind: 'source_scores_uniform', scores: selectedScores })
  recordProductionRunDiagnosticEvents(repositories, run, 'gap_filling', diagnosticSignals)
  return { ...input, queryIds: completed.map((query) => query.id), sourceIds, cancelled: isCancellationRequested() }
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
export function createExecuteIterationRetrievalStep(dependencies: { repositories: DeepResearchRepositories; searchService: ReturnTypeOfSearchService; sourceCurator: SourceCurator; contentService: ReturnTypeOfContentService }) {
  return createStep({
    id: 'deep-research-execute-iteration-retrieval',
    inputSchema: iterationContextSchema,
    outputSchema: iterationContextSchema,
    execute: async ({ inputData }) => executeIterationRetrieval(inputData, dependencies),
  })
}
