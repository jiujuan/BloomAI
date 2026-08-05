import { randomUUID } from 'node:crypto'
import type { JsonObject, SkillRunQueueSnapshot } from '../application/ports'
import type { SkillRun } from './skill-run-coordinator'
import { SkillRunCoordinator } from './skill-run-coordinator'
import { PersistentSkillRunQueue } from './skill-run-queue'

export type SkillRunExecutionResult = {
  readonly status?: 'completed' | 'completed_with_errors' | 'waiting_input' | 'waiting_approval'
  readonly output?: JsonObject | null
  readonly waitingReason?: string | null
}

export type SkillRunExecutor = (
  run: SkillRun,
  context: { readonly queueItem: SkillRunQueueSnapshot; readonly signal: AbortSignal },
) => SkillRunExecutionResult | void | Promise<SkillRunExecutionResult | void>

export type SkillRunWorkerOptions = {
  readonly queue: PersistentSkillRunQueue
  readonly coordinator: SkillRunCoordinator
  readonly executor: SkillRunExecutor
  readonly workerId?: string
  readonly concurrency?: number
  readonly leaseMs?: number
  readonly pollIntervalMs?: number
  readonly retryDelayMs?: (attempt: number) => number
}

export class SkillRunWorker {
  readonly workerId: string
  private readonly concurrency: number
  private readonly leaseMs: number
  private readonly pollIntervalMs: number
  private readonly retryDelayMs: (attempt: number) => number
  private readonly active = new Set<Promise<boolean>>()
  private running = false
  private drainRequested = false
  private loopPromise: Promise<void> | undefined

  constructor(private readonly options: SkillRunWorkerOptions) {
    this.workerId = options.workerId ?? `skill-worker-${randomUUID()}`
    this.concurrency = options.concurrency ?? 1
    this.leaseMs = options.leaseMs ?? 30_000
    this.pollIntervalMs = options.pollIntervalMs ?? 250
    this.retryDelayMs = options.retryDelayMs ?? ((attempt) => Math.min(60_000, 100 * 2 ** Math.max(0, attempt - 1)))
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error('concurrency must be a positive integer')
    if (!Number.isInteger(this.leaseMs) || this.leaseMs < 1) throw new Error('leaseMs must be a positive integer')
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 0) throw new Error('pollIntervalMs must be a non-negative integer')
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.drainRequested = false
    this.loopPromise = this.pump()
  }

  async stop(options: { drain: boolean; timeoutMs: number }): Promise<void> {
    this.running = false
    this.drainRequested = options.drain
    const loop = this.loopPromise
    if (!loop) return
    await Promise.race([
      loop,
      new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, options.timeoutMs))),
    ])
  }

  async drain(timeoutMs = 30_000): Promise<void> {
    await this.stop({ drain: true, timeoutMs })
  }

  async runOne(): Promise<boolean> {
    const item = this.options.queue.claimNext(this.workerId, this.leaseMs)
    if (!item) return false

    const abortController = new AbortController()
    const heartbeatTimer = setInterval(() => {
      this.options.queue.heartbeat(item.id, this.workerId, this.leaseMs)
    }, Math.max(50, Math.floor(this.leaseMs / 3)))

    try {
      let run = this.options.coordinator.getRun(item.runId)
      if (isTerminal(run.status)) {
        this.options.queue.ack(item.id, this.workerId)
        return true
      }

      if (run.cancelRequested) {
        run = this.options.coordinator.transition(run.id, 'cancelled', { expectedRevision: run.revision })
        this.options.queue.ack(item.id, this.workerId)
        return true
      }

      if (run.status === 'interrupted') {
        run = this.options.coordinator.resumeRun(run.id, { expectedRevision: run.revision })
      }
      if (run.status === 'created' || run.status === 'validating') {
        run = this.options.coordinator.transition(run.id, 'running', { expectedRevision: run.revision })
      }
      if (run.status === 'waiting_input' || run.status === 'waiting_approval') {
        this.options.queue.ack(item.id, this.workerId)
        return true
      }

      const result = await this.options.executor(run, { queueItem: item, signal: abortController.signal })
      const refreshed = this.options.coordinator.getRun(run.id)
      if (result?.status) {
        if (!isTerminal(refreshed.status) && refreshed.status !== 'waiting_input' && refreshed.status !== 'waiting_approval') {
          this.options.coordinator.transition(run.id, result.status, {
            expectedRevision: refreshed.revision,
            output: result.output,
            waitingReason: result.waitingReason,
          })
        }
      } else if (refreshed.status === 'running') {
        throw new Error('Skill executor returned without transitioning the run')
      }

      if (!this.options.queue.ack(item.id, this.workerId)) throw new Error(`Queue lease lost before ack: ${item.id}`)
      return true
    } catch (error) {
      await this.handleFailure(item, error)
      return false
    } finally {
      abortController.abort()
      clearInterval(heartbeatTimer)
    }
  }

  private async handleFailure(item: SkillRunQueueSnapshot, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    const next = this.options.queue.retry(
      item.id,
      this.workerId,
      message,
      this.retryDelayMs(item.attempt),
    )
    if (!next || next.status !== 'dead') return

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
  }

  private async pump(): Promise<void> {
    while (this.running || (this.drainRequested && this.active.size > 0)) {
      while (this.running && this.active.size < this.concurrency) {
        const task = this.runOne()
        this.active.add(task)
        void task.then(
          () => this.active.delete(task),
          () => this.active.delete(task),
        )
      }

      if (this.active.size > 0) {
        await Promise.race(this.active)
      } else if (this.running) {
        await sleep(this.pollIntervalMs)
      }
    }
    this.loopPromise = undefined
  }
}

function isTerminal(status: SkillRun['status']): boolean {
  return status === 'completed' || status === 'completed_with_errors' || status === 'failed' || status === 'cancelled'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
