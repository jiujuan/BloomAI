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
 * - OTEL_EXPORTER_OTLP_ENDPOINT set  → OTLP/HTTP to Prometheus / Grafana Tempo / …
 * - Otherwise                        → ConsoleMetricExporter (stdout, dev fallback)
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

/** Flush pending metric batches and shut down. Call on SIGTERM/SIGINT. */
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
  researchRunId?: string | null
  workflowRunId?: string | null
  profile?: string | null
  depth?: string | null
  phase?: string | null
  counts?: Record<string, number | null | undefined>
}

function safeDeepResearchPhase(value: string | null | undefined): string {
  if (!value || !/^[a-z][a-z0-9_.-]*$/i.test(value)) return 'unknown'
  return value
}

export function deepResearchTraceAttributes(context: DeepResearchTelemetryContext = {}): Attributes {
  const attributes: Attributes = {}
  if (context.researchRunId) attributes['research.run.id'] = context.researchRunId
  if (context.workflowRunId) attributes['workflow.run.id'] = context.workflowRunId
  if (context.profile) attributes.profile = context.profile
  if (context.depth) attributes.depth = context.depth
  if (context.phase) attributes.phase = context.phase

  for (const [key, value] of Object.entries(context.counts ?? {})) {
    if (!Number.isFinite(value)) continue
    if (!/^[a-z][a-z0-9_.-]*$/i.test(key)) continue
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
  const safePhase = safeDeepResearchPhase(phase)
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
