import React, { useMemo, useState } from 'react'
import { Archive, ExternalLink, FileCode2, History, LoaderCircle, Play, Power, RotateCcw, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react'
import { useSkillRuntimeStore } from './skill-runtime.store'
import { formatDate, parseJson } from './skill-runtime.types'
import type { CapabilityGrant, PackageDetail, PackageManifest, SkillRun, SkillVersion } from './skill-runtime.types'

export function PackageDetailDrawer({ detail, runs, onClose, onRun, onOpenRun }: { detail: PackageDetail; runs: SkillRun[]; onClose: () => void; onRun: (version: SkillVersion) => void; onOpenRun: (runId: string) => void }) {
  const { setInstallationEnabled, uninstallPackage, rollbackInstallation, deletePackage: deletePackageAction, revokeCapabilityGrant } = useSkillRuntimeStore()
  const [busy, setBusy] = useState<string | null>(null)
  const currentInstallation = detail.installations[0]
  const currentVersion = detail.versions.find((version) => version.id === (currentInstallation?.currentVersionId || currentInstallation?.current_version_id)) || detail.versions[0]
  const manifest = parseJson<PackageManifest>(currentVersion?.manifest_json, emptyManifest)
  const snapshot = parseJson<{ sourceCommit?: string; sourceRef?: string; sourceSha256?: string }>(currentVersion?.source_snapshot_json, {})
  const recentRuns = runs.filter((run) => run.skillVersionId === currentVersion?.id).slice(0, 5)
  const grants = detail.capabilityGrants.filter((grant) => (grant.skillVersionId || grant.skill_version_id) === currentVersion?.id)
  const activeGrants = grants.filter(isActiveGrant)
  const packageDeleted = Boolean(detail.package.deleted_at)
  const installationRetired = currentInstallation?.status === 'uninstalled' || currentInstallation?.status === 'deleted'
  const lifecycleLocked = packageDeleted || installationRetired
  const installationEnabled = currentInstallation?.enabled === true || currentInstallation?.enabled === 1
  const rollbackCandidates = useMemo(() => detail.versions.filter((version) => (
    version.id !== currentVersion?.id &&
    version.is_compatible === 1 &&
    version.status === 'runnable' &&
    (version.security_status === 'verified' || version.security_status === 'approved')
  )), [currentVersion?.id, detail.versions])
  const rollbackTarget = rollbackCandidates.find((version) => version.id === currentInstallation?.previousVersionId || currentInstallation?.previous_version_id) || rollbackCandidates[0]

  const updateEnabled = async () => {
    if (!currentInstallation || lifecycleLocked) return
    setBusy('enabled')
    try {
      await setInstallationEnabled(currentInstallation.id, !installationEnabled, currentInstallation.revision ?? 0)
    } finally { setBusy(null) }
  }
  const uninstall = async () => {
    if (!currentInstallation || lifecycleLocked || !window.confirm('确认卸载这个 Package Skill？卸载只会禁止新的 Run，不会物理删除 Package、版本快照、Run、Event 或 Artifact；这些审计记录会保留。')) return
    setBusy('uninstall')
    try { await uninstallPackage(currentInstallation.id, currentInstallation.revision ?? 0); onClose() } finally { setBusy(null) }
  }
  const rollback = async () => {
    if (!currentInstallation || !rollbackTarget || lifecycleLocked) return
    const reason = window.prompt(`请输入回滚到 ${rollbackTarget.version} 的原因：`, currentInstallation.rollback_reason || '用户请求回滚')?.trim()
    if (!reason) return
    if (!window.confirm(`确认回滚到已验证版本 ${rollbackTarget.version}？当前版本不会删除，现有 Run/Event/Artifact 引用也会保留。`)) return
    setBusy('rollback')
    try {
      await rollbackInstallation(currentInstallation.id, { versionId: rollbackTarget.id, expectedRevision: currentInstallation.revision ?? 0, reason })
    } finally { setBusy(null) }
  }
  const softDeletePackage = async () => {
    if (packageDeleted || !window.confirm('确认归档这个 Package？这是 soft delete：不会物理删除 Package、版本、安装历史、Run、Event 或 Artifact；如果仍有 active installation 或运行中的 Run，服务端会阻止操作。')) return
    const reason = window.prompt('请输入归档原因：', detail.package.delete_reason || '用户请求归档')?.trim()
    if (!reason) return
    setBusy('delete-package')
    try { await deletePackageAction(detail.package.id, { reason }); onClose() } finally { setBusy(null) }
  }
  const revoke = async (grant: CapabilityGrant) => {
    if (!window.confirm('撤销此权限后，后续运行将再次请求授权。是否继续？')) return
    setBusy(grant.id)
    try { await revokeCapabilityGrant(grant.id) } finally { setBusy(null) }
  }

  return <aside className="skills-drawer" aria-label="Package Skill 详情">
    <header className="skills-drawer-head"><div><div className="skills-eyebrow">Package Skill</div><h2>{detail.package.name}</h2><p>{detail.package.description || manifest.description || '未提供描述'}</p></div><button className="skills-icon-button" onClick={onClose} aria-label="关闭详情"><X size={16} /></button></header>
    <div className="skills-drawer-scroll">
      {packageDeleted && <div className="skills-message warning"><Archive size={15} />此 Package 已于 {formatDate(detail.package.deleted_at)} 归档：{detail.package.delete_reason || '未提供原因'}。控制面对象保留用于审计。</div>}
      {installationRetired && <div className="skills-message warning"><ShieldAlert size={15} />此安装已卸载；版本、快照、Run、Event 和 Artifact 仍保留，但不会再接受新的 Run。</div>}
      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>当前安装</h3><span className={'skills-status ' + installationStatusTone(currentInstallation?.status, currentInstallation?.enabled)}>{installationStatusLabel(currentInstallation)}</span></div>
        <dl className="skills-detail-kv"><div><dt>版本</dt><dd>{currentVersion?.version || '—'}</dd></div><div><dt>Runtime</dt><dd>{currentVersion?.runtime || '—'}</dd></div><div><dt>安装时间</dt><dd>{formatDate(currentInstallation?.installed_at)}</dd></div><div><dt>状态</dt><dd>{currentInstallation?.status || '—'}</dd></div><div><dt>Revision</dt><dd className="skills-mono">{currentInstallation?.revision ?? 0}</dd></div><div><dt>最近变更</dt><dd>{formatDate(currentInstallation?.changed_at || currentInstallation?.updated_at)}</dd></div></dl>
        <div className="skills-action-row"><button className="skills-button primary" disabled={!currentVersion || currentInstallation?.enabled !== 1 || lifecycleLocked} onClick={() => currentVersion && onRun(currentVersion)}><Play size={14} />运行</button><button className="skills-button secondary" disabled={!currentInstallation || lifecycleLocked || busy !== null} onClick={updateEnabled}>{busy === 'enabled' ? <LoaderCircle className="spin" size={14} /> : <Power size={14} />}{currentInstallation?.enabled === 1 ? '禁用' : '启用'}</button><button className="skills-button secondary" disabled={!rollbackTarget || lifecycleLocked || busy !== null} onClick={rollback}>{busy === 'rollback' ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}回滚</button><button className="skills-button danger" disabled={!currentInstallation || lifecycleLocked || busy !== null} onClick={uninstall}>{busy === 'uninstall' ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}卸载</button></div>
        <p className="skills-muted">禁用只阻止新的 Run，不会取消已启动的 Run；卸载和回滚都保留历史引用与审计证据。</p>
      </section>
      <section className="skills-detail-section"><h3>来源与快照</h3><dl className="skills-detail-kv"><div><dt>来源</dt><dd>{detail.package.source_uri || detail.package.source_type}</dd></div><div><dt>固定 ref</dt><dd>{snapshot.sourceCommit || snapshot.sourceRef || detail.package.source_ref || '—'}</dd></div><div><dt>快照哈希</dt><dd className="skills-mono">{snapshot.sourceSha256 || currentVersion?.snapshot_hash || currentVersion?.manifest_hash || '—'}</dd></div><div><dt>Package 路径</dt><dd className="skills-mono">{currentVersion?.package_path || '—'}</dd></div></dl></section>
      <section className="skills-detail-section"><h3>版本与回滚</h3><div className="skills-permission-diff">{detail.versions.map((version) => <div className="skills-permission-row" key={version.id}><span>{version.version}{version.id === currentVersion?.id ? ' · current' : ''}</span><span className={'skills-status ' + (version.id === currentVersion?.id ? 'success' : version.status === 'runnable' && (version.security_status === 'verified' || version.security_status === 'approved') ? 'info' : 'muted')}>{version.id === currentVersion?.id ? '当前版本' : version.status === 'runnable' && (version.security_status === 'verified' || version.security_status === 'approved') ? '可回滚' : '不可回滚'}</span></div>)}{detail.versions.length === 0 && <p className="skills-muted">尚无版本记录。</p>}</div>{currentInstallation?.rollback_reason && <p className="skills-muted">上次回滚原因：{currentInstallation.rollback_reason}</p>}</section>
      <section className="skills-detail-section"><h3>兼容性与权限差异</h3><CompatibilityPanel manifest={manifest} activeGrants={activeGrants} /></section>
      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>已授予权限</h3><span className="skills-count">{activeGrants.length}</span></div>{activeGrants.length === 0 ? <p className="skills-muted">当前版本尚无有效授权；运行时会按能力策略请求许可。</p> : <div className="skills-grant-list">{activeGrants.map((grant) => <div className="skills-grant" key={grant.id}><div><strong>{grant.capability}</strong><p>{grant.grant_mode} · {formatDate(grant.granted_at)}</p></div><button className="skills-text-button danger" disabled={busy !== null} onClick={() => revoke(grant)}>{busy === grant.id ? '撤销中…' : '撤销'}</button></div>)}</div>}</section>
      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>最近 Runs</h3><History size={15} /></div>{recentRuns.length === 0 ? <p className="skills-muted">尚无该版本的运行记录。</p> : <div className="skills-run-mini-list">{recentRuns.map((run) => <button className="skills-run-mini" key={run.id} onClick={() => onOpenRun(run.id)}><span className={'skills-status ' + statusTone(run.status)}>{run.status}</span><span>{formatDate(run.updatedAt)}</span><ExternalLink size={13} /></button>)}</div>}</section>
      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>控制面删除</h3><Archive size={15} /></div><p className="skills-muted">删除默认为 soft delete。服务端会在存在 active installation 或运行中 Run 时拒绝归档；成功后仍保留版本、快照、安装历史、Run、Event、Artifact 和审计事件。</p><button className="skills-button danger" disabled={packageDeleted || busy !== null} onClick={softDeletePackage}>{busy === 'delete-package' ? <LoaderCircle className="spin" size={14} /> : <Archive size={14} />}归档 Package</button></section>
      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>Manifest</h3><FileCode2 size={15} /></div><pre className="skills-manifest">{JSON.stringify(manifest, null, 2)}</pre></section>
    </div>
  </aside>
}

const emptyManifest: PackageManifest = { name: '', description: '', runtime: 'instruction-agent', entryPath: 'SKILL.md', compatible: true, requestedCapabilities: [], outputArtifactTypes: [], references: [], assets: [], scripts: [], unsupported: [], unknownFrontmatter: {} }

function CompatibilityPanel({ manifest, activeGrants }: { manifest: PackageManifest; activeGrants: CapabilityGrant[] }) {
  const requested = manifest.requestedCapabilities || []
  const granted = new Set(activeGrants.map((grant) => grant.capability))
  return <><div className={'skills-message ' + (manifest.compatible ? 'success' : 'warning')}><ShieldCheck size={15} />{manifest.compatible ? '该版本仅使用 B-Lite 支持的运行时能力。' : '该版本包含 B-Lite 尚不支持的声明。'}</div>{manifest.unsupported.length > 0 && <div className="skills-chip-row">{manifest.unsupported.map((item) => <span className="skills-chip danger" key={item}>{item}</span>)}</div>}<div className="skills-permission-diff">{requested.map((request) => <div className="skills-permission-row" key={request.capability}><span>{request.capability}</span><span className={'skills-status ' + (granted.has(request.capability) ? 'success' : 'warning')}>{granted.has(request.capability) ? '已授权' : '待授权'}</span></div>)}{requested.length === 0 && <p className="skills-muted">Manifest 未声明能力请求。</p>}</div></>
}

function installationStatusLabel(installation: { status: string; enabled: boolean | 0 | 1 } | undefined) {
  if (!installation) return '未安装'
  if (installation.status === 'uninstalled') return '已卸载'
  if (installation.status === 'deleted') return '已删除'
  return installation.enabled === 1 ? '已启用' : '已禁用'
}

function installationStatusTone(status: string | undefined, enabled: boolean | 0 | 1 | undefined) {
  if (status === 'uninstalled' || status === 'deleted') return 'warning'
  return enabled === 1 ? 'success' : 'muted'
}

function isActiveGrant(grant: CapabilityGrant) { return grant.revoked_at == null && grant.consumed_at == null && (grant.expires_at == null || grant.expires_at > Date.now()) }
function statusTone(status: string) { if (status === 'completed') return 'success'; if (status === 'failed' || status === 'cancelled') return 'danger'; if (status.startsWith('waiting')) return 'warning'; return 'info' }
