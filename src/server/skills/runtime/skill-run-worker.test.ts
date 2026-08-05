import { describe, expect, it } from 'vitest'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import { SkillRunCoordinator } from './skill-run-coordinator'
import { PersistentSkillRunQueue } from './skill-run-queue'
import { SkillRunWorker } from './skill-run-worker'

describe('SkillRunWorker', () => {
  it('consumes a durable queue item and completes the run through the coordinator', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 10_000 })
    const coordinator = new SkillRunCoordinator({ runs: ports.runs, events: ports.events, queue: ports.queue, clock: ports.clock })
    const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: { topic: 'queue' }, context: {} })
    const queue = new PersistentSkillRunQueue(ports.queue, { clock: ports.clock, maxAttempts: 2 })
    const worker = new SkillRunWorker({
      queue,
      coordinator,
      workerId: 'worker-test',
      leaseMs: 100,
      executor: async () => ({ status: 'completed', output: { ok: true } }),
    })

    await expect(worker.runOne()).resolves.toBe(true)
    expect(coordinator.getRun(runId)).toMatchObject({ status: 'completed', output: { ok: true } })
    expect(queue.list({ runId })).toMatchObject([{ status: 'done', attempt: 1 }])
    expect(coordinator.subscribeEvents(runId).map((event) => event.type)).toEqual([
      'input.summarized',
      'run.status_changed',
      'run.status_changed',
      'run.completed',
    ])
  })

  it('retries failures and marks the run failed after max attempts', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 20_000 })
    const coordinator = new SkillRunCoordinator({ runs: ports.runs, events: ports.events, queue: ports.queue, clock: ports.clock })
    const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: {}, context: {} })
    const queue = new PersistentSkillRunQueue(ports.queue, { clock: ports.clock, maxAttempts: 2 })
    const worker = new SkillRunWorker({
      queue,
      coordinator,
      workerId: 'worker-test',
      leaseMs: 100,
      retryDelayMs: () => 0,
      executor: async () => { throw new Error('boom') },
    })

    await expect(worker.runOne()).resolves.toBe(false)
    await expect(worker.runOne()).resolves.toBe(false)
    expect(coordinator.getRun(runId)).toMatchObject({ status: 'failed', errorCode: 'RUN_MAX_ATTEMPTS' })
    expect(queue.list({ runId })).toMatchObject([{ status: 'dead', attempt: 2, lastError: 'boom' }])
  })

  it('does not execute cancelled or terminal runs', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 30_000 })
    const coordinator = new SkillRunCoordinator({ runs: ports.runs, events: ports.events, queue: ports.queue, clock: ports.clock })
    const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: {}, context: {} })
    const run = coordinator.getRun(runId)
    coordinator.dispatchCommand(runId, { type: 'cancel', idempotencyKey: 'cancel', expectedRevision: run.revision })
    const queue = new PersistentSkillRunQueue(ports.queue, { clock: ports.clock })
    let executions = 0
    const worker = new SkillRunWorker({ queue, coordinator, workerId: 'worker-test', executor: async () => { executions += 1; return { status: 'completed' } } })

    await expect(worker.runOne()).resolves.toBe(true)
    expect(executions).toBe(0)
    expect(coordinator.getRun(runId).status).toBe('cancelled')
  })
})
