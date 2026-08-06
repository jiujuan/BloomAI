import { describe, expect, it } from 'vitest'
import { SkillRunCoordinator } from '../runtime/skill-run-coordinator'
import { createFakeSkillRuntimePorts } from './test-doubles'

describe('Skill Runtime application ports', () => {
  it('runs the coordinator entirely against fake ports', () => {
    const ports = createFakeSkillRuntimePorts({ now: 1_000 })
    const coordinator = new SkillRunCoordinator({
      runs: ports.runs,
      events: ports.events,
      clock: ports.clock,
    })

    const { runId } = coordinator.startRun({
      skillVersionId: 'version-1',
      input: { prompt: 'hello' },
      context: { source: 'test' },
    })

    expect(coordinator.getRun(runId)).toMatchObject({
      id: runId,
      status: 'validating',
      revision: 1,
      input: { prompt: 'hello' },
    })
    expect(coordinator.subscribeEvents(runId)).toHaveLength(2)
  })

  it('preserves idempotency and rejects stale revisions through the port contract', () => {
    const ports = createFakeSkillRuntimePorts({ now: 2_000 })
    const coordinator = new SkillRunCoordinator({
      runs: ports.runs,
      events: ports.events,
      clock: ports.clock,
    })
    const { runId } = coordinator.startRun({ skillVersionId: 'version-1', input: {}, context: {} })
    coordinator.transition(runId, 'waiting_approval', { expectedRevision: 1, waitingReason: 'confirm' })

    const command = { type: 'confirm' as const, idempotencyKey: 'confirm-1', expectedRevision: 2 }
    const first = coordinator.dispatchCommand(runId, command)
    const repeated = coordinator.dispatchCommand(runId, command)

    expect(first).toEqual(repeated)
    expect(first.revision).toBe(3)
    expect(() => coordinator.transition(runId, 'completed', { expectedRevision: 2 })).toThrow('revision conflict')
  })
})
