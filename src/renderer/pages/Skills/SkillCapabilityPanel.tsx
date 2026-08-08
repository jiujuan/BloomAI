import React from 'react'
import { Clock3, LockKeyhole, ShieldCheck } from 'lucide-react'
import { CapabilityApprovalCard } from './CapabilityApprovalCard'
import type { CapabilityGrant, PackageManifest } from './skill-runtime.types'
import { capabilityStateLabel, capabilityStateTone, formatCapabilityScope, getCapabilityGrantState } from './skill-capability.utils'

export type { CapabilityGrantState } from './skill-capability.utils'
export { capabilityStateLabel, capabilityStateTone, formatCapabilityScope, getCapabilityGrantState } from './skill-capability.utils'

type SkillCapabilityPanelProps = {
  manifest?: PackageManifest
  grants: CapabilityGrant[]
  versionId?: string
  versionLabel?: string
  readOnly?: boolean
  busyGrantIds?: Record<string, boolean>
  isGrantBusy?: (grant: CapabilityGrant) => boolean
  onApprove?: (grant: CapabilityGrant) => void
  onReject?: (grant: CapabilityGrant) => void
  onRevoke?: (grant: CapabilityGrant) => void
}

export function SkillCapabilityPanel({ manifest, grants, versionId, versionLabel, readOnly = false, busyGrantIds = {}, isGrantBusy, onApprove, onReject, onRevoke }: SkillCapabilityPanelProps) {
  const requested = manifest?.requestedCapabilities ?? []
  const versionText = versionLabel || (versionId ? `Version ${versionId}` : '当前版本')
  const stateOf = (grant: CapabilityGrant) => getCapabilityGrantState(grant)
  const pending = grants.filter((grant) => stateOf(grant) === 'requested')
  const active = grants.filter((grant) => stateOf(grant) === 'approved')
  const closed = grants.filter((grant) => !['requested', 'approved'].includes(stateOf(grant)))
  const missingRequests = requested.filter((item) => !grants.some((grant) => grant.capability === item.capability))
  const isBusy = (grant: CapabilityGrant) => Boolean(busyGrantIds[grant.id] || isGrantBusy?.(grant))

  return <section className="skills-center-subpanel" aria-labelledby="skills-capability-panel-title">
    <div className="skills-center-subpanel-head">
      <div>
        <h3 id="skills-capability-panel-title">Capabilities / Grants</h3>
        <p>{versionText} 的权限请求、scope、预算和有效期；批准、拒绝和撤销都会写入审计。</p>
      </div>
      <div className="skills-capability-heading-tools">
        {readOnly && <span className="skills-status muted">只读</span>}
        <LockKeyhole size={15} aria-hidden="true" />
      </div>
    </div>

    <CapabilityGrantGroup title="Pending Approval" tone="warning" emptyLabel="当前没有待审批 Capability。">
      {missingRequests.map((item) => <div className="skills-center-capability-row" key={`manifest-${item.capability}`}>
        <div><strong>{item.capability}</strong><small>请求 scope：{formatCapabilityScope(item.scope)}</small><small>尚未创建 Grant；需要 Runtime Broker 决定是否进入审批队列。</small></div>
        <span className="skills-status warning">待审批</span>
      </div>)}
      {pending.map((grant) => <CapabilityApprovalCard key={grant.id} grant={grant} readOnly={readOnly} pending={isBusy(grant)} onApprove={onApprove} onReject={onReject} onRevoke={onRevoke} />)}
    </CapabilityGrantGroup>

    <CapabilityGrantGroup title="Active Grants" tone="success" emptyLabel="当前没有生效中的 Grant。">
      {active.map((grant) => <CapabilityApprovalCard key={grant.id} grant={grant} readOnly={readOnly} pending={isBusy(grant)} onApprove={onApprove} onReject={onReject} onRevoke={onRevoke} />)}
    </CapabilityGrantGroup>

    <CapabilityGrantGroup title="Revoked / Closed" tone="muted" emptyLabel="当前没有已关闭的 Grant。">
      {closed.map((grant) => <CapabilityApprovalCard key={grant.id} grant={grant} readOnly readOnlyReason={capabilityStateLabel(stateOf(grant))} />)}
    </CapabilityGrantGroup>

    {requested.length === 0 && grants.length === 0 && <p className="skills-muted">Manifest 未声明能力请求。</p>}
    <div className="skills-center-inline-note"><ShieldCheck size={14} aria-hidden="true" /> <span><strong>{versionText}</strong> · scope 仅用于可读展示，实际授权仍由 server policy 和 Runtime Broker 决定。</span></div>
    {pending.length > 0 && <div className="skills-message warning"><Clock3 size={14} aria-hidden="true" />存在待审批权限；相关 Run 可能处于 waiting_approval，拒绝不会自动重试 Run。</div>}
  </section>
}

function CapabilityGrantGroup({ title, tone, emptyLabel, children }: { title: string; tone: 'warning' | 'success' | 'muted'; emptyLabel: string; children: React.ReactNode }) {
  const hasChildren = React.Children.count(children) > 0
  return <section className="skills-capability-group" aria-labelledby={`skills-capability-group-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
    <div className="skills-capability-group-head"><h4 id={`skills-capability-group-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{title}</h4><span className={`skills-status ${tone}`}>{hasChildren ? '有记录' : '空'}</span></div>
    {hasChildren ? <div className="skills-capability-group-list">{children}</div> : <p className="skills-muted">{emptyLabel}</p>}
  </section>
}
