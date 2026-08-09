import { describe, expect, it } from 'vitest'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import { SkillRunCoordinator } from './skill-run-coordinator'
import { PersistentSkillRunQueue } from './skill-run-queue'
import { SkillRunWorker } from './skill-run-worker'

describe('Skill run recovery and cancellation', () => {
  it('marks only stale active runs interrupted with recovery evidence', () => {
    const ports = createFakeSkillRuntimePorts({ now: 10_000 })
    const coordinator = new SkillRunCoordinator({ runs: ports.runs, events: ports.events, queue: ports.queue, clock: ports.clock })
    const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: {}, context: {} })
    coordinator.transition(runId, 'running', { expectedRevision: 1 })
    ports.clock.advance(5_000)

    expect(coordinator.markInterruptedRuns({ staleAfterMs: 5_000 })).toBe(1)
    expect(coordinator.getRun(runId)).toMatchObject({
      status: 'interrupted',
      interruptedAt: 15_000,
      cancelReason: 'process_crash',
      errorCode: 'PROCESS_INTERRUPTED',
    })
    expect(coordinator.subscribeEvents(runId).map((event) => event.seq)).toEqual([1, 2, 3, 4])
  })

  it('re-enqueues an interrupted run when its previous queue item is no longer active', () => {
    const ports = createFakeSkillRuntimePorts({ now: 40_000 })
    const coordinator = new SkillRunCoordinator({ runs: ports.runs, events: ports.events, queue: ports.queue, clock: ports.clock })
    const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: {}, context: {} })
    coordinator.transition(runId, 'running', { expectedRevision: 1 })

    const item = ports.queue.claimNext({ workerId: 'crashed-worker', leaseMs: 1_000 })
    expect(item).toBeDefined()
    expect(ports.queue.ack({ queueId: item!.id, workerId: 'crashed-worker' })).toBe(true)
    ports.clock.advance(1_000)

    expect(coordinator.markInterruptedRuns({ staleAfterMs: 1_000 })).toBe(1)
    expect(ports.queue.list({ runId }).filter((queueItem) => ['queued', 'leased', 'retry_wait'].includes(queueItem.status))).toHaveLength(1)
    expect(coordinator.getRun(runId).status).toBe('interrupted')
  })

  it('cancels waiting runs idempotently without creating a second execution', () => {
    const ports = createFakeSkillRuntimePorts({ now: 20_000 })
    const coordinator = new SkillRunCoordinator({ runs: ports.runs, events: ports.events, queue: ports.queue, clock: ports.clock })
    const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: {}, context: {} })
    coordinator.transition(runId, 'running', { expectedRevision: 1 })
    coordinator.transition(runId, 'waiting_approval', { expectedRevision: 2, waitingReason: 'approval' })

    const first = coordinator.requestCancel(runId, { expectedRevision: 3, idempotencyKey: 'cancel-1' })
    const second = coordinator.requestCancel(runId, { expectedRevision: 3, idempotencyKey: 'cancel-1' })
    expect(first).toMatchObject({ status: 'cancelled', cancelReason: 'user_cancelled' })
    expect(second.revision).toBe(first.revision)
    expect(coordinator.subscribeEvents(runId).filter((event) => event.type === 'run.cancelled')).toHaveLength(1)
  })

  it('converges a non-draining worker stop to interrupted and makes the queue reclaimable', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 30_000 })
    const coordinator = new SkillRunCoordinator({ runs: ports.runs, events: ports.events, queue: ports.queue, clock: ports.clock })
    const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: {}, context: {} })
    const queue = new PersistentSkillRunQueue(ports.queue, { clock: ports.clock, maxAttempts: 3 })
    const worker = new SkillRunWorker({
      queue,
      coordinator,
      workerId: 'shutdown-worker',
      leaseMs: 100,
      executor: async (_run, context) => await new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    })

    worker.start()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await worker.stop({ drain: false, timeoutMs: 500 })

    expect(coordinator.getRun(runId)).toMatchObject({ status: 'interrupted', cancelReason: 'worker_shutdown' })
    expect(queue.list({ runId })).toMatchObject([{ status: 'retry_wait', lastError: 'worker_shutdown' }])
  })
})