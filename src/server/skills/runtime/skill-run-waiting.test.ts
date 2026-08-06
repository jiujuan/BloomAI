import { describe, expect, it } from 'vitest'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import { SkillRunCoordinator } from './skill-run-coordinator'

function createWaitingRun() {
  const ports = createFakeSkillRuntimePorts({ now: 10_000 })
  const coordinator = new SkillRunCoordinator({ runs: ports.runs, events: ports.events, queue: ports.queue, clock: ports.clock })
  const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: { topic: 'waiting' }, context: {} })
  return { ports, coordinator, runId }
}

describe('SkillRun waiting actions', () => {
  it('persists a safe approval action with capability and grant metadata', () => {
    const { coordinator, runId } = createWaitingRun()

    const run = coordinator.transition(runId, 'waiting_approval', {
      expectedRevision: 1,
      waitingReason: 'Approve web access',
      requiredAction: {
        type: 'approval',
        capability: 'web.search',
        grantId: 'grant-1',
        prompt: { kind: 'confirm', label: 'Allow search' },
        expiresAt: 12_000,
      },
    })

    expect(run).toMatchObject({
      status: 'waiting_approval',
      requiredAction: {
        type: 'approval',
        capability: 'web.search',
        grantId: 'grant-1',
        expiresAt: 12_000,
      },
    })
  })

  it('rejects a command after its waiting action expires', () => {
    const { ports, coordinator, runId } = createWaitingRun()
    coordinator.transition(runId, 'waiting_approval', {
      expectedRevision: 1,
      waitingReason: 'Approve web access',
      requiredAction: { type: 'approval', capability: 'web.search', expiresAt: 12_000 },
    })
    ports.clock.set(12_000)

    expect(() => coordinator.dispatchCommand(runId, {
      type: 'approve',
      idempotencyKey: 'approve-expired',
      expectedRevision: 2,
    })).toThrowError(/expired/i)
    expect(coordinator.getRun(runId)).toMatchObject({
      status: 'failed',
      errorCode: 'WAITING_ACTION_EXPIRED',
    })
  })

  it('re-enqueues a waiting run once after an approval command', () => {
    const { ports, coordinator, runId } = createWaitingRun()
    coordinator.transition(runId, 'waiting_approval', {
      expectedRevision: 1,
      waitingReason: 'Approve web access',
    })
    const initial = ports.queue.claimNext({ workerId: 'test-worker', leaseMs: 1_000 })
    expect(initial).toBeDefined()
    expect(ports.queue.ack({ queueId: initial!.id, workerId: 'test-worker' })).toBe(true)
    const before = ports.queue.list({ runId }).filter((item) => ['queued', 'leased', 'retry_wait'].includes(item.status))

    coordinator.dispatchCommand(runId, {
      type: 'approve',
      idempotencyKey: 'approve-once',
      expectedRevision: 2,
    })
    const after = ports.queue.list({ runId }).filter((item) => ['queued', 'leased', 'retry_wait'].includes(item.status))
    coordinator.dispatchCommand(runId, {
      type: 'approve',
      idempotencyKey: 'approve-once',
      expectedRevision: 2,
    })
    const repeated = ports.queue.list({ runId }).filter((item) => ['queued', 'leased', 'retry_wait'].includes(item.status))

    expect(before).toHaveLength(0)
    expect(after).toHaveLength(1)
    expect(repeated).toHaveLength(1)
    expect(after[0]?.id).not.toBe(before[0]?.id)
  })

  it('supports submit_input as the command spelling for waiting input', () => {
    const { coordinator, runId } = createWaitingRun()
    coordinator.transition(runId, 'waiting_input', {
      expectedRevision: 1,
      waitingReason: 'Need a title',
      requiredAction: { type: 'input', prompt: { kind: 'text', label: 'Title' } },
    })

    const run = coordinator.dispatchCommand(runId, {
      type: 'submit_input',
      idempotencyKey: 'submit-title',
      expectedRevision: 2,
      input: { title: 'Dawn' },
    })

    expect(run).toMatchObject({ status: 'running', input: { topic: 'waiting', title: 'Dawn' } })
  })
})
