import { getSkillRuntimeConfig } from '../config/skill-runtime.config'
import type { SkillRuntimeConfig } from '../config/skill-runtime.config'
import type { SkillRunQueueSnapshot } from '../application/ports'
import { SkillRuntimeMetrics, type SkillRuntimeMetricSnapshot } from './skill-runtime.metrics'
import { sanitizeErrorMessage } from '../../logger/logger'

export type RuntimeDiagnosticsConfig = Partial<Pick<SkillRuntimeConfig,
  'protocolVersion' | 'configVersion' | 'runtimeEnabled' | 'packageExecutionEnabled' | 'workerConcurrency' | 'eventRetentionDays' | 'artifactRetentionDays'
>> & {
  policyVersion?: string
  logRetentionDays?: number
  metricsRetentionMinutes?: number
}

export type RuntimeMigrationStatus = {
  current: string | null
  applied: string[]
  pending: string[]
}

export type RuntimeWorkerStatus = {
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' | 'not_configured' | string
  workerId?: string | null
  lastError?: string | null
  heartbeatAt?: number | null
  activeRuns?: number
  concurrency?: number
}

export type RuntimeHealthCheck = {
  name: string
  status: 'ok' | 'warning' | 'failed'
  message?: string
}

export type RuntimeAvailability = 'healthy' | 'degraded' | 'disabled'
export type RuntimeLegacyHealthStatus = 'ready' | 'not_ready' | 'degraded'

export type RuntimeHealth = {
  liveness: boolean
  readiness: boolean
  status: RuntimeAvailability
  availability: RuntimeAvailability
  /** Compatibility value for consumers that still understand the pre-v1.2 names. */
  legacyStatus: RuntimeLegacyHealthStatus
  checks: RuntimeHealthCheck[]
}

export type RuntimeQueueDiagnostics = {
  depth: number
  queued: number
  leased: number
  retryWait: number
  dead: number
  lagMs: number
}

export type RuntimeDiagnosticsFailure = {
  runId?: string
  status?: string
  errorCode?: string | null
  errorMessage?: string | null
  updatedAt?: number
}

export type RuntimeDiagnosticsSnapshot = {
  generatedAt: number
  health: RuntimeHealth
  worker: RuntimeWorkerStatus
  queue: RuntimeQueueDiagnostics
  migration: RuntimeMigrationStatus
  policy: { version: string; configVersion: string }
  configuration: {
    workerConcurrency: number
    packageExecutionEnabled: boolean
    runtimeEnabled: boolean
  }
  metrics: SkillRuntimeMetricSnapshot
  recentFailures: RuntimeDiagnosticsFailure[]
}

export type RuntimeDiagnosticsInput = {
  now?: () => number
  config?: RuntimeDiagnosticsConfig
  queue?: readonly SkillRunQueueSnapshot[]
  worker?: RuntimeWorkerStatus
  migrations?: RuntimeMigrationStatus
  metrics?: SkillRuntimeMetrics
  recentFailures?: readonly RuntimeDiagnosticsFailure[]
}

function nowValue(now?: () => number): number {
  const value = now?.() ?? Date.now()
  return Number.isFinite(value) ? value : Date.now()
}

function safeVersion(value: string | undefined | null): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : 'unknown'
}

function safeError(value: string | null | undefined): string | null {
  if (!value) return null
  const sanitized = sanitizeErrorMessage(value)
    .replace(/\b(?:authorization|bearer|token|secret|password|credential)\s*[=:]\s*[^\s,;]+/gi, (match) => {
      const separator = match.includes('=') ? '=' : ':'
      const key = match.split(/[=:]/, 1)[0].trim()
      return `${key}${separator}[REDACTED]`
    })
    .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
  return sanitized.slice(0, 500)
}

