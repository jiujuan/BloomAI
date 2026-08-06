import type {
  Clock,
  SkillRunQueueRepository,
  SkillRunQueueSnapshot,
} from '../application/ports'
import type { SkillRuntimeMetrics } from '../observability/skill-runtime.metrics'

export type PersistentSkillRunQueueOptions = {
  readonly clock?: Clock
  readonly maxAttempts?: number
  readonly metrics?: SkillRuntimeMetrics
}

/**
 * Application-facing durable queue facade.
 *
 * The queue itself is persisted by the injected repository. This class owns
 * retry policy and keeps worker code independent from SQLite/Drizzle details.
 */
export class PersistentSkillRunQueue {
  private readonly clock: Clock
  private readonly maxAttempts: number
  private readonly metrics?: SkillRuntimeMetrics

  constructor(
    private readonly repository: SkillRunQueueRepository,
    options: PersistentSkillRunQueueOptions = {},
  ) {
    this.clock = options.clock ?? { now: () => Date.now() }
    this.maxAttempts = options.maxAttempts ?? 3
    this.metrics = options.metrics
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error('maxAttempts must be a positive integer')
    }
  }

  enqueue(runId: string, availableAt = this.clock.now()): SkillRunQueueSnapshot {
    const item = this.repository.enqueue({ runId, availableAt })
    this.recordQueueSnapshot({ runId: item.runId })
    return item
  }

  claimNext(workerId: string, leaseMs: number, now = this.clock.now()): SkillRunQueueSnapshot | undefined {
    const expiredQueueIds = new Set(this.repository.list({ status: 'leased' })
      .filter((item) => item.leaseUntil !== null && item.leaseUntil <= now)
      .map((item) => item.id))
    const item = this.repository.claimNext({ workerId, leaseMs, now })
    this.recordQueueSnapshot({
      leaseExpired: item !== undefined && expiredQueueIds.has(item.id),
      ...(item ? { runId: item.runId } : {}),
    })
    return item
  }

  heartbeat(queueId: string, workerId: string, leaseMs: number, now = this.clock.now()): SkillRunQueueSnapshot | undefined {
    const current = this.repository.get(queueId)
    const item = this.repository.heartbeat({ queueId, workerId, leaseMs, now })
    this.recordQueueSnapshot({
      leaseExpired: item === undefined && current?.leaseUntil !== null && current?.leaseUntil !== undefined && current.leaseUntil <= now,
      ...(current ? { runId: current.runId } : {}),
    })
    return item
  }

  ack(queueId: string, workerId: string, now = this.clock.now()): boolean {
    const current = this.repository.get(queueId)
    const acknowledged = this.repository.ack({ queueId, workerId, now })
    this.recordQueueSnapshot({ ...(current ? { runId: current.runId } : {}) })
    return acknowledged
  }

  retry(queueId: string, workerId: string, error: string, delayMs: number, now = this.clock.now()): SkillRunQueueSnapshot | undefined {
    const current = this.repository.get(queueId)
    if (!current || current.status !== 'leased' || current.leaseOwner !== workerId) return undefined
    if (current.attempt >= this.maxAttempts) return this.fail(queueId, workerId, error, now)
    const item = this.repository.retry({ queueId, workerId, error, delayMs, now })
    this.recordQueueSnapshot({ retry: item?.status === 'retry_wait', ...(current ? { runId: current.runId } : {}) })
    return item
  }

  fail(queueId: string, workerId: string, error: string, now = this.clock.now()): SkillRunQueueSnapshot | undefined {
    const current = this.repository.get(queueId)
    const item = this.repository.fail({ queueId, workerId, error, now })
    this.recordQueueSnapshot({ deadLetter: item?.status === 'dead', ...(current ? { runId: current.runId } : {}) })
    return item
  }

  private recordQueueSnapshot(input: {
    leaseExpired?: boolean
    retry?: boolean
    deadLetter?: boolean
    runId?: string
  }): void {
    if (!this.metrics) return
    const now = this.clock.now()
    const items = this.repository.list()
    const active = items.filter((item) => item.status === 'queued' || item.status === 'leased' || item.status === 'retry_wait')
    const lagCandidates = active
      .filter((item) => item.status === 'queued' || item.status === 'retry_wait')
      .map((item) => Math.max(0, now - item.availableAt))
    this.metrics.recordQueue({
      depth: active.length,
      lagMs: lagCandidates.length ? Math.max(...lagCandidates) : 0,
      leaseExpired: input.leaseExpired,
      retry: input.retry,
      deadLetter: input.deadLetter,
      correlation: input.runId ? { runId: input.runId } : undefined,
    })
  }

  get(queueId: string): SkillRunQueueSnapshot | undefined {
    return this.repository.get(queueId)
  }

  list(options?: { runId?: string; status?: 'queued' | 'leased' | 'retry_wait' | 'done' | 'dead' }): readonly SkillRunQueueSnapshot[] {
    return this.repository.list(options)
  }
}
