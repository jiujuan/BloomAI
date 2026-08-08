import { describe, expect, it } from 'vitest'
import { SkillRuntimeMetrics } from './skill-runtime.metrics'
import { getRuntimeDiagnostics, getRuntimeHealth } from './skill-runtime.diagnostics'

describe('Skill Runtime diagnostics', () => {
  it('reports queue backlog, worker crash state, migrations, policy, and recent failures without secrets', () => {
    const metrics = new SkillRuntimeMetrics({ now: () => 50_000 })
    metrics.recordRun({ status: 'failed', durationMs: 100, correlation: { runId: 'run-failed' } })

    const diagnostics = getRuntimeDiagnostics({
      now: () => 50_000,
      config: {
        runtimeEnabled: true,
        packageExecutionEnabled: true,
        configVersion: '2026-08-06',
        protocolVersion: '1.1',
        policyVersion: 'skills-policy-test',
        eventRetentionDays: 30,
        logRetentionDays: 7,
        metricsRetentionMinutes: 60,
      },
      queue: [
        { id: 'queue-1', runId: 'run-queued', status: 'queued', availableAt: 49_000, leaseOwner: null, leaseUntil: null, attempt: 0, lastError: null, createdAt: 49_000, updatedAt: 49_000 },
        { id: 'queue-2', runId: 'run-dead', status: 'dead', availableAt: 1, leaseOwner: null, leaseUntil: null, attempt: 3, lastError: 'secret token=hidden', createdAt: 1, updatedAt: 2 },
      ],
      worker: { status: 'crashed', workerId: 'worker-1', lastError: 'authorization=hidden' },
      migrations: { current: '043-skill-security-audit-fields', applied: ['042-image-studio-skill-links', '043-skill-security-audit-fields'], pending: [] },
      metrics,
      recentFailures: [{ runId: 'run-failed', status: 'failed', errorCode: 'RUN_FAILED', errorMessage: 'api_key=hidden', updatedAt: 49_999 }],
    })

    expect(diagnostics.health).toMatchObject({ liveness: true, readiness: true })
    expect(diagnostics.queue).toMatchObject({ depth: 2, queued: 1, dead: 1, lagMs: 1_000 })
    expect(diagnostics.worker).toMatchObject({ status: 'crashed', workerId: 'worker-1' })
    expect(diagnostics.migration).toMatchObject({ current: '043-skill-security-audit-fields', pending: [] })
    expect(diagnostics.policy).toMatchObject({ version: 'skills-policy-test' })
    expect(JSON.stringify(diagnostics)).not.toContain('hidden')
  })

  it('returns liveness while making readiness explicit when runtime or migrations are unavailable', () => {
    expect(getRuntimeHealth({
      config: { runtimeEnabled: false, packageExecutionEnabled: false },
      migrations: { current: null, applied: [], pending: ['001-bootstrap'] },
    })).toMatchObject({
      liveness: true,
      readiness: false,
      status: 'disabled',
      availability: 'disabled',
      legacyStatus: 'not_ready',
    })
  })

  it('exposes canonical healthy, degraded, and disabled availability states', () => {
    expect(getRuntimeHealth({
      config: { runtimeEnabled: true, packageExecutionEnabled: true },
      worker: { status: 'running' },
    })).toMatchObject({ status: 'healthy', availability: 'healthy', readiness: true })

    expect(getRuntimeHealth({
      config: { runtimeEnabled: true, packageExecutionEnabled: true },
      worker: { status: 'crashed', lastError: 'worker failed' },
    })).toMatchObject({ status: 'degraded', availability: 'degraded' })

    expect(getRuntimeHealth({
      config: { runtimeEnabled: false, packageExecutionEnabled: true },
    })).toMatchObject({ status: 'disabled', availability: 'disabled', readiness: false })
  })
})
