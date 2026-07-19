import type {
  JsonObject,
  ResearchCoverageAssessmentDto,
  ResearchEventDto,
  ResearchModelTraceDto,
  ResearchQuestionDto,
  ResearchRunDiagnosticsDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
} from '@shared/deepresearch/contracts'
import type { ResearchSourceAssessmentRecord } from '@server/db/repositories/deepresearch/research-source.repo'

export type ProductionDiagnosticSignal =
  | { kind: 'tokens_zero' }
  | { kind: 'source_scores_uniform'; scores: number[] }
  | { kind: 'gap_fill_no_new_sources'; iteration: number; newSourceCount: number }
  | { kind: 'high_priority_coverage_zero'; questions: ResearchQuestionDto[] }

const DIAGNOSTIC_EVENT = 'research.run.diagnostic' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function finalSourceScore(source: ResearchSourceDto): number | null {
  const scores = isRecord(source.scores) ? source.scores : {}
  const direct = numberOrNull(scores.finalScore)
  if (direct !== null) return direct
  const breakdown = isRecord(scores.breakdown) ? scores.breakdown : {}
  return numberOrNull(breakdown.final)
}

function highPriorityCoverage(questions: ResearchQuestionDto[]): number | null {
  const highPriority = questions.filter((question) => question.priority === 'high' || question.priority === 'critical')
  if (highPriority.length === 0) return null
  return highPriority.filter((question) => question.status === 'covered').length / highPriority.length
}

function sourceScoresAllSame(scores: number[]): boolean {
  return scores.length >= 2 && scores.every((score) => score === scores[0])
}

function attemptLatency(attempts: Array<{ startedAt: number | null; endedAt: number | null }>): number | null {
  const durations = attempts.flatMap((attempt) => (
    attempt.startedAt !== null && attempt.endedAt !== null && attempt.endedAt >= attempt.startedAt
      ? [attempt.endedAt - attempt.startedAt]
      : []
  ))
  return durations.length > 0 ? durations.reduce((total, value) => total + value, 0) : null
}

function sourceTypeCounts(sources: ResearchSourceDto[]): Record<string, number> {
  return sources.reduce<Record<string, number>>((counts, source) => {
    counts[source.sourceType] = (counts[source.sourceType] ?? 0) + 1
    return counts
  }, {})
}

function snapshotQuality(snapshot: ResearchSourceSnapshotDto): ResearchRunDiagnosticsDto['fetch']['snapshots'][number]['quality'] {
  const extraction = isRecord(snapshot.metadata.extraction) ? snapshot.metadata.extraction : {}
  return {
    rawCharacters: numberOrNull(extraction.rawCharacters),
    mainCharacters: numberOrNull(extraction.mainCharacters),
    paragraphCount: numberOrNull(extraction.paragraphCount),
    contentDensity: numberOrNull(extraction.contentDensity),
    navigationRatio: numberOrNull(extraction.navigationRatio),
    duplicateTextRatio: numberOrNull(extraction.duplicateTextRatio),
    language: stringOrNull(extraction.language),
    readability: numberOrNull(extraction.readability),
    rejectionReasons: stringArray(extraction.rejectionReasons),
  }
}

function toCandidate(assessment: ResearchSourceAssessmentRecord): ResearchRunDiagnosticsDto['sources']['candidates'][number] {
  return {
    id: assessment.id,
    questionId: assessment.questionId,
    queryId: assessment.queryId,
    canonicalUrl: assessment.canonicalUrl,
    originalUrl: assessment.originalUrl,
    domain: assessment.domain,
    title: assessment.title,
    category: assessment.category,
    scoringMethod: assessment.scoringMethod,
    scoreBreakdown: assessment.scoreBreakdown,
    reasons: assessment.reasons,
    rejectionReasons: assessment.rejectionReasons,
    selectionStatus: assessment.selectionStatus,
  }
}

function diagnosticEvents(events: ResearchEventDto[]): ResearchRunDiagnosticsDto['anomalies'] {
  return events.flatMap((event) => {
    if (event.type !== DIAGNOSTIC_EVENT || !isRecord(event.payload)) return []
    const code = event.payload.code
    const severity = event.payload.severity
    const message = event.payload.message
    const details = event.payload.details
    if (!['tokens_zero', 'source_scores_uniform', 'gap_fill_no_new_sources', 'high_priority_coverage_zero'].includes(String(code))) return []
    if (severity !== 'warning' || typeof message !== 'string' || !isRecord(details)) return []
    return [{
      code: code as ResearchRunDiagnosticsDto['anomalies'][number]['code'],
      severity,
      message,
      details: details as JsonObject,
      timestamp: event.timestamp,
    }]
  })
}

