import React from 'react'
import type { RunRequiredAction } from './skill-runtime.types'

export function CapabilityApprovalCard({ action }: { action: RunRequiredAction | Record<string, unknown> }) {
  const requested = (action.requestedScope ?? action.requested_scope ?? {}) as Record<string, unknown>
  const granted = (action.grantedScope ?? action.granted_scope ?? {}) as Record<string, unknown>
  const capability = String(action.capability ?? '未命名能力')
  const risk = String(action.risk ?? action.riskLevel ?? action.risk_level ?? '未标注')
  return <section className="skills-approval-card" aria-labelledby="capability-approval-title"><div className="skills-detail-heading"><h3 id="capability-approval-title">Capability approval</h3><span className="skills-status warning">{risk}</span></div>
    <dl className="skills-detail-kv"><div><dt>能力</dt><dd className="skills-mono">{capability}</dd></div><div><dt>Grant ID</dt><dd className="skills-mono">{String(action.grantId ?? action.grant_id ?? '—')}</dd></div><div><dt>Requested scope</dt><dd><code>{safeScope(requested)}</code></dd></div><div><dt>Granted scope</dt><dd><code>{safeScope(granted)}</code></dd></div></dl>
  </section>
}

function safeScope(scope: Record<string, unknown>): string {
  const safe = Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, /(secret|token|password|api[_-]?key)/i.test(key) ? '[redacted]' : value]))
  try { return JSON.stringify(safe) }
  catch { return '{}' }
}