export function getRuntimeHealth(input: Pick<RuntimeDiagnosticsInput, 'config' | 'migrations' | 'worker'> = {}): RuntimeHealth {
  const config = (input.config ?? getSkillRuntimeConfig()) as RuntimeDiagnosticsConfig
  const migrations = input.migrations ?? { current: null, applied: [], pending: [] }
  const worker = input.worker
  const checks: RuntimeHealthCheck[] = []
  const runtimeEnabled = config.runtimeEnabled !== false
  const executionEnabled = config.packageExecutionEnabled !== false
  const migrationsReady = migrations.pending.length === 0

  checks.push(runtimeEnabled
    ? { name: 'runtime', status: 'ok' }
    : { name: 'runtime', status: 'failed', message: 'Skill Runtime is disabled' })
  checks.push(executionEnabled
    ? { name: 'package_execution', status: 'ok' }
    : { name: 'package_execution', status: 'warning', message: 'Package execution is disabled' })
  checks.push(migrationsReady
    ? { name: 'migrations', status: 'ok' }
    : { name: 'migrations', status: 'failed', message: 'Database migrations are pending' })

  const readiness = runtimeEnabled && executionEnabled && migrationsReady
  const workerDegraded = worker?.status === 'crashed'
  if (workerDegraded) checks.push({ name: 'worker', status: 'warning', message: safeError(worker?.lastError) ?? 'Worker crashed' })
  else if (worker && worker.status !== 'running' && readiness) checks.push({ name: 'worker', status: 'warning', message: `Worker status: ${worker.status}` })

  const availability: RuntimeAvailability = !runtimeEnabled
    ? 'disabled'
    : !readiness || workerDegraded
      ? 'degraded'
      : 'healthy'
  const legacyStatus: RuntimeLegacyHealthStatus = !readiness
    ? 'not_ready'
    : workerDegraded
      ? 'degraded'
      : 'ready'

  return {
    liveness: true,
    readiness,
    status: availability,
    availability,
    legacyStatus,
    checks,
  }
}

export function getRuntimeDiagnostics(input: RuntimeDiagnosticsInput = {}): RuntimeDiagnosticsSnapshot {
  const now = nowValue(input.now)
  const queueItems = input.queue ?? []
  const queued = queueItems.filter((item) => item.status === 'queued').length
  const leased = queueItems.filter((item) => item.status === 'leased').length
  const retryWait = queueItems.filter((item) => item.status === 'retry_wait').length
  const dead = queueItems.filter((item) => item.status === 'dead').length
  const lagCandidates = queueItems
    .filter((item) => item.status === 'queued' || item.status === 'retry_wait')
    .map((item) => Math.max(0, now - item.availableAt))
  const queue: RuntimeQueueDiagnostics = {
    depth: queueItems.filter((item) => item.status !== 'done').length,
    queued,
    leased,
    retryWait,
    dead,
    lagMs: lagCandidates.length ? Math.max(...lagCandidates) : 0,
  }
  const config = (input.config ?? getSkillRuntimeConfig()) as RuntimeDiagnosticsConfig
  const migrations = input.migrations ?? { current: null, applied: [], pending: [] }
  const worker = input.worker ?? { status: 'not_configured' as const }
  const metrics = input.metrics ?? SkillRuntimeMetrics.global()
  const recentFailures = [...(input.recentFailures ?? [])]
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(0, 50)
    .map((failure) => ({
      ...(failure.runId ? { runId: failure.runId.slice(0, 128) } : {}),
      ...(failure.status ? { status: failure.status.slice(0, 64) } : {}),
      ...(failure.errorCode ? { errorCode: failure.errorCode.slice(0, 128) } : {}),
      ...(failure.errorMessage ? { errorMessage: safeError(failure.errorMessage) } : {}),
      ...(failure.updatedAt !== undefined ? { updatedAt: failure.updatedAt } : {}),
    }))

  return {
    generatedAt: now,
    health: getRuntimeHealth({ config, migrations, worker }),
    worker: {
      status: worker.status,
      ...(worker.workerId ? { workerId: worker.workerId.slice(0, 128) } : {}),
      ...(worker.lastError ? { lastError: safeError(worker.lastError) } : {}),
      ...(worker.heartbeatAt !== undefined ? { heartbeatAt: worker.heartbeatAt } : {}),
      ...(worker.activeRuns !== undefined ? { activeRuns: Math.max(0, worker.activeRuns) } : {}),
      ...(worker.concurrency !== undefined ? { concurrency: Math.max(0, worker.concurrency) } : {}),
    },
    queue,
    migration: {
      current: migrations.current ? safeVersion(migrations.current) : null,
      applied: migrations.applied.map(safeVersion),
      pending: migrations.pending.map(safeVersion),
    },
    policy: {
      version: safeVersion(config.policyVersion),
      configVersion: safeVersion(config.configVersion),
    },
    configuration: {
      workerConcurrency: Number.isSafeInteger(config.workerConcurrency) ? config.workerConcurrency as number : 1,
      packageExecutionEnabled: config.packageExecutionEnabled !== false,
      runtimeEnabled: config.runtimeEnabled !== false,
    },
    metrics: metrics.snapshot(),
    recentFailures,
  }
}
