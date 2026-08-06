import type { SkillRunStatus } from '../application/ports'

export type SkillRuntimeCorrelation = {
  requestId?: string
  runId?: string
  skillVersionId?: string
  packageId?: string
  workerId?: string
  grantId?: string
  artifactId?: string
}

type MetricAttribute = string | number | boolean
type MetricKind = 'queue' | 'run' | 'capability' | 'artifact' | 'import'

export type SkillRuntimeMetricPoint = {
  timestamp: number
  kind: MetricKind
  value: number
  attributes: Record<string, MetricAttribute>
}

export type SkillRuntimeMetricCounters = {
  queueDepth: number
  queueLagMs: number
  leaseExpired: number
  retry: number
  deadLetter: number
  artifactBytes: number
  approvalWaitMs: number
  runDurationMs: number
  capabilityCalls: number
  capabilityLatencyMs: number
  importRejects: Record<string, number>
  runsByStatus: Record<string, number>
  capabilityErrors: Record<string, number>
}

export type SkillRuntimeMetricSnapshot = {
  generatedAt: number
  retentionMs: number
  counters: SkillRuntimeMetricCounters
  points: SkillRuntimeMetricPoint[]
}

export type SkillRuntimeMetricsOptions = {
  now?: () => number
  retentionMs?: number
  maxPoints?: number
}

export type RecordRunMetricInput = {
  status: SkillRunStatus | string
  durationMs?: number
  queueDepth?: number
  queueLagMs?: number
  leaseExpired?: boolean
  retry?: boolean
  deadLetter?: boolean
  approvalWaitMs?: number
  artifactBytes?: number
  importRejectReason?: string
  correlation?: SkillRuntimeCorrelation
}

export type RecordCapabilityMetricInput = {
  capability: string
  durationMs?: number
  outcome: 'success' | 'error' | string
  errorCode?: string | null
  correlation?: SkillRuntimeCorrelation
}

export type RecordQueueMetricInput = {
  depth?: number
  lagMs?: number
  leaseExpired?: boolean
  retry?: boolean
  deadLetter?: boolean
  correlation?: SkillRuntimeCorrelation
}

const RUN_STATUSES = new Set([
  'created', 'validating', 'running', 'waiting_input', 'waiting_approval',
  'completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted',
])
const CAPABILITIES = new Set([
  'web.search', 'web.fetch', 'web.extract', 'web.screenshot',
  'document.read_uploaded', 'image.generate', 'filesystem.read', 'filesystem.write',
  'model.invoke', 'artifact.create', 'artifact.export',
])
const CAPABILITY_ERROR_CODES = new Set([
  'TIMEOUT', 'DENIED', 'DISABLED', 'NOT_SUPPORTED', 'APPROVAL_REQUIRED',
  'RATE_LIMITED', 'BUDGET_EXHAUSTED', 'VALIDATION_ERROR', 'EXECUTION_ERROR',
  'IMAGE_GENERATION_FAILED', 'ABORTED', 'UNKNOWN_ERROR',
])
const IMPORT_REJECT_REASONS = new Set([
  'unsupported_capability', 'invalid_manifest', 'security_policy', 'size_limit',
  'file_limit', 'archive_corrupt', 'source_not_allowed', 'unsupported_runtime',
  'review_required', 'fingerprint_changed', 'unknown',
])

function finiteNonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function safeBoolean(value: boolean | undefined): boolean {
  return value === true
}

function safeEnum(value: string | undefined, allowed: ReadonlySet<string>): string {
  return value && allowed.has(value) ? value : 'unknown'
}

function safeCapability(value: string | undefined): string {
  return value && CAPABILITIES.has(value) ? value : 'unknown'
}

function safeErrorCode(value: string | null | undefined): string {
  return value && CAPABILITY_ERROR_CODES.has(value) ? value : 'unknown'
}

function safeImportRejectReason(value: string | undefined): string {
  return value && IMPORT_REJECT_REASONS.has(value) ? value : 'unknown'
}

function safeTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : Date.now()
}

