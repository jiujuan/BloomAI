import { randomUUID } from 'node:crypto'
import type { JsonObject, SkillRunQueueSnapshot } from '../application/ports'
import type { RuntimeWorkerStatus } from '../observability/skill-runtime.diagnostics'
import type { SkillRuntimeMetrics } from '../observability/skill-runtime.metrics'
import { withSkillCorrelation } from '../observability/skill-runtime.logger'
import type { SkillRun } from './skill-run-coordinator'
import { SkillRunCoordinator } from './skill-run-coordinator'
import { PersistentSkillRunQueue } from './skill-run-queue'

export type SkillRunExecutionResult = {
  readonly status?: 'completed' | 'completed_with_errors' | 'waiting_input' | 'waiting_approval' | 'failed' | 'cancelled'
  readonly output?: JsonObject | null
  readonly waitingReason?: string | null
}

export type SkillRunAdapter = {
  run(runId: string): Promise<SkillRun>
}

export type SkillRunExecutor = (
  run: SkillRun,
  context: { readonly queueItem: SkillRunQueueSnapshot; readonly signal: AbortSignal },
) => SkillRunExecutionResult | void | Promise<SkillRunExecutionResult | void>

export type SkillRunWorkerOptions = {
  readonly queue: PersistentSkillRunQueue
  readonly coordinator: SkillRunCoordinator
  readonly executor?: SkillRunExecutor
  readonly adapter?: SkillRunAdapter
  readonly workerId?: string
  readonly concurrency?: number
  readonly leaseMs?: number
  readonly pollIntervalMs?: number
  readonly retryDelayMs?: (attempt: number) => number
  readonly metrics?: SkillRuntimeMetrics
}

export class SkillRunWorker {
  readonly workerId: string
  private readonly concurrency: number
  private readonly leaseMs: number
  private readonly pollIntervalMs: number
  private readonly retryDelayMs: (attempt: number) => number
  private readonly metrics?: SkillRuntimeMetrics
  private readonly active = new Set<Promise<boolean>>()
  private activeRunCount = 0
  private running = false
  private drainRequested = false
  private loopPromise: Promise<void> | undefined
  private shutdownRequested = false
  private readonly controllers = new Set<AbortController>()
  private operationalStatus: RuntimeWorkerStatus['status'] = 'stopped'
  private lastError: string | null = null
  private heartbeatAt: number | null = null

