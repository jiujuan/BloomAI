import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SkillRuntimeDiagnostics } from './SkillRuntimeDiagnostics'

describe('SkillRuntimeDiagnostics', () => {
  it('renders health, worker, queue, migration, policy, and failure sections without secret fields', () => {
    const markup = renderToStaticMarkup(<SkillRuntimeDiagnostics
      loading={false}
      error={null}
      diagnostics={{
        health: { liveness: true, readiness: true, status: 'ready', checks: [] },
        worker: { status: 'running', workerId: 'worker-1' },
        queue: { depth: 2, queued: 1, leased: 1, retryWait: 0, dead: 0, lagMs: 20 },
        migration: { current: '043-skill-security-audit-fields', applied: [], pending: [] },
        policy: { version: 'skills-policy-v1.1', configVersion: '2026-08-06' },
        recentFailures: [],
      }}
      onRefresh={vi.fn()}
    />)

    expect(markup).toContain('Runtime Health')
    expect(markup).toContain('Worker')
    expect(markup).toContain('Queue Backlog')
    expect(markup).toContain('Migration')
    expect(markup).toContain('Policy')
    expect(markup).not.toMatch(/secret|token|password|prompt/i)
  })
})
