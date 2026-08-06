import { describe, expect, it } from 'vitest'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import { SkillRuntimeMetrics } from '../observability/skill-runtime.metrics'
import { PersistentSkillRunQueue } from './skill-run-queue'

describe('PersistentSkillRunQueue', () => {
  it('claims only once and lets a second worker reclaim an expired lease', () => {
    const ports = createFakeSkillRuntimePorts({ now: 1_000 })
    const queue = new PersistentSkillRunQueue(ports.queue, { clock: ports.clock, maxAttempts: 3 })
    const first = queue.enqueue('run-1')

    expect(queue.claimNext('worker-a', 100)).toMatchObject({ id: first.id, status: 'leased', attempt: 1, leaseOwner: 'worker-a' })
    expect(queue.claimNext('worker-b', 100)).toBeUndefined()

    ports.clock.advance(101)
    expect(queue.claimNext('worker-b', 100)).toMatchObject({ id: first.id, status: 'leased', attempt: 2, leaseOwner: 'worker-b' })
    expect(queue.ack(first.id, 'worker-a')).toBe(false)
    expect(queue.ack(first.id, 'worker-b')).toBe(true)
    expect(queue.get(first.id)).toMatchObject({ status: 'done', leaseOwner: null, leaseUntil: null })
  })

  it('applies retry backoff and dead-letters at max attempts', () => {
    const ports = createFakeSkillRuntimePorts({ now: 2_000 })
    const queue = new PersistentSkillRunQueue(ports.queue, { clock: ports.clock, maxAttempts: 2 })
    const item = queue.enqueue('run-2')

    queue.claimNext('worker', 100)
    expect(queue.retry(item.id, 'worker', 'temporary', 50)).toMatchObject({ status: 'retry_wait', availableAt: 2_050, attempt: 1 })
    expect(queue.claimNext('worker', 100)).toBeUndefined()
    ports.clock.advance(50)
    queue.claimNext('worker', 100)
    expect(queue.retry(item.id, 'worker', 'permanent', 50)).toMatchObject({ status: 'dead', lastError: 'permanent', attempt: 2 })
  })
  it('records queue depth/lag and retry/dead/lease-expired counters', () => {
    const ports = createFakeSkillRuntimePorts({ now: 3_000 })
    const metrics = new SkillRuntimeMetrics({ now: ports.clock.now })
    const queue = new PersistentSkillRunQueue(ports.queue, { clock: ports.clock, maxAttempts: 3, metrics })
    const item = queue.enqueue('run-observed')

    queue.claimNext('worker-a', 100)
    ports.clock.advance(101)
    queue.claimNext('worker-b', 100)
    queue.retry(item.id, 'worker-b', 'temporary', 0)
    queue.claimNext('worker-b', 100)
    queue.retry(item.id, 'worker-b', 'permanent', 0)

    const snapshot = metrics.snapshot()
    expect(snapshot.counters.leaseExpired).toBe(1)
    expect(snapshot.counters.retry).toBe(1)
    expect(snapshot.counters.deadLetter).toBe(1)
    expect(snapshot.counters.queueDepth).toBe(0)
    expect(snapshot.points.some((point) => point.kind === 'queue' && point.value >= 1)).toBe(true)
  })
})