function cloneCounters(counters: SkillRuntimeMetricCounters): SkillRuntimeMetricCounters {
  return {
    queueDepth: counters.queueDepth,
    queueLagMs: counters.queueLagMs,
    leaseExpired: counters.leaseExpired,
    retry: counters.retry,
    deadLetter: counters.deadLetter,
    artifactBytes: counters.artifactBytes,
    approvalWaitMs: counters.approvalWaitMs,
    runDurationMs: counters.runDurationMs,
    capabilityCalls: counters.capabilityCalls,
    capabilityLatencyMs: counters.capabilityLatencyMs,
    importRejects: { ...counters.importRejects },
    runsByStatus: { ...counters.runsByStatus },
    capabilityErrors: { ...counters.capabilityErrors },
  }
}

type MetricEvent = {
  point: SkillRuntimeMetricPoint
  counters: Partial<SkillRuntimeMetricCounters> & {
    importRejectReason?: string
    runStatus?: string
    capabilityError?: string
  }
}

export class SkillRuntimeMetrics {
  private static processGlobal: SkillRuntimeMetrics | undefined
  private readonly now: () => number
  readonly retentionMs: number
  readonly maxPoints: number
  private events: MetricEvent[] = []

  constructor(options: SkillRuntimeMetricsOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.retentionMs = options.retentionMs ?? 60 * 60 * 1000
    this.maxPoints = options.maxPoints ?? 5_000
    if (!Number.isFinite(this.retentionMs) || this.retentionMs < 1) throw new Error('retentionMs must be a positive number')
    if (!Number.isInteger(this.maxPoints) || this.maxPoints < 1) throw new Error('maxPoints must be a positive integer')
  }

  static global(): SkillRuntimeMetrics {
    SkillRuntimeMetrics.processGlobal ??= new SkillRuntimeMetrics()
    return SkillRuntimeMetrics.processGlobal
  }

  static resetGlobalForTests(): void {
    SkillRuntimeMetrics.processGlobal = new SkillRuntimeMetrics()
  }

  recordRun(input: RecordRunMetricInput): void {
    const timestamp = safeTimestamp(this.now())
    const status = safeEnum(input.status, RUN_STATUSES)
    const durationMs = finiteNonNegative(input.durationMs)
    const queueDepth = finiteNonNegative(input.queueDepth)
    const queueLagMs = finiteNonNegative(input.queueLagMs)
    const leaseExpired = safeBoolean(input.leaseExpired)
    const retry = safeBoolean(input.retry)
    const deadLetter = safeBoolean(input.deadLetter)
    const approvalWaitMs = finiteNonNegative(input.approvalWaitMs)
    const artifactBytes = finiteNonNegative(input.artifactBytes)
    const importRejectReason = input.importRejectReason === undefined ? undefined : safeImportRejectReason(input.importRejectReason)

    const attributes: Record<string, MetricAttribute> = {
      status,
      ...(leaseExpired ? { lease_expired: true } : {}),
      ...(retry ? { retry: true } : {}),
      ...(deadLetter ? { dead_letter: true } : {}),
      ...(importRejectReason ? { import_reject_reason: importRejectReason } : {}),
    }
    this.push({
      point: { timestamp, kind: 'run', value: durationMs, attributes },
      counters: {
        queueDepth,
        queueLagMs,
        leaseExpired: leaseExpired ? 1 : 0,
        retry: retry ? 1 : 0,
        deadLetter: deadLetter ? 1 : 0,
        artifactBytes,
        approvalWaitMs,
        runDurationMs: durationMs,
        ...(importRejectReason ? { importRejectReason } : {}),
        runStatus: status,
      },
    })
  }

  recordCapability(input: RecordCapabilityMetricInput): void {
    const timestamp = safeTimestamp(this.now())
    const capability = safeCapability(input.capability)
    const outcome = input.outcome === 'success' || input.outcome === 'error' ? input.outcome : 'unknown'
    const durationMs = finiteNonNegative(input.durationMs)
    const errorCode = outcome === 'error' ? safeErrorCode(input.errorCode) : 'none'
    this.push({
      point: {
        timestamp,
        kind: 'capability',
        value: durationMs,
        attributes: { capability, outcome, error_code: errorCode },
      },
      counters: {
        capabilityCalls: 1,
        capabilityLatencyMs: durationMs,
        ...(outcome === 'error' ? { capabilityError: errorCode } : {}),
      },
    })
  }

