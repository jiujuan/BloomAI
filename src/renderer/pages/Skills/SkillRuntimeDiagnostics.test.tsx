import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SkillRuntimeDiagnostics } from './SkillRuntimeDiagnostics'
import type { SkillRuntimeDiagnosticsSnapshot } from './skill-runtime.types'

const snapshot: SkillRuntimeDiagnosticsSnapshot = {
  health: {
    liveness: true,
    readiness: true,
    status: 'ready',
    checks: [{ name: 'runtime', status: 'ok' }],
  },
  worker: { status: 'running', workerId: 'worker-1', activeRuns: 1, concurrency: 2 },
  queue: { depth: 2, queued: 1, leased: 1, retryWait: 0, dead: 0, lagMs: 20 },
  migration: { current: '043-skill-security-audit-fields', applied: ['042'], pending: [] },
  policy: { version: 'skills-policy-v1.1', configVersion: '2026-08-06' },
  recentFailures: [],
}

describe('SkillRuntimeDiagnostics', () => {
  it('renders health, worker, queue, migration, policy, and failure sections without secret fields', () => {
    const markup = renderToStaticMarkup(<SkillRuntimeDiagnostics
      loading={false}
      error={null}
      diagnostics={{
        ...snapshot,
        recentFailures: [{ runId: 'run-1', status: 'failed', errorCode: 'RUN_FAILED', errorMessage: 'secret-token-should-not-render' }],
      }}
      onRefresh={vi.fn()}
    />)

    expect(markup).toContain('Runtime Health')
    expect(markup).toContain('Worker')
    expect(markup).toContain('Queue Backlog')
    expect(markup).toContain('Migration')
    expect(markup).toContain('Policy')
    expect(markup).toContain('RUN_FAILED')
    expect(markup).toContain('skills-runtime-status success')
    expect(markup).not.toContain('secret-token-should-not-render')
    expect(markup).not.toMatch(/password|prompt/i)
  })

  it('maps a failed runtime check to the disabled state and safe status class', () => {
    const markup = renderToStaticMarkup(<SkillRuntimeDiagnostics
      loading={false}
      error={null}
      diagnostics={{
        ...snapshot,
        health: { liveness: false, readiness: false, status: 'not_ready', checks: [{ name: 'runtime', status: 'failed', message: 'internal detail' }] },
      }}
      onRefresh={vi.fn()}
    />)

    expect(markup).toContain('Disabled')
    expect(markup).toContain('skills-runtime-status muted')
    expect(markup).toContain('skills-runtime-check failed')
    expect(markup).not.toContain('internal detail')
  })


  it('prefers canonical availability and renders safe runtime metric counters', () => {
    const markup = renderToStaticMarkup(<SkillRuntimeDiagnostics
      loading={false}
      error={null}
      diagnostics={{
        ...snapshot,
        health: { ...snapshot.health, status: 'degraded', availability: 'healthy', legacyStatus: 'ready' },
        metrics: {
          generatedAt: 100,
          retentionMs: 60_000,
          counters: {
            installCount: 3,
            approvalCount: 4,
            queueDepth: 2,
            runsByStatus: { completed: 5 },
            artifactOperations: { create_success: 6 },
            errorCount: 7,
            legacyRejectCount: 8,
          },
        },
      }}
      onRefresh={vi.fn()}
    />)

    expect(markup).toContain('Healthy')
    expect(markup).toContain('skills-runtime-status success')
    expect(markup).toContain('Installs')
    expect(markup).toContain('Approvals')
    expect(markup).toContain('Runs')
    expect(markup).toContain('Artifacts')
    expect(markup).toContain('Errors')
    expect(markup).toContain('Legacy rejects')
    expect(markup).toContain('>3<')
    expect(markup).toContain('>4<')
    expect(markup).toContain('>5<')
    expect(markup).toContain('>6<')
    expect(markup).toContain('>7<')
    expect(markup).toContain('>8<')
  })

  it('uses disabled availability before legacy status when the runtime is unavailable', () => {
    const markup = renderToStaticMarkup(<SkillRuntimeDiagnostics
      loading={false}
      error={null}
      diagnostics={{
        ...snapshot,
        health: { ...snapshot.health, readiness: false, status: 'ready', availability: 'disabled', legacyStatus: 'not_ready' },
      }}
      onRefresh={vi.fn()}
    />)

    expect(markup).toContain('Disabled')
    expect(markup).toContain('skills-runtime-status muted')
  })

  it('shows generic loading and error states without echoing raw error text', () => {
    const markup = renderToStaticMarkup(<SkillRuntimeDiagnostics
      loading={false}
      error={'database password leaked'}
      diagnostics={null}
      onRefresh={vi.fn()}
    />)

    expect(markup).toContain('无法加载 Runtime Diagnostics。')
    expect(markup).not.toContain('database password leaked')
  })
})