  constructor(private readonly options: SkillRunWorkerOptions) {
    this.workerId = options.workerId ?? `skill-worker-${randomUUID()}`
    this.concurrency = options.concurrency ?? 1
    this.leaseMs = options.leaseMs ?? 30_000
    this.pollIntervalMs = options.pollIntervalMs ?? 250
    this.retryDelayMs = options.retryDelayMs ?? ((attempt) => Math.min(60_000, 100 * 2 ** Math.max(0, attempt - 1)))
    this.metrics = options.metrics
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error('concurrency must be a positive integer')
    if (!Number.isInteger(this.leaseMs) || this.leaseMs < 1) throw new Error('leaseMs must be a positive integer')
    if (!options.executor && !options.adapter) throw new Error('executor or adapter is required')
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 0) throw new Error('pollIntervalMs must be a non-negative integer')
  }

  getStatusSnapshot(): RuntimeWorkerStatus {
    return {
      status: this.operationalStatus,
      workerId: this.workerId,
      lastError: this.lastError,
      heartbeatAt: this.heartbeatAt,
      activeRuns: this.activeRunCount,
      concurrency: this.concurrency,
    }
  }

  start(): void {
    if (this.running) return
    this.operationalStatus = 'starting'
    this.lastError = null
    this.running = true
    this.shutdownRequested = false
    this.drainRequested = false
    this.heartbeatAt = Date.now()
    this.operationalStatus = 'running'
    this.loopPromise = this.pump()
  }

  async stop(options: { drain: boolean; timeoutMs: number }): Promise<void> {
    this.running = false
    this.operationalStatus = this.loopPromise ? 'stopping' : 'stopped'
    this.drainRequested = options.drain
    this.shutdownRequested = !options.drain
    if (!options.drain) for (const controller of this.controllers) controller.abort()
    const loop = this.loopPromise
    if (!loop) return
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        loop,
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(resolve, Math.max(0, options.timeoutMs))
          timeoutHandle.unref?.()
        }),
      ])
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
    if (this.activeRunCount === 0 && this.operationalStatus !== 'crashed') this.operationalStatus = 'stopped'
  }

  async drain(timeoutMs = 30_000): Promise<void> {
    await this.stop({ drain: true, timeoutMs })
  }

  async runOne(): Promise<boolean> {
    const item = this.options.queue.claimNext(this.workerId, this.leaseMs)
    if (!item) return false

    this.activeRunCount += 1
    return withSkillCorrelation({ runId: item.runId, workerId: this.workerId }, async () => {
      const startedAt = Date.now()
      const abortController = new AbortController()
      this.controllers.add(abortController)
      let leaseLost = false
      let run: SkillRun | undefined
      const heartbeatTimer = setInterval(() => {
        this.heartbeatAt = Date.now()
        const lease = this.options.queue.heartbeat(item.id, this.workerId, this.leaseMs)
        if (!lease) {
          leaseLost = true
          abortController.abort()
          return
        }
        try {
          const current = this.options.coordinator.getRun(item.runId)
          if (current.cancelRequested) abortController.abort()
        } catch { /* run may have been concurrently finalized */ }
      }, Math.max(50, Math.floor(this.leaseMs / 3)))

      try {
        run = this.options.coordinator.getRun(item.runId)
        return await withSkillCorrelation({ skillVersionId: run.skillVersionId }, async () => {
          if (isTerminal(run!.status)) {
            this.options.queue.ack(item.id, this.workerId)
            this.recordRunMetric(item, run, startedAt)
            return true
          }

          if (run!.cancelRequested) {
            run = this.options.coordinator.transition(run!.id, 'cancelled', { expectedRevision: run!.revision })
            this.options.queue.ack(item.id, this.workerId)
            this.recordRunMetric(item, run, startedAt)
            return true
          }

          if (run!.status === 'interrupted') {
            run = this.options.coordinator.resumeRun(run!.id, { expectedRevision: run!.revision })
          }
          if (run!.status === 'created' || run!.status === 'validating') {
            run = this.options.coordinator.transition(run!.id, 'running', { expectedRevision: run!.revision })
          }
          if (run!.status === 'waiting_input' || run!.status === 'waiting_approval') {
            this.options.queue.ack(item.id, this.workerId)
            this.recordRunMetric(item, run, startedAt)
            return true
          }

          const result = this.options.adapter
            ? toExecutionResult(await this.options.adapter.run(run!.id))
            : await this.options.executor!(run!, { queueItem: item, signal: abortController.signal })
          const refreshed = this.options.coordinator.getRun(run!.id)
          if (result?.status) {
            if (!isTerminal(refreshed.status) && refreshed.status !== 'waiting_input' && refreshed.status !== 'waiting_approval') {
              this.options.coordinator.transition(run!.id, result.status, {
                expectedRevision: refreshed.revision,
                output: result.output,
                waitingReason: result.waitingReason,
              })
            }
          } else if (refreshed.status === 'running') {
            throw new Error('Skill executor returned without transitioning the run')
          }

          if (leaseLost) throw new Error(`Queue lease lost before ack: ${item.id}`)
          if (!this.options.queue.ack(item.id, this.workerId)) throw new Error(`Queue lease lost before ack: ${item.id}`)
          run = this.options.coordinator.getRun(run!.id)
          this.recordRunMetric(item, run, startedAt)
          return true
        })
      } catch (error) {
        const next = await this.handleFailure(item, error)
        try {
          run = this.options.coordinator.getRun(item.runId)
        } catch { /* the run may have been deleted or never created */ }
        this.recordRunMetric(item, run, startedAt, {
          leaseExpired: leaseLost,
          retry: next?.status === 'retry_wait',
          deadLetter: next?.status === 'dead',
        })
        return false
      } finally {
        abortController.abort()
        clearInterval(heartbeatTimer)
        this.controllers.delete(abortController)
        this.activeRunCount = Math.max(0, this.activeRunCount - 1)
      }
    })
  }

  private recordRunMetric(
    item: SkillRunQueueSnapshot,
    run: SkillRun | undefined,
    startedAt: number,
    flags: { leaseExpired?: boolean; retry?: boolean; deadLetter?: boolean } = {},
  ): void {
    if (!this.metrics) return
    try {
      this.metrics.recordRun({
        status: run?.status ?? 'failed',
        durationMs: Math.max(0, Date.now() - startedAt),
        ...flags,
        correlation: {
          runId: item.runId,
          workerId: this.workerId,
          ...(run ? { skillVersionId: run.skillVersionId } : {}),
        },
      })
    } catch { /* observability must never block worker execution */ }
  }

  private async handleFailure(item: SkillRunQueueSnapshot, error: unknown): Promise<SkillRunQueueSnapshot | undefined> {
    const message = error instanceof Error ? error.message : String(error)
    if (this.shutdownRequested) {
      try {
        const run = this.options.coordinator.getRun(item.runId)
        if (!isTerminal(run.status)) {
          this.options.coordinator.transition(run.id, 'interrupted', {
            expectedRevision: run.revision,
            errorCode: 'WORKER_SHUTDOWN',
            errorMessage: 'Worker stopped before the run reached a terminal state',
            reason: 'process_interrupted',
            cancelReason: 'worker_shutdown',
          })
        }
      } catch { /* a concurrent command owns the run */ }
      return this.options.queue.retry(item.id, this.workerId, 'worker_shutdown', 0)
    }
    const next = this.options.queue.retry(
      item.id,
      this.workerId,
      message,
      this.retryDelayMs(item.attempt),
    )
    if (!next || next.status !== 'dead') return next

    try {
      const run = this.options.coordinator.getRun(item.runId)
      if (!isTerminal(run.status)) {
        this.options.coordinator.transition(run.id, 'failed', {
          expectedRevision: run.revision,
          errorCode: 'RUN_MAX_ATTEMPTS',
          errorMessage: message,
        })
      }
    } catch {
      // The queue is the source of truth for retry/dead-letter state. If the
      // run disappeared or was concurrently finalized, do not resurrect it.
    }
    return next
  }

  private async pump(): Promise<void> {
    try {
      while (this.running || (this.drainRequested && this.active.size > 0)) {
        let pollNeeded = false
        while (this.running && this.active.size < this.concurrency && !pollNeeded) {
          const task = this.runOne()
          this.active.add(task)
          void task.then(
            (hasWork) => {
              this.active.delete(task)
              if (!hasWork) pollNeeded = true
            },
            () => this.active.delete(task),
          )
        }

        if (this.active.size > 0) {
          await Promise.race(this.active)
        }
        if (pollNeeded && this.running) await sleep(this.pollIntervalMs)
      }
    } catch (error) {
      this.operationalStatus = 'crashed'
      this.lastError = error instanceof Error ? error.message : String(error)
      this.running = false
      this.drainRequested = false
    } finally {
      this.loopPromise = undefined
      if (this.operationalStatus === 'stopping' && this.activeRunCount === 0) this.operationalStatus = 'stopped'
    }
  }
}

function toExecutionResult(run: SkillRun): SkillRunExecutionResult {
  const status = ['completed', 'completed_with_errors', 'waiting_input', 'waiting_approval', 'failed', 'cancelled'].includes(run.status)
    ? run.status as SkillRunExecutionResult['status']
    : undefined
  return { status, output: run.output, waitingReason: run.waitingReason }
}

function isTerminal(status: SkillRun['status']): boolean {
  return status === 'completed' || status === 'completed_with_errors' || status === 'failed' || status === 'cancelled'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
