import type {
  Clock,
  SkillRunQueueRepository,
  SkillRunQueueSnapshot,
} from '../application/ports'

export type PersistentSkillRunQueueOptions = {
  readonly clock?: Clock
  readonly maxAttempts?: number
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

  constructor(
    private readonly repository: SkillRunQueueRepository,
    options: PersistentSkillRunQueueOptions = {},
  ) {
    this.clock = options.clock ?? { now: () => Date.now() }
    this.maxAttempts = options.maxAttempts ?? 3
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error('maxAttempts must be a positive integer')
    }
  }

  enqueue(runId: string, availableAt = this.clock.now()): SkillRunQueueSnapshot {
    return this.repository.enqueue({ runId, availableAt })
  }

  claimNext(workerId: string, leaseMs: number, now = this.clock.now()): SkillRunQueueSnapshot | undefined {
    return this.repository.claimNext({ workerId, leaseMs, now })
  }

  heartbeat(queueId: string, workerId: string, leaseMs: number, now = this.clock.now()): SkillRunQueueSnapshot | undefined {
    return this.repository.heartbeat({ queueId, workerId, leaseMs, now })
  }

  ack(queueId: string, workerId: string, now = this.clock.now()): boolean {
    return this.repository.ack({ queueId, workerId, now })
  }

  retry(queueId: string, workerId: string, error: string, delayMs: number, now = this.clock.now()): SkillRunQueueSnapshot | undefined {
    const current = this.repository.get(queueId)
    if (!current || current.status !== 'leased' || current.leaseOwner !== workerId) return undefined
    if (current.attempt >= this.maxAttempts) return this.fail(queueId, workerId, error, now)
    return this.repository.retry({ queueId, workerId, error, delayMs, now })
  }

  fail(queueId: string, workerId: string, error: string, now = this.clock.now()): SkillRunQueueSnapshot | undefined {
    return this.repository.fail({ queueId, workerId, error, now })
  }

  get(queueId: string): SkillRunQueueSnapshot | undefined {
    return this.repository.get(queueId)
  }

  list(options?: { runId?: string; status?: 'queued' | 'leased' | 'retry_wait' | 'done' | 'dead' }): readonly SkillRunQueueSnapshot[] {
    return this.repository.list(options)
  }
}