export interface BuildResearchRunDiagnosticsInput {
  run: ResearchRunDto
  questions: ResearchQuestionDto[]
  searchQueries: ResearchRunDiagnosticsDto['queries']['items']
  sources: ResearchSourceDto[]
  snapshots: ResearchSourceSnapshotDto[]
  evidence: Array<{ questionId: string }>
  sections: Array<{ id: string; sectionKey?: string | null; title: string; status: 'planned' | 'drafted' | 'verified' | 'limited' }>
  claims: Array<{ id: string; sectionId: string; kind: 'factual' | 'analysis' | 'recommendation' | 'limitation'; importance: 'low' | 'medium' | 'high' | 'critical'; verificationStatus: 'supported' | 'partially_supported' | 'unsupported' | 'not_applicable'; confidence: number }>
  citations: ResearchRunDiagnosticsDto['report']['citations']
  quality: ResearchRunDiagnosticsDto['report']['quality']
  candidateAssessments: ResearchSourceAssessmentRecord[]
  events: ResearchEventDto[]
  attempts: Array<{ modelUsage: { calls: number; inputTokens: number; outputTokens: number }; modelTraces: ResearchModelTraceDto[]; startedAt: number | null; endedAt: number | null }>
  coverageAssessments: ResearchCoverageAssessmentDto[]
}

/** Builds the single safe diagnostics representation returned by the admin API. */
export function buildResearchRunDiagnostics(input: BuildResearchRunDiagnosticsInput): ResearchRunDiagnosticsDto {
  const evidenceCounts = input.evidence.reduce<Map<string, number>>((counts, evidence) => {
    counts.set(evidence.questionId, (counts.get(evidence.questionId) ?? 0) + 1)
    return counts
  }, new Map())
  const failures = input.events.flatMap((event) => {
    if (event.type !== 'research.source.fetch_failed') return []
    const payload = isRecord(event.payload) ? event.payload : {}
    const sourceId = stringOrNull(payload.id)
    const errorCode = stringOrNull(payload.errorCode)
    if (!sourceId || !errorCode) return []
    return [{ sourceId, errorCode, rejectionReason: stringOrNull(payload.rejectionReason) }]
  })
  const rejectedByReason = input.candidateAssessments
    .filter((candidate) => candidate.selectionStatus === 'rejected')
    .flatMap((candidate) => candidate.rejectionReasons.length > 0 ? candidate.rejectionReasons : ['not_selected'])
    .reduce<Record<string, number>>((counts, reason) => {
      counts[reason] = (counts[reason] ?? 0) + 1
      return counts
    }, {})
  const scoreValues = input.candidateAssessments
    .map((candidate) => candidate.scoreBreakdown.final)
    .filter((score): score is number => Number.isFinite(score))
  const calls = input.attempts.reduce((total, attempt) => total + attempt.modelUsage.calls, 0)
  const inputTokens = input.attempts.reduce((total, attempt) => total + attempt.modelUsage.inputTokens, 0)
  const outputTokens = input.attempts.reduce((total, attempt) => total + attempt.modelUsage.outputTokens, 0)
  const traces = input.attempts.flatMap((attempt) => attempt.modelTraces)
  const completedQueries = input.searchQueries.filter((query) => query.status === 'completed').length
  const failedQueries = input.searchQueries.filter((query) => query.status === 'failed').length
  const totalResults = input.searchQueries.reduce((total, query) => total + query.resultCount, 0)
  const succeededSnapshots = input.snapshots.length
  const attemptedFetches = succeededSnapshots + failures.length
  const citationPasses = input.citations.filter((citation) => citation.entailmentStatus === 'supported' && citation.verificationMethod === 'semantic_llm').length

  return {
    run: {
      id: input.run.id,
      status: input.run.status,
      phase: input.run.phase,
      profile: input.run.profile,
      depth: input.run.depth,
      createdAt: input.run.createdAt,
      updatedAt: input.run.updatedAt,
      completedAt: input.run.completedAt,
      error: input.run.error,
    },
    model: {
      mode: input.run.modelSelectionSnapshot ? 'llm_backed' : 'legacy_deterministic',
      selection: input.run.modelSelectionSnapshot ?? null,
      usage: input.run.usage,
      calls,
      inputTokens,
      outputTokens,
      providerCostUsd: input.run.usage.providerCostUsd > 0 ? input.run.usage.providerCostUsd : null,
      latencyMs: attemptLatency(input.attempts),
      traces,
    },
    queries: { total: input.searchQueries.length, completed: completedQueries, failed: failedQueries, resultCount: totalResults, items: input.searchQueries },
    sources: {
      sourceTypeCounts: sourceTypeCounts(input.sources),
      selected: input.sources.map((source) => ({
        id: source.id,
        queryId: stringOrNull(source.scores.queryId),
        title: source.title,
        canonicalUrl: source.canonicalUrl,
        domain: source.domain,
        sourceType: source.sourceType,
        selectionStatus: source.selectionStatus,
        finalScore: finalSourceScore(source),
      })),
      candidates: input.candidateAssessments.map(toCandidate),
      rejectedByReason,
      scoresAllSame: sourceScoresAllSame(scoreValues),
    },
    fetch: {
      attempted: attemptedFetches,
      succeeded: succeededSnapshots,
      failed: failures.length,
      successRate: attemptedFetches > 0 ? succeededSnapshots / attemptedFetches : null,
      snapshots: input.snapshots.map((snapshot) => ({
        sourceId: snapshot.sourceId,
        finalUrl: snapshot.finalUrl,
        fetchedAt: snapshot.fetchedAt,
        httpStatus: snapshot.httpStatus,
        parserVersion: snapshot.parserVersion,
        quality: snapshotQuality(snapshot),
      })),
      failures,
    },
    coverage: {
      highPriorityCoverage: highPriorityCoverage(input.questions),
      questions: input.questions.map((question) => ({ ...question, evidenceCount: evidenceCounts.get(question.id) ?? 0 })),
      evidenceCount: input.evidence.length,
      latestAssessment: input.coverageAssessments[0] ?? null,
    },
    report: {
      sections: input.sections,
      claims: input.claims,
      citations: input.citations,
      citationPassRate: input.citations.length > 0 ? citationPasses / input.citations.length : null,
      quality: input.quality,
      gateResults: input.quality?.gateResults ?? [],
    },
    anomalies: diagnosticEvents(input.events),
  }
}

