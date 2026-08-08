import React from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { CapabilityApprovalCard } from './CapabilityApprovalCard'
import { SkillCapabilityPanel } from './SkillCapabilityPanel'
import { SkillInstallationPanel } from './SkillInstallationPanel'
import type { CapabilityGrant, PackageDetail, SkillInstallation, SkillRun } from './skill-runtime.types'

type SkillPermissionsPanelProps = {
  detail?: PackageDetail | null
  installations: SkillInstallation[]
  runs?: SkillRun[]
  readOnly?: boolean
  busyGrantIds?: Record<string, boolean>
  busyInstallationIds?: Record<string, boolean>
  onApprove?: (grant: CapabilityGrant) => void
  onReject?: (grant: CapabilityGrant) => void
  onRevoke?: (grant: CapabilityGrant) => void
  onToggleInstallation?: (installation: SkillInstallation, enabled: boolean) => void
  onRollbackInstallation?: (installation: SkillInstallation, versionId?: string) => void
  onUninstallInstallation?: (installation: SkillInstallation) => void
  onOpenRun?: (runId: string) => void
}

export function SkillPermissionsPanel({ detail, installations, runs = [], readOnly = false, busyGrantIds, busyInstallationIds, onApprove, onReject, onRevoke, onToggleInstallation, onRollbackInstallation, onUninstallInstallation, onOpenRun }: SkillPermissionsPanelProps) {
  if (!detail) return <section className="skills-center-panel skills-permissions-panel" aria-labelledby="skills-permissions-title"><div className="skills-center-panel-head"><div><div className="skills-eyebrow">Package Runtime</div><h2 id="skills-permissions-title">权限与安装</h2><p>选择一个 Package 后查看 Capability Grant、Installation 和 waiting_approval Run。</p></div></div><div className="skills-empty-state"><ShieldCheck size={18} aria-hidden="true" /><div><strong>等待选择 Package</strong><p>从 Skills Center、待审批事项或 Run Detail 进入权限上下文。</p></div></div></section>

  const packageInstallations = installations.filter((installation) => (installation.packageId || installation.package_id) === detail.package.id)
  const visibleInstallations = packageInstallations.length > 0 ? packageInstallations : detail.installations
  const currentInstallation = visibleInstallations[0]
  const currentVersionId = currentInstallation?.currentVersionId || currentInstallation?.current_version_id || detail.versions[0]?.id
  const currentVersion = detail.versions.find((version) => version.id === currentVersionId) || detail.versions[0]
  const grants = detail.capabilityGrants.filter((grant) => (grant.skillVersionId || grant.skill_version_id) === currentVersion?.id)
  const waitingRuns = runs.filter((run) => run.status === 'waiting_approval' && (!currentVersion?.id || run.skillVersionId === currentVersion.id))
  const manifest = currentVersion?.manifest as import('./skill-runtime.types').PackageManifest | undefined

  return <section className="skills-center-panel skills-permissions-panel" aria-labelledby="skills-permissions-title">
    <div className="skills-center-panel-head"><div><div className="skills-eyebrow">Package Runtime</div><h2 id="skills-permissions-title">权限与安装</h2><p>{detail.package.name} 的 Capability Grant、Installation 状态和 Run 审批上下文。</p></div><span className="skills-status info">{readOnly ? '只读' : '可管理'}</span></div>
    <div className="skills-permissions-context" aria-label="Package Runtime context"><div><span className="skills-eyebrow">Package Runtime</span><strong>{detail.package.name}</strong><small>Package ID：{detail.package.id}</small></div><div><span className="skills-eyebrow">当前 Version</span><strong>{currentVersion ? `v${currentVersion.version}` : '—'}</strong><small>{currentVersion?.id || '未安装版本'}</small></div></div>
    <SkillInstallationPanel installations={visibleInstallations} versions={detail.versions} readOnly={readOnly} busyInstallationIds={busyInstallationIds} onToggle={onToggleInstallation} onRollback={onRollbackInstallation} onUninstall={onUninstallInstallation} />
    <SkillCapabilityPanel manifest={manifest} grants={grants} versionId={currentVersion?.id} versionLabel={currentVersion ? `v${currentVersion.version}` : '当前版本'} readOnly={readOnly} busyGrantIds={busyGrantIds} onApprove={onApprove} onReject={onReject} onRevoke={onRevoke} />
    <section className="skills-center-subpanel skills-waiting-runs-panel" aria-labelledby="skills-waiting-runs-title"><div className="skills-center-subpanel-head"><div><h3 id="skills-waiting-runs-title">waiting_approval Runs</h3><p>审批完成后由 server/worker 收敛 Run 状态；页面保留来源 Run 以便回到原上下文。</p></div><ShieldCheck size={15} aria-hidden="true" /></div>{waitingRuns.length === 0 ? <p className="skills-muted">当前 Version 没有 waiting_approval Run。</p> : <div className="skills-waiting-runs-list">{waitingRuns.map((run) => <button type="button" className="skills-waiting-run-row" key={run.id} onClick={() => onOpenRun?.(run.id)}><span><strong>来源 Run</strong><small>{run.id} · {run.waitingReason || 'Capability approval required'}</small></span><span className="skills-status warning">waiting_approval <ExternalLink size={12} aria-hidden="true" /></span></button>)}</div>}</section>
    <div className="skills-center-inline-note"><ShieldCheck size={14} aria-hidden="true" /><span>Grant 状态由 API 返回的 server truth 驱动；重复审批使用同一 Grant ID 和 mutation key，避免并发冲突。</span></div>
  </section>
}

export { CapabilityApprovalCard }
