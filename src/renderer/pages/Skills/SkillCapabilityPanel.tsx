import React from 'react'
import { Clock3, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { CapabilityGrant, CapabilityScope, PackageManifest } from './skill-runtime.types'

export type CapabilityGrantState = 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired' | 'consumed' | 'unknown'

export function formatCapabilityScope(scope: CapabilityScope | Record<string, unknown> | undefined): string {
  if (!scope || Object.keys(scope).length === 0) return '未限定 scope'
  const entries: string[] = []
  const add = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return
    entries.push(`${label}：${Array.isArray(value) ? value.join(', ') : String(value)}`)
  }
  add('允许目录', scope.allowedRoots)
  add('允许域名', scope.allowedDomains)
  add('允许模型', scope.allowedModels)
  add('调用预算', scope.maxCalls === undefined ? undefined : `${scope.maxCalls} 次`)
  for (const [key, value] of Object.entries(scope)) {
    if (['allowedRoots', 'allowedDomains', 'allowedModels', 'maxCalls'].includes(key)) continue
    add(key.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase()), value)
  }
  return entries.length ? entries.join(' · ') : '未限定 scope'
}

export function getCapabilityGrantState(grant: CapabilityGrant): CapabilityGrantState {
  const revokedAt = grant.revokedAt ?? grant.revoked_at
  const consumedAt = grant.consumedAt ?? grant.consumed_at
  const expiresAt = grant.expiresAt ?? grant.expires_at
  if (revokedAt != null || grant.status === 'revoked') return 'revoked'
  if (consumedAt != null) return 'consumed'
  if (expiresAt != null && expiresAt <= Date.now()) return 'expired'
  if (grant.status === 'approved' || grant.status === 'rejected' || grant.status === 'requested' || grant.status === 'expired') return grant.status
  return grant.status ? 'unknown' : 'approved'
}

export function capabilityStateLabel(state: CapabilityGrantState) {
  return { requested: '待审批', approved: '已批准', rejected: '已拒绝', revoked: '已撤销', expired: '已过期', consumed: '已消费', unknown: '未知' }[state]
}

export function capabilityStateTone(state: CapabilityGrantState) {
  if (state === 'approved') return 'success'
  if (state === 'rejected' || state === 'revoked' || state === 'expired') return 'danger'
  if (state === 'requested') return 'warning'
  return 'muted'
}

type SkillCapabilityPanelProps = {
  manifest?: PackageManifest
  grants: CapabilityGrant[]
  versionId?: string
  versionLabel?: string
  readOnly?: boolean
  onApprove?: (grant: CapabilityGrant) => void
  onReject?: (grant: CapabilityGrant) => void
  onRevoke?: (grant: CapabilityGrant) => void
}

export function SkillCapabilityPanel({ manifest, grants, versionId, versionLabel, readOnly = false, onApprove, onReject, onRevoke }: SkillCapabilityPanelProps) {
  const requested = manifest?.requestedCapabilities ?? []
  const grantByCapability = new Map(grants.map((grant) => [grant.capability, grant]))
  const versionText = versionLabel || (versionId ? `Version ${versionId}` : '当前版本')
  return <section className="skills-center-subpanel" aria-labelledby="skills-capability-panel-title">
    <div className="skills-center-subpanel-head"><div><h3 id="skills-capability-panel-title">Capabilities / Grants</h3><p>{versionText} 的权限请求、scope、预算和有效期；批准、拒绝和撤销都会写入审计。</p></div><LockKeyhole size={15} aria-hidden="true" /></div>
    {requested.length === 0 && grants.length === 0 ? <p className="skills-muted">Manifest 未声明能力请求。</p> : <div className="skills-center-capability-list">
      {requested.map((item) => {
        const grant = grantByCapability.get(item.capability)
        const state = grant ? getCapabilityGrantState(grant) : 'requested'
        const scope = grant?.grantedScope && Object.keys(grant.grantedScope).length > 0 ? grant.grantedScope : item.scope
        return <div className="skills-center-capability-row" key={item.capability}><div><strong>{item.capability}</strong><small>请求 scope：{formatCapabilityScope(item.scope)}</small>{grant && <small>生效 scope：{formatCapabilityScope(scope)}</small>}{grant && <small>授权模式：{grant.grantMode || grant.grant_mode || '—'}</small>}{grant?.expiresAt && <small>有效期至：{new Date(grant.expiresAt).toLocaleString()}</small>}</div><span className={'skills-status ' + capabilityStateTone(state)}>{capabilityStateLabel(state)}</span>{grant && !readOnly && state === 'requested' && <span className="skills-center-actions"><button type="button" className="skills-text-button" onClick={() => onApprove?.(grant)}>批准</button><button type="button" className="skills-text-button danger" onClick={() => onReject?.(grant)}>拒绝</button></span>}{grant && !readOnly && state === 'approved' && <button type="button" className="skills-text-button danger" onClick={() => onRevoke?.(grant)}>撤销</button>}</div>
      })}
      {grants.filter((grant) => !requested.some((item) => item.capability === grant.capability)).map((grant) => {
        const state = getCapabilityGrantState(grant)
        return <div className="skills-center-capability-row" key={grant.id}><div><strong>{grant.capability}</strong><small>scope：{formatCapabilityScope(grant.grantedScope && Object.keys(grant.grantedScope).length > 0 ? grant.grantedScope : grant.scope)}</small></div><span className={'skills-status ' + capabilityStateTone(state)}>{capabilityStateLabel(state)}</span>{!readOnly && state === 'approved' && <button type="button" className="skills-text-button danger" onClick={() => onRevoke?.(grant)}>撤销</button>}</div>
      })}
    </div>}
    <div className="skills-center-inline-note"><ShieldCheck size={14} aria-hidden="true" /> <span><strong>{versionText}</strong> · scope 仅用于可读展示，实际授权仍由 server policy 和 Runtime Broker 决定。</span></div>
    {grants.some((grant) => getCapabilityGrantState(grant) === 'requested') && <div className="skills-message warning"><Clock3 size={14} aria-hidden="true" />存在待审批权限；相关 Run 可能处于 waiting_approval，拒绝不会自动重试 Run。</div>}
  </section>
}