function eventFor(signal: ProductionDiagnosticSignal): { code: ResearchRunDiagnosticsDto['anomalies'][number]['code']; message: string; details: JsonObject } | null {
  switch (signal.kind) {
    case 'tokens_zero':
      return { code: signal.kind, message: 'A model-backed production Run completed with zero recorded tokens.', details: {} }
    case 'source_scores_uniform':
      return { code: signal.kind, message: 'Candidate source scores are uniform and cannot support meaningful ranking.', details: { sourceCount: signal.scores.length, score: signal.scores[0] ?? null } }
    case 'gap_fill_no_new_sources':
      return { code: signal.kind, message: 'Gap-fill retrieval completed without discovering a new source.', details: { iteration: signal.iteration, newSourceCount: signal.newSourceCount } }
    case 'high_priority_coverage_zero':
      return { code: signal.kind, message: 'High-priority question coverage is zero after assessment.', details: { highPriorityQuestionCount: signal.questions.filter((question) => question.priority === 'high' || question.priority === 'critical').length } }
  }
}

/**
 * Persists each production anomaly at most once per Run. Legacy deterministic
 * Runs are intentionally excluded so their historical zero-token values are
 * never misrepresented as a production model failure.
 */
export function recordProductionRunDiagnosticEvents(
  repositories: { researchEventRepo: { append: (input: { runId: string; type: typeof DIAGNOSTIC_EVENT; phase: string; payload: JsonObject }) => unknown; list?: (runId: string) => ResearchEventDto[] } },
  run: ResearchRunDto,
  phase: string,
  signals: ProductionDiagnosticSignal[],
): void {
  if (!run.modelSelectionSnapshot) return
  const anomalousSignals = signals.filter((signal) => {
    if (signal.kind === 'source_scores_uniform') return sourceScoresAllSame(signal.scores)
    if (signal.kind === 'gap_fill_no_new_sources') return signal.newSourceCount === 0
    if (signal.kind === 'high_priority_coverage_zero') return highPriorityCoverage(signal.questions) === 0
    return true
  })
  const existingCodes = new Set((repositories.researchEventRepo.list?.(run.id) ?? []).flatMap((event) => (
    event.type === DIAGNOSTIC_EVENT && typeof event.payload.code === 'string' ? [event.payload.code] : []
  )))
  for (const signal of anomalousSignals) {
    const diagnostic = eventFor(signal)
    if (!diagnostic || existingCodes.has(diagnostic.code)) continue
    repositories.researchEventRepo.append({
      runId: run.id,
      type: DIAGNOSTIC_EVENT,
      phase,
      payload: { code: diagnostic.code, severity: 'warning', message: diagnostic.message, details: diagnostic.details },
    })
    existingCodes.add(diagnostic.code)
  }
}