  recordQueue(input: RecordQueueMetricInput): void {
    const timestamp = safeTimestamp(this.now())
    const depth = finiteNonNegative(input.depth)
    const lagMs = finiteNonNegative(input.lagMs)
    const leaseExpired = safeBoolean(input.leaseExpired)
    const retry = safeBoolean(input.retry)
    const deadLetter = safeBoolean(input.deadLetter)
    this.push({
      point: {
        timestamp,
        kind: 'queue',
        value: depth,
        attributes: {
          ...(leaseExpired ? { lease_expired: true } : {}),
          ...(retry ? { retry: true } : {}),
          ...(deadLetter ? { dead_letter: true } : {}),
        },
      },
      counters: {
        queueDepth: depth,
        queueLagMs: lagMs,
        leaseExpired: leaseExpired ? 1 : 0,
        retry: retry ? 1 : 0,
        deadLetter: deadLetter ? 1 : 0,
      },
    })
  }

  recordArtifact(bytes: number, correlation?: SkillRuntimeCorrelation): void {
    const timestamp = safeTimestamp(this.now())
    const value = finiteNonNegative(bytes)
    this.push({
      point: { timestamp, kind: 'artifact', value, attributes: {} },
      counters: { artifactBytes: value },
    })
  }

  recordImportReject(reason: string, correlation?: SkillRuntimeCorrelation): void {
    const timestamp = safeTimestamp(this.now())
    const safeReason = safeImportRejectReason(reason)
    this.push({
      point: { timestamp, kind: 'import', value: 1, attributes: { reason: safeReason } },
      counters: { importRejectReason: safeReason },
    })
  }

  snapshot(): SkillRuntimeMetricSnapshot {
    this.prune()
    const counters = emptyCounters()
    for (const event of this.events) {
      const delta = event.counters
      if (delta.queueDepth !== undefined) counters.queueDepth = delta.queueDepth
      if (delta.queueLagMs !== undefined) counters.queueLagMs = delta.queueLagMs
      counters.leaseExpired += delta.leaseExpired ?? 0
      counters.retry += delta.retry ?? 0
      counters.deadLetter += delta.deadLetter ?? 0
      counters.artifactBytes += delta.artifactBytes ?? 0
      counters.approvalWaitMs += delta.approvalWaitMs ?? 0
      counters.runDurationMs += delta.runDurationMs ?? 0
      counters.capabilityCalls += delta.capabilityCalls ?? 0
      counters.capabilityLatencyMs += delta.capabilityLatencyMs ?? 0
      if (delta.importRejectReason) counters.importRejects[delta.importRejectReason] = (counters.importRejects[delta.importRejectReason] ?? 0) + 1
      if (delta.runStatus) counters.runsByStatus[delta.runStatus] = (counters.runsByStatus[delta.runStatus] ?? 0) + 1
      if (delta.capabilityError) counters.capabilityErrors[delta.capabilityError] = (counters.capabilityErrors[delta.capabilityError] ?? 0) + 1
    }
    return {
      generatedAt: safeTimestamp(this.now()),
      retentionMs: this.retentionMs,
      counters: cloneCounters(counters),
      points: this.events.map((event) => ({ ...event.point, attributes: { ...event.point.attributes } })),
    }
  }

  private push(event: MetricEvent): void {
    this.prune()
    this.events.push(event)
    if (this.events.length > this.maxPoints) this.events.splice(0, this.events.length - this.maxPoints)
  }

  private prune(): void {
    const cutoff = safeTimestamp(this.now()) - this.retentionMs
    this.events = this.events.filter((event) => event.point.timestamp >= cutoff)
    if (this.events.length > this.maxPoints) this.events.splice(0, this.events.length - this.maxPoints)
  }
}

function emptyCounters(): SkillRuntimeMetricCounters {
  return {
    queueDepth: 0,
    queueLagMs: 0,
    leaseExpired: 0,
    retry: 0,
    deadLetter: 0,
    artifactBytes: 0,
    approvalWaitMs: 0,
    runDurationMs: 0,
    capabilityCalls: 0,
    capabilityLatencyMs: 0,
    importRejects: {},
    runsByStatus: {},
    capabilityErrors: {},
  }
}

export function recordRunMetric(input: RecordRunMetricInput): void {
  try { SkillRuntimeMetrics.global().recordRun(input) } catch { /* observability must never block runtime execution */ }
}

export function recordCapabilityMetric(input: RecordCapabilityMetricInput): void {
  try { SkillRuntimeMetrics.global().recordCapability(input) } catch { /* observability must never block runtime execution */ }
}

export function resetSkillRuntimeMetricsForTests(): void {
  SkillRuntimeMetrics.resetGlobalForTests()
}
