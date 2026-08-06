import { afterEach, describe, expect, it } from 'vitest'
import {
  SkillRuntimeMetrics,
  recordCapabilityMetric,
  recordRunMetric,
  resetSkillRuntimeMetricsForTests,
} from './skill-runtime.metrics'

describe('Skill Runtime metrics', () => {
  afterEach(() => resetSkillRuntimeMetricsForTests())

  it('records queue, run, capability, artifact, and import signals without putting correlation ids in metric labels', () => {
    const metrics = new SkillRuntimeMetrics({ now: () => 10_000, retentionMs: 60_000 })

    metrics.recordRun({
      status: 'completed',
      durationMs: 125,
      queueDepth: 3,
      queueLagMs: 45,
      leaseExpired: true,
      retry: true,
      deadLetter: false,
      approvalWaitMs: 80,
      artifactBytes: 512,
      importRejectReason: 'unsupported_capability',
      correlation: {
        requestId: 'req-1', runId: 'run-1', skillVersionId: 'version-1', packageId: 'package-1',
        workerId: 'worker-1', grantId: 'grant-1', artifactId: 'artifact-1',
      },
    })
    metrics.recordCapability({
      capability: 'web.fetch',
      durationMs: 33,
      outcome: 'error',
      errorCode: 'TIMEOUT',
      correlation: { runId: 'run-1', grantId: 'grant-1' },
    })

    const snapshot = metrics.snapshot()
    expect(snapshot.counters).toMatchObject({
      queueDepth: 3,
      queueLagMs: 45,
      leaseExpired: 1,
      retry: 1,
      deadLetter: 0,
      artifactBytes: 512,
      approvalWaitMs: 80,
      importRejects: { unsupported_capability: 1 },
      runsByStatus: { completed: 1 },
      capabilityErrors: { TIMEOUT: 1 },
    })
    expect(snapshot.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'run', attributes: expect.objectContaining({ status: 'completed' }) }),
      expect.objectContaining({ kind: 'capability', attributes: expect.objectContaining({ capability: 'web.fetch', outcome: 'error', error_code: 'TIMEOUT' }) }),
    ]))
    expect(JSON.stringify(snapshot.points)).not.toContain('run-1')
    expect(JSON.stringify(snapshot.points)).not.toContain('grant-1')
  })

  it('bounds metric label cardinality to fixed safe values', () => {
    const metrics = new SkillRuntimeMetrics({ now: () => 10_000 })
    for (let index = 0; index < 500; index += 1) {
      metrics.recordCapability({
        capability: `https://attacker.example/${index}?prompt=secret-${index}`,
        durationMs: index,
        outcome: index % 2 === 0 ? 'success' : 'error',
        errorCode: `vendor-${index}`,
      })
    }

    const snapshot = metrics.snapshot()
    expect(snapshot.points.length).toBeLessThanOrEqual(500)
    expect(new Set(snapshot.points.map((point) => point.attributes.capability)).size).toBe(1)
    expect(new Set(snapshot.points.map((point) => point.attributes.error_code)).size).toBeLessThanOrEqual(2)
    expect(snapshot.points.every((point) => Object.keys(point.attributes).every((key) => !key.includes('url') && !key.includes('prompt')))).toBe(true)
  })

  it('exposes the required recording functions through the process-local sink', () => {
    recordRunMetric({ status: 'failed', durationMs: 9, correlation: { runId: 'run-global' } })
    recordCapabilityMetric({ capability: 'web.search', durationMs: 4, outcome: 'success', correlation: { runId: 'run-global' } })
    expect(SkillRuntimeMetrics.global().snapshot().counters.runsByStatus.failed).toBe(1)
    expect(SkillRuntimeMetrics.global().snapshot().counters.capabilityCalls).toBe(1)
  })
})
