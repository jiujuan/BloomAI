import React from 'react'
import type { CapabilityGrant, RunRequiredAction } from './skill-runtime.types'
import { capabilityStateLabel, capabilityStateTone, formatCapabilityScope, getCapabilityGrantState } from './skill-capability.utils'

type CapabilityApprovalCardProps = {
  action?: RunRequiredAction | Record<string, unknown>
  grant?: CapabilityGrant
  readOnly?: boolean
  readOnlyReason?: string
  pending?: boolean
  onApprove?: (grant: CapabilityGrant) => void
  onReject?: (grant: CapabilityGrant) => void
  onRevoke?: (grant: CapabilityGrant) => void
}

export function CapabilityApprovalCard({ action, grant, readOnly = false, readOnlyReason, pending = false, onApprove, onReject, onRevoke }: CapabilityApprovalCardProps) {
  if (grant) return <GrantApprovalCard grant={grant} readOnly={readOnly} readOnlyReason={readOnlyReason} pending={pending} onApprove={onApprove} onReject={onReject} onRevoke={onRevoke} />

  const source = action ?? {}
  const requested = (source.requestedScope ?? source.requested_scope ?? {}) as Record<string, unknown>
  const granted = (source.grantedScope ?? source.granted_scope ?? {}) as Record<string, unknown>
  const capability = String(source.capability ?? '未命名能力')
  const risk = String(source.risk ?? source.riskLevel ?? source.risk_level ?? '未标注')
  return <section className="skills-approval-card" aria-labelledby="capability-approval-title">
    <div className="skills-detail-heading"><h3 id="capability-approval-title">Capability approval</h3><span className="skills-status warning">{risk}</span></div>
    <dl className="skills-detail-kv"><div><dt>能力</dt><dd className="skills-mono">{capability}</dd></div><div><dt>Grant ID</dt><dd className="skills-mono">{String(source.grantId ?? source.grant_id ?? '—')}</dd></div><div><dt>Requested scope</dt><dd><code>{safeScope(requested)}</code></dd></div><div><dt>Granted scope</dt><dd><code>{safeScope(granted)}</code></dd></div></dl>
  </section>
}

function GrantApprovalCard({ grant, readOnly, readOnlyReason, pending, onApprove, onReject, onRevoke }: { grant: CapabilityGrant; readOnly: boolean; readOnlyReason?: string; pending: boolean; onApprove?: (grant: CapabilityGrant) => void; onReject?: (grant: CapabilityGrant) => void; onRevoke?: (grant: CapabilityGrant) => void }) {
  const state = getCapabilityGrantState(grant)
  const requestedScope = grant.requestedScope ?? grant.scope
  const grantedScope = grant.grantedScope && Object.keys(grant.grantedScope).length > 0 ? grant.grantedScope : grant.scope
  const expiresAt = grant.expiresAt ?? grant.expires_at
  const grantMode = grant.grantMode ?? grant.grant_mode ?? '—'
  const title = readOnly ? 'Capability Grant（只读）' : state === 'requested' ? '批准 Capability' : 'Capability Grant'
  const effectiveLabel = state === 'requested' ? 'Requested scope' : 'Effective scope'
  return <article className="skills-approval-card skills-capability-grant-card" data-grant-id={grant.id} aria-labelledby={`capability-grant-${grant.id}`}>
    <div className="skills-detail-heading">
      <div><h4 id={`capability-grant-${grant.id}`}>{title}</h4><p className="skills-capability-card-caption">{grant.capability}</p></div>
      <span className={`skills-status ${capabilityStateTone(state)}`}>{capabilityStateLabel(state)}</span>
    </div>
    <dl className="skills-detail-kv">
      <div><dt>能力</dt><dd className="skills-mono">{grant.capability}</dd></div>
      <div><dt>Grant ID</dt><dd className="skills-mono">{grant.id}</dd></div>
      <div><dt>Requested scope</dt><dd><code>{safeScope(requestedScope)}</code><small>{formatCapabilityScope(requestedScope)}</small></dd></div>
      <div><dt>{effectiveLabel}</dt><dd><code>{safeScope(grantedScope)}</code><small>{formatCapabilityScope(grantedScope)}</small></dd></div>
      <div><dt>授权模式</dt><dd>{String(grantMode)}</dd></div>
      <div><dt>有效期</dt><dd>{expiresAt == null ? '永久（需持续遵守 Runtime policy）' : new Date(expiresAt).toLocaleString()}</dd></div>
      {grant.usage && <div><dt>使用量</dt><dd>{grant.usage.calls} 次{grant.usage.bytes == null ? '' : ` · ${grant.usage.bytes} bytes`}</dd></div>}
    </dl>
    {readOnly ? <p className="skills-message info">当前操作者没有 Capability 管理权限，只能查看允许范围{readOnlyReason ? ` · ${readOnlyReason}` : ''}。</p> : <div className="skills-center-actions skills-capability-card-actions">
      {state === 'requested' && <><button type="button" className="skills-button primary" disabled={pending} aria-label={`批准 ${grant.capability}`} title={`批准 ${grant.capability}`} onClick={() => onApprove?.(grant)}>{pending ? '处理中…' : '批准 Capability'}</button><button type="button" className="skills-button danger" disabled={pending} aria-label={`拒绝 ${grant.capability}`} title={`拒绝 ${grant.capability}`} onClick={() => onReject?.(grant)}>{pending ? '处理中…' : '拒绝 Capability'}</button></>}
      {state === 'approved' && <button type="button" className="skills-button danger" disabled={pending} aria-label={`撤销 ${grant.capability}`} title={`撤销 ${grant.capability}`} onClick={() => onRevoke?.(grant)}>{pending ? '处理中…' : '撤销'}</button>}
    </div>}
  </article>
}

function safeScope(scope: Record<string, unknown>): string {
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, /(secret|token|password|api[_-]?key)/i.test(key) ? '[redacted]' : redact(nested)]))
  }
  try { return JSON.stringify(redact(scope)) }
  catch { return '{}' }
}
