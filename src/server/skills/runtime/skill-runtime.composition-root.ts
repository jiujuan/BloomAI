import { createSqliteSkillRuntimePorts } from '../../db/repositories/skill-package.repo'
import { getSkillRuntimeConfig, type SkillRuntimeConfig } from '../config/skill-runtime.config'
import type { SkillRuntimePorts } from '../application/ports'
import { SkillRunCoordinator } from './skill-run-coordinator'
import { PersistentSkillRunQueue } from './skill-run-queue'
import { SkillRunWorker, type SkillRunAdapter, type SkillRunExecutor } from './skill-run-worker'
import { InstructionAgentAdapter, type InstructionAgentExecutor } from '../adapters/instruction-agent-adapter'
import { SkillRuntimeMetrics } from '../observability/skill-runtime.metrics'
import { SECURITY_POLICY_VERSION } from '../security/skill-security-checklist'
import { getRuntimeDiagnostics as buildRuntimeDiagnostics, getRuntimeHealth as buildRuntimeHealth, type RuntimeDiagnosticsSnapshot, type RuntimeHealth, type RuntimeMigrationStatus } from '../observability/skill-runtime.diagnostics'

export type SkillRuntimeCompositionOptions = {
  readonly config?: SkillRuntimeConfig
  readonly ports?: SkillRuntimePorts
  readonly coordinator?: SkillRunCoordinator
  readonly queue?: PersistentSkillRunQueue
  readonly executor?: SkillRunExecutor
  readonly adapter?: SkillRunAdapter
  readonly instructionAgentExecutor?: InstructionAgentExecutor
  readonly metrics?: SkillRuntimeMetrics
}

export type SkillRuntimeComposition = {
  readonly config: SkillRuntimeConfig
  readonly ports: SkillRuntimePorts
  readonly coordinator: SkillRunCoordinator
  readonly queue: PersistentSkillRunQueue
  readonly worker?: SkillRunWorker
  readonly metrics: SkillRuntimeMetrics
  start(): { started: boolean; reason?: string }
  stop(options?: { drain?: boolean; timeoutMs?: number }): Promise<void>
  markInterruptedRuns(options?: { now?: number; staleAfterMs?: number }): number
  getRuntimeHealth(migrations?: RuntimeMigrationStatus): RuntimeHealth
  getRuntimeDiagnostics(options?: { migrations?: RuntimeMigrationStatus; now?: () => number }): RuntimeDiagnosticsSnapshot
}

/**
 * The only assembly point for the Package Skill runtime.
 *
 * Database initialization/migrations happen before this function is called by
 * the server bootstrap. Keeping construction pure makes startup ordering and
 * worker shutdown independently testable.
 */
export function createSkillRuntime(options: SkillRuntimeCompositionOptions = {}): SkillRuntimeComposition {
  const config = options.config ?? getSkillRuntimeConfig()
  const ports = options.ports ?? createSqliteSkillRuntimePorts()
  const metrics = options.metrics ?? SkillRuntimeMetrics.global()
  const queue = options.queue ?? new PersistentSkillRunQueue(ports.queue, {
    clock: ports.clock,
    maxAttempts: config.maxAttempts,
    metrics,
  })
  const coordinator = options.coordinator ?? new SkillRunCoordinator({
    runs: ports.runs,
    events: ports.events,
    clock: ports.clock,
    queue: ports.queue,
    metrics,
  })
  const adapter = options.adapter ?? (options.instructionAgentExecutor
    ? new InstructionAgentAdapter({
      executor: options.instructionAgentExecutor,
      coordinator,
      packages: ports.packages,
      events: ports.events,
      maxDurationMs: config.maxRunDurationMs,
      maxLoadedFiles: config.maxPackageFiles,
      maxFileBytes: config.maxFileBytes,
    })
    : undefined)
  const worker = options.executor || adapter
    ? new SkillRunWorker({
      queue,
      coordinator,
      executor: options.executor,
      adapter,
      concurrency: config.workerConcurrency,
      leaseMs: config.leaseTimeoutMs,
      metrics,
    })
    : undefined

  return {
    config,
    ports,
    coordinator,
    queue,
    worker,
    metrics,
    start() {
      if (!config.runtimeEnabled) return { started: false, reason: 'runtimeEnabled' }
      if (!config.packageExecutionEnabled) return { started: false, reason: 'packageExecutionEnabled' }
      if (!worker) return { started: false, reason: 'executor' }
      worker.start()
      return { started: true }
    },
    async stop(stopOptions = {}) {
      if (!worker) return
      await worker.stop({ drain: stopOptions.drain ?? false, timeoutMs: stopOptions.timeoutMs ?? 30_000 })
    },
    markInterruptedRuns(options) {
      return coordinator.markInterruptedRuns(options)
    },
    getRuntimeHealth(migrations = { current: null, applied: [], pending: [] }) {
      return buildRuntimeHealth({
        config: {
          protocolVersion: config.protocolVersion,
          configVersion: config.configVersion,
          runtimeEnabled: config.runtimeEnabled,
          packageExecutionEnabled: config.packageExecutionEnabled,
          policyVersion: SECURITY_POLICY_VERSION,
        },
        migrations,
        worker: worker?.getStatusSnapshot(),
      })
    },
    getRuntimeDiagnostics(diagnosticsOptions = {}) {
      const failures = ports.runs.listRuns({ limit: 50, offset: 0, status: 'failed' }).data
      return buildRuntimeDiagnostics({
        now: diagnosticsOptions.now,
        config: {
          protocolVersion: config.protocolVersion,
          configVersion: config.configVersion,
          runtimeEnabled: config.runtimeEnabled,
          packageExecutionEnabled: config.packageExecutionEnabled,
          policyVersion: SECURITY_POLICY_VERSION,
        },
        queue: queue.list(),
        worker: worker?.getStatusSnapshot(),
        migrations: diagnosticsOptions.migrations,
        metrics,
        recentFailures: failures.map((run) => ({
          runId: run.id,
          status: run.status,
          errorCode: run.errorCode,
          errorMessage: run.errorMessage,
          updatedAt: run.updatedAt,
        })),
      })
    },
  }
}
