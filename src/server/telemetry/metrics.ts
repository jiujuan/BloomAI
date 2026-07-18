import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { metrics, type Attributes, type Span } from '@opentelemetry/api'
import { readConfigValue } from '../config/config'
import { getTracer, SpanStatusCode } from './tracer'

let _meterProvider: MeterProvider | null = null
let _deepResearchMetrics: ReturnType<typeof createDeepResearchMetrics> | null = null

/**
 * Initialize the global OTel MeterProvider. Must be called after loadDotEnv()
 * and before the first request is processed.
 *
 * - OTEL_ENABLED=false               → no-op
 * - OTEL_EXPORTER_OTLP_ENDPOINT set  → OTLP/HTTP exporter
 * - Otherwise                        → ConsoleMetricExporter (local development fallback)
 *
 * Metrics are exported every 30 s. Call shutdownMetrics() on process exit to flush.
 */
export function initMetrics(): void {
  if (readConfigValue('OTEL_ENABLED', 'true').value === 'false') return

  const endpoint = readConfigValue('OTEL_EXPORTER_OTLP_ENDPOINT', '').value
  const exporter = endpoint
    ? new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` })
    : new ConsoleMetricExporter()

  _meterProvider = new MeterProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'bloomai',
      [ATTR_SERVICE_VERSION]: '0.3.0',
    }),
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 30_000 })],
  })

  metrics.setGlobalMeterProvider(_meterProvider)
}

/** Flush pending metric batches and shut down the provider. Call on SIGTERM/SIGINT. */
export async function shutdownMetrics(): Promise<void> {
  if (_meterProvider) await _meterProvider.shutdown()
}

/**
 * Get a named Meter from the global MeterProvider. Returns a no-op Meter when
 * metrics are disabled. Always call this inside a function body (not at module
 * top level) so it runs after initMetrics() has registered the global provider.
 */
export function getMeter(name: string) {
  return metrics.getMeter(name, '0.3.0')
}

export interface DeepResearchTelemetryContext {
  /** Trace-only correlation values. Metric attributes always remove them. */
  researchRunId?: string | null
  workflowRunId?: string | null
  profile?: string | null
  depth?: string | null
  phase?: string | null
  counts?: Record<string, number | null | undefined>
}

export type DeepResearchCoverageVerdict = 'covered' | 'limited' | 'uncovered' | 'blocked'
export type DeepResearchStopReason =
  | 'stop_covered'
  | 'stop_budget'
  | 'stop_no_material_gain'
  | 'stop_no_actionable_gaps'
  | 'stop_cancelled'
  | 'stop_max_iterations'
  | 'stop_blocked'
export type DeepResearchResumeOutcome = 'succeeded' | 'rejected' | 'failed'

const SAFE_PROFILES = new Set(['general', 'market', 'competitor', 'academic'])
const SAFE_DEPTHS = new Set(['standard', 'deep', 'exhaustive'])
const SAFE_COUNT_KEYS = new Set(['queries', 'candidates', 'sources', 'fetched', 'evidence', 'claims', 'limitations', 'selected'])
const SAFE_PHASES = new Set([
  'queued', 'planning', 'researching', 'searching', 'fetching', 'extracting', 'assessing_coverage',
  'gap_filling', 'building_outline', 'drafting', 'verifying', 'finalizing', 'finalizing_artifacts',
  'awaiting_input', 'cancelling', 'cancelled', 'interrupted', 'failed', 'completed',
  'completed_with_limitations',
])
const SAFE_STOP_REASONS = new Set<DeepResearchStopReason>([
  'stop_covered', 'stop_budget', 'stop_no_material_gain', 'stop_no_actionable_gaps',
  'stop_cancelled', 'stop_max_iterations', 'stop_blocked',
])
const SAFE_VERDICTS = new Set<DeepResearchCoverageVerdict>(['covered', 'limited', 'uncovered', 'blocked'])
const SAFE_RESUME_OUTCOMES = new Set<DeepResearchResumeOutcome>(['succeeded', 'rejected', 'failed'])

function safeEnum(value: string | null | undefined, allowed: ReadonlySet<string>): string {
  return value && allowed.has(value) ? value : 'unknown'
}

/**
 * Trace attributes use only fixed lifecycle dimensions and numeric counters.
 * The caller must never put topic, provider payloads, URLs, paths or errors in
 * this context. IDs are intentionally retained for in-process trace correlation
 * but are stripped from all exported metric attributes below.
 */
export function deepResearchTraceAttributes(context: DeepResearchTelemetryContext = {}): Attributes {
  const attributes: Attributes = {}
  if (context.researchRunId) attributes['research.run.id'] = context.researchRunId
  if (context.workflowRunId) attributes['workflow.run.id'] = context.workflowRunId
  if (context.profile) attributes.profile = safeEnum(context.profile, SAFE_PROFILES)
  if (context.depth) attributes.depth = safeEnum(context.depth, SAFE_DEPTHS)
  if (context.phase) attributes.phase = safeEnum(context.phase, SAFE_PHASES)

  for (const [key, value] of Object.entries(context.counts ?? {})) {
    if (!Number.isFinite(value)) continue
    if (!SAFE_COUNT_KEYS.has(key)) continue
    attributes['research.count.' + key] = value as number
  }
  return attributes
}

export function setDeepResearchSpanCounts(span: Span, counts: DeepResearchTelemetryContext['counts'] = {}): void {
  span.setAttributes(deepResearchTraceAttributes({ counts }))
}

export async function traceDeepResearchPhase<T>(
  phase: string,
  context: DeepResearchTelemetryContext,
  operation: (span: Span) => T | Promise<T>,
): Promise<T> {
  const safePhase = safeEnum(phase, SAFE_PHASES)
  const attributes = deepResearchTraceAttributes({ ...context, phase: safePhase })
  const tracer = getTracer('bloomai.deepresearch')

  return tracer.startActiveSpan('deepresearch.' + safePhase, { attributes }, async (span) => {
    try {
      return await operation(span)
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error
    } finally {
      span.end()
    }
  })
}

/** Metric attributes are deliberately a smaller, non-correlating subset. */
function deepResearchMetricAttributes(context: DeepResearchTelemetryContext = {}): Attributes {
  const attributes = deepResearchTraceAttributes(context)
  delete attributes['research.run.id']
  delete attributes['workflow.run.id']
  return attributes
}

function createDeepResearchMetrics() {
  const meter = getMeter('bloomai.deepresearch')
  return {
    completed: meter.createCounter('deepresearch.run.completed.count'),
    completedWithLimitations: meter.createCounter('deepresearch.run.completed_with_limitations.count'),
    cancelled: meter.createCounter('deepresearch.run.cancelled.count'),
    failed: meter.createCounter('deepresearch.run.failed.count'),
    resumed: meter.createCounter('deepresearch.run.resumed.count'),
    searchLatency: meter.createHistogram('deepresearch.search.latency.ms'),
    fetchLatency: meter.createHistogram('deepresearch.fetch.latency.ms'),
    sourcesSelected: meter.createHistogram('deepresearch.sources.selected.count'),
    evidenceCount: meter.createHistogram('deepresearch.evidence.count'),
    claimVerification: meter.createCounter('deepresearch.claim.verification.count'),
    gapIterations: meter.createHistogram('deepresearch.gap.iterations.count'),
    e2eDuration: meter.createHistogram('deepresearch.run.duration.ms'),
    coverageVerdict: meter.createCounter('deepresearch.coverage.verdict.count'),
    coverageScore: meter.createHistogram('deepresearch.coverage.score'),
    iterationOrdinal: meter.createHistogram('deepresearch.iteration.ordinal'),
    iterationEvidenceDelta: meter.createHistogram('deepresearch.iteration.evidence_delta'),
    iterationCoverageScoreDelta: meter.createHistogram('deepresearch.iteration.coverage_score_delta'),
    stopReason: meter.createCounter('deepresearch.stop.reason.count'),
    budgetExhausted: meter.createCounter('deepresearch.budget.exhausted.count'),
    noMaterialGain: meter.createCounter('deepresearch.iteration.no_material_gain.count'),
    cancellationLatency: meter.createHistogram('deepresearch.cancellation.latency.ms'),
    externalCallsAfterCancellation: meter.createCounter('deepresearch.cancellation.external_calls_after_request.count'),
    resumeOutcome: meter.createCounter('deepresearch.resume.outcome.count'),
    checkpointReused: meter.createCounter('deepresearch.checkpoint.reused.count'),
    leaseRejectedWrite: meter.createCounter('deepresearch.lease.rejected_write.count'),
    attemptDuration: meter.createHistogram('deepresearch.attempt.duration.ms'),
  }
}

function getDeepResearchMetrics() {
  _deepResearchMetrics ??= createDeepResearchMetrics()
  return _deepResearchMetrics
}

export function recordDeepResearchCompletion(releaseStatus: 'completed' | 'completed_with_limitations', context: DeepResearchTelemetryContext = {}): void {
  const instruments = getDeepResearchMetrics()
  const attributes = deepResearchMetricAttributes(context)
  if (releaseStatus === 'completed') instruments.completed.add(1, attributes)
  else instruments.completedWithLimitations.add(1, attributes)
}

export function recordDeepResearchCancellation(context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().cancelled.add(1, deepResearchMetricAttributes(context))
}

export function recordDeepResearchFailure(context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().failed.add(1, deepResearchMetricAttributes(context))
}

export function recordDeepResearchResume(context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().resumed.add(1, deepResearchMetricAttributes(context))
}

export function recordDeepResearchSearchLatency(durationMs: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(durationMs)) getDeepResearchMetrics().searchLatency.record(durationMs, deepResearchMetricAttributes(context))
}

export function recordDeepResearchFetchLatency(durationMs: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(durationMs)) getDeepResearchMetrics().fetchLatency.record(durationMs, deepResearchMetricAttributes(context))
}

export function recordDeepResearchSourcesSelected(count: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(count)) getDeepResearchMetrics().sourcesSelected.record(count, deepResearchMetricAttributes(context))
}

export function recordDeepResearchEvidenceCount(count: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(count)) getDeepResearchMetrics().evidenceCount.record(count, deepResearchMetricAttributes(context))
}

export function recordDeepResearchClaimVerification(count: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(count)) getDeepResearchMetrics().claimVerification.add(count, deepResearchMetricAttributes(context))
}

export function recordDeepResearchGapIterations(count: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(count)) getDeepResearchMetrics().gapIterations.record(count, deepResearchMetricAttributes(context))
}

export function recordDeepResearchE2EDuration(durationMs: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(durationMs)) getDeepResearchMetrics().e2eDuration.record(durationMs, deepResearchMetricAttributes(context))
}

export function recordDeepResearchAssessment(
  assessment: { verdict: DeepResearchCoverageVerdict | string; score: number },
  context: DeepResearchTelemetryContext = {},
): void {
  const instruments = getDeepResearchMetrics()
  const attributes = { ...deepResearchMetricAttributes(context), 'research.coverage.verdict': safeEnum(assessment.verdict, SAFE_VERDICTS) }
  instruments.coverageVerdict.add(1, attributes)
  if (Number.isFinite(assessment.score)) instruments.coverageScore.record(assessment.score, attributes)
}

export function recordDeepResearchIteration(
  iteration: { ordinal: number; evidenceDelta: number; scoreDelta: number },
  context: DeepResearchTelemetryContext = {},
): void {
  const instruments = getDeepResearchMetrics()
  const attributes = deepResearchMetricAttributes(context)
  if (Number.isFinite(iteration.ordinal)) instruments.iterationOrdinal.record(iteration.ordinal, attributes)
  if (Number.isFinite(iteration.evidenceDelta)) instruments.iterationEvidenceDelta.record(iteration.evidenceDelta, attributes)
  if (Number.isFinite(iteration.scoreDelta)) instruments.iterationCoverageScoreDelta.record(iteration.scoreDelta, attributes)
}

export function recordDeepResearchStopReason(stopReason: DeepResearchStopReason | string, context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().stopReason.add(1, {
    ...deepResearchMetricAttributes(context),
    'research.stop.reason': safeEnum(stopReason, SAFE_STOP_REASONS),
  })
}

export function recordDeepResearchBudgetExhausted(context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().budgetExhausted.add(1, deepResearchMetricAttributes(context))
}

export function recordDeepResearchNoMaterialGain(context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().noMaterialGain.add(1, deepResearchMetricAttributes(context))
}

export function recordDeepResearchCancellationLatency(durationMs: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(durationMs) && durationMs >= 0) getDeepResearchMetrics().cancellationLatency.record(durationMs, deepResearchMetricAttributes(context))
}

export function recordDeepResearchExternalCallsAfterCancellation(count: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(count) && count >= 0) getDeepResearchMetrics().externalCallsAfterCancellation.add(count, deepResearchMetricAttributes(context))
}

export function recordDeepResearchResumeOutcome(outcome: DeepResearchResumeOutcome | string, context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().resumeOutcome.add(1, {
    ...deepResearchMetricAttributes(context),
    'research.resume.outcome': safeEnum(outcome, SAFE_RESUME_OUTCOMES),
  })
}

export function recordDeepResearchCheckpointReuse(context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().checkpointReused.add(1, deepResearchMetricAttributes(context))
}

export function recordDeepResearchLeaseRejectedWrite(context: DeepResearchTelemetryContext = {}): void {
  getDeepResearchMetrics().leaseRejectedWrite.add(1, deepResearchMetricAttributes(context))
}

export function recordDeepResearchAttemptDuration(durationMs: number, context: DeepResearchTelemetryContext = {}): void {
  if (Number.isFinite(durationMs) && durationMs >= 0) getDeepResearchMetrics().attemptDuration.record(durationMs, deepResearchMetricAttributes(context))
}
