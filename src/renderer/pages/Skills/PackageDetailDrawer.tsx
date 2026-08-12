import React, { useMemo, useState } from 'react'
import { Archive, ExternalLink, FileCode2, History, LoaderCircle, Play, Power, RotateCcw, ShieldAlert, Trash2, X } from 'lucide-react'
import { useSkillRuntimeStore } from './skill-runtime.store'
import { formatDate, parseJson } from './skill-runtime.types'
import type { PackageDetail, PackageManifest, SkillInstallation, SkillRun, SkillVersion } from './skill-runtime.types'
import { getVersionSelection, SkillVersionPanel } from './SkillVersionPanel'
import { SkillEditor, type VersionImpactAction } from './SkillEditor'

export type PackageDetailDrawerProps = {
  detail: PackageDetail
  runs: SkillRun[]
  selectedVersionId?: string
  onClose: () => void
  onRun: (version: SkillVersion) => void
  onOpenRun: (runId: string) => void
  onSelectVersion?: (version: SkillVersion) => void
  onCreateVersion?: (version: SkillVersion) => void | Promise<void>
}

export function PackageDetailDrawer({ detail, runs, selectedVersionId, onClose, onRun, onOpenRun, onSelectVersion, onCreateVersion }: PackageDetailDrawerProps) {
  const { setInstallationEnabled, uninstallPackage, rollbackInstallation, deletePackage: deletePackageAction } = useSkillRuntimeStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [versionEditor, setVersionEditor] = useState<{ action: VersionImpactAction; target: SkillVersion } | null>(null)
  const currentInstallation = detail.installations[0]
  const selection = getVersionSelection(detail.versions, currentInstallation?.currentVersionId || currentInstallation?.current_version_id, selectedVersionId)
  const currentVersion = selection.current
  const selectedVersion = selection.selected
  const currentVersionId = currentVersion?.id
  const selectedIsCurrent = selectedVersion?.id === currentVersionId
  const manifest = parseVersionManifest(selectedVersion)
  const snapshot = parseVersionSnapshot(selectedVersion)
  const selectedRuns = runs.filter((run) => run.skillVersionId === selectedVersion?.id).slice(0, 5)
  const packageDeleted = Boolean(detail.package.deletedAt ?? detail.package.deleted_at)
  const installationRetired = currentInstallation?.status === 'uninstalled' || currentInstallation?.status === 'deleted'
  const lifecycleLocked = packageDeleted || installationRetired
  const installationEnabled = currentInstallation ? Boolean(currentInstallation.enabled === true || currentInstallation.enabled === 1) : false
  const rollbackCandidates = useMemo(() => detail.versions.filter((version) => (
    version.id !== currentVersionId &&
    Boolean(version.isCompatible ?? version.is_compatible) &&
    version.status === 'runnable' &&
    (version.securityStatus === 'verified' || version.security_status === 'verified' || version.securityStatus === 'approved' || version.security_status === 'approved')
  )), [currentVersionId, detail.versions])
  const rollbackTarget = rollbackCandidates.find((version) => version.id === (currentInstallation?.previousVersionId || currentInstallation?.previous_version_id)) || rollbackCandidates[0]

  const updateEnabled = async () => {
    if (!currentInstallation || lifecycleLocked) return
    setBusy('enabled')
    try { await setInstallationEnabled(currentInstallation.id, !installationEnabled, currentInstallation.revision ?? 0) } finally { setBusy(null) }
  }
  const uninstall = async () => {
    if (!currentInstallation || lifecycleLocked || !window.confirm('确认卸载这个 Package Skill？卸载只会禁止新的 Run，不会物理删除 Package、版本快照、Run、Event 或 Artifact；这些审计记录会保留。')) return
    setBusy('uninstall')
    try { await uninstallPackage(currentInstallation.id, currentInstallation.revision ?? 0); onClose() } finally { setBusy(null) }
  }
  const rollbackTo = async (target: SkillVersion) => {
    if (!currentInstallation || lifecycleLocked) return
    const reason = window.prompt(`请输入回滚到 ${target.version} 的原因：`, currentInstallation.rollbackReason || currentInstallation.rollback_reason || '用户请求回滚')?.trim()
    if (!reason) return
    setBusy('rollback')
    try { await rollbackInstallation(currentInstallation.id, { versionId: target.id, expectedRevision: currentInstallation.revision ?? 0, reason }) } finally { setBusy(null) }
  }
  const rollback = async () => {
    if (!rollbackTarget || !currentInstallation || lifecycleLocked) return
    if (!window.confirm(`确认回滚到已验证版本 ${rollbackTarget.version}？当前版本不会删除，现有 Run/Event/Artifact 引用也会保留。`)) return
    await rollbackTo(rollbackTarget)
  }
  const softDeletePackage = async () => {
    if (packageDeleted || !window.confirm('确认归档这个 Package？这是 soft delete：不会物理删除 Package、版本、安装历史、Run、Event 或 Artifact；如果仍有 active installation 或运行中的 Run，服务端会阻止操作。')) return
    const reason = window.prompt('请输入归档原因：', detail.package.deleteReason || detail.package.delete_reason || '用户请求归档')?.trim()
    if (!reason) return
    setBusy('delete-package')
    try { await deletePackageAction(detail.package.id, { reason }); onClose() } finally { setBusy(null) }
  }
  const confirmVersionAction = async () => {
    if (!versionEditor) return
    const editor = versionEditor
    setVersionEditor(null)
    if (editor.action === 'rollback') await rollbackTo(editor.target)
    else if (onCreateVersion) await onCreateVersion(editor.target)
  }

  return <aside className="skills-drawer" aria-label="Package Skill 详情">
    <header className="skills-drawer-head"><div><div className="skills-eyebrow">Package Skill · Detail</div><h2>{detail.package.name}</h2><p>{detail.package.description || manifest.description || '未提供描述'}</p><div className="skills-chip-row"><span className="skills-chip">当前版本：v{currentVersion?.version || '—'}</span><span className="skills-chip">来源：{detail.package.sourceType || detail.package.source_type || 'unknown'}</span><span className="skills-chip">Package ID：<span className="skills-center-mono">{detail.package.id}</span></span></div></div><button type="button" className="skills-icon-button" onClick={onClose} aria-label="关闭详情" title="关闭详情"><X size={16} /></button></header>
    <div className="skills-drawer-scroll">
      {packageDeleted && <div className="skills-message warning"><Archive size={15} />此 Package 已于 {formatDate(detail.package.deletedAt ?? detail.package.deleted_at)} 归档：{detail.package.deleteReason || detail.package.delete_reason || '未提供原因'}。控制面对象保留用于审计。</div>}
      {installationRetired && <div className="skills-message warning"><ShieldAlert size={15} />此安装已卸载；版本、快照、Run、Event 和 Artifact 仍保留，但不会再接受新的 Run。</div>}
      {!selectedIsCurrent && selectedVersion && <div className="skills-message info"><History size={15} /><div><strong>正在查看历史版本 v{selectedVersion.version}</strong><p>当前 Installation 仍指向 v{currentVersion?.version || '—'}；历史版本不会显示为 current，也不能直接启动新的 Run。</p></div></div>}

      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>当前安装</h3><span className={'skills-status ' + installationStatusTone(currentInstallation?.status, currentInstallation?.enabled)}>{installationStatusLabel(currentInstallation)}</span></div>
        <dl className="skills-detail-kv"><div><dt>Installation ID</dt><dd className="skills-mono">{currentInstallation?.id || '—'}</dd></div><div><dt>当前版本</dt><dd>v{currentVersion?.version || '—'} <span className="skills-muted">({currentVersion?.id || '—'})</span></dd></div><div><dt>Runtime</dt><dd>{currentVersion?.runtime || '—'}</dd></div><div><dt>安装时间</dt><dd>{formatDate(currentInstallation?.installedAt ?? currentInstallation?.installed_at)}</dd></div><div><dt>Revision</dt><dd className="skills-mono">{currentInstallation?.revision ?? 0}</dd></div><div><dt>最近变更</dt><dd>{formatDate(currentInstallation?.changedAt ?? currentInstallation?.changed_at ?? currentInstallation?.updatedAt ?? currentInstallation?.updated_at)}</dd></div></dl>
        <div className="skills-action-row"><button type="button" className="skills-button primary" disabled={!currentVersion || !selectedIsCurrent || !installationEnabled || lifecycleLocked} title={!selectedIsCurrent ? '历史版本不能启动新 Run' : undefined} onClick={() => currentVersion && onRun(currentVersion)}><Play size={14} />运行当前版本</button><button type="button" className="skills-button secondary" disabled={!currentInstallation || lifecycleLocked || busy !== null} onClick={() => void updateEnabled()}>{busy === 'enabled' ? <LoaderCircle className="spin" size={14} /> : <Power size={14} />}{installationEnabled ? '禁用' : '启用'}</button><button type="button" className="skills-button secondary" disabled={!rollbackTarget || lifecycleLocked || busy !== null} onClick={() => void rollback()}>{busy === 'rollback' ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}回滚</button><button type="button" className="skills-button danger" disabled={!currentInstallation || lifecycleLocked || busy !== null} onClick={() => void uninstall()}>{busy === 'uninstall' ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}卸载</button></div>
        <p className="skills-muted">禁用只阻止新的 Run，不会取消已启动的 Run；卸载和回滚都保留历史引用与审计证据。</p>
      </section>

      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>来源与快照</h3><span className="skills-status info">server snapshot</span></div><dl className="skills-detail-kv"><div><dt>来源</dt><dd>{detail.package.sourceUri || detail.package.source_uri || detail.package.sourceType || detail.package.source_type || '—'}</dd></div><div><dt>固定 ref</dt><dd>{String(snapshot.sourceCommit || snapshot.sourceRef || detail.package.sourceRef || detail.package.source_ref || '—')}</dd></div><div><dt>快照哈希</dt><dd className="skills-mono">{String(snapshot.sourceSha256 || selectedVersion?.snapshotHash || selectedVersion?.snapshot_hash || selectedVersion?.manifestHash || selectedVersion?.manifest_hash || '—')}</dd></div><div><dt>Package 路径</dt><dd className="skills-mono">{selectedVersion?.packagePath || selectedVersion?.package_path || '—'}</dd></div></dl></section>

      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>版本、文件和 Diff</h3><span className="skills-muted">当前：v{currentVersion?.version || '—'}</span></div><SkillVersionPanel versions={detail.versions} currentVersionId={currentVersionId} selectedVersionId={selectedVersion?.id} onSelect={onSelectVersion} onPreviewRollback={(version) => setVersionEditor({ action: 'rollback', target: version })} onPreviewUpdate={onCreateVersion ? (version) => setVersionEditor({ action: 'update', target: version }) : undefined} /></section>

      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>Installations</h3><span className="skills-count">{detail.installations.length}</span></div>{detail.installations.length === 0 ? <p className="skills-muted">当前 Workspace 没有 Installation。</p> : <div className="skills-installation-list">{detail.installations.map((installation) => <InstallationRow key={installation.id} installation={installation} isCurrent={installation.id === currentInstallation?.id} />)}</div>}</section>

      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>最近 Runs</h3><History size={15} /></div>{selectedRuns.length === 0 ? <p className="skills-muted">尚无 v{selectedVersion?.version || '—'} 的运行记录。</p> : <div className="skills-run-mini-list">{selectedRuns.map((run) => <button type="button" className="skills-run-mini" key={run.id} onClick={() => onOpenRun(run.id)}><span className={'skills-status ' + statusTone(run.status)}>{run.status}</span><span className="skills-center-mono">{run.id}</span><span>{formatDate(run.updatedAt)}</span><ExternalLink size={13} aria-hidden="true" /></button>)}</div>}</section>

      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>History</h3><History size={15} /></div><ol className="skills-history-list">{buildSkillHistory(detail).map((entry) => <li key={entry.id}><span className="skills-history-dot" aria-hidden="true" /><div><strong>{entry.title}</strong><p>{entry.detail}</p><small>{formatDate(entry.at)}</small></div></li>)}</ol></section>

      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>控制面删除</h3><Archive size={15} /></div><p className="skills-muted">删除默认为 soft delete。服务端会在存在 active installation 或运行中 Run 时拒绝归档；成功后仍保留版本、快照、安装历史、Run、Event、Artifact 和审计事件。</p><button type="button" className="skills-button danger" disabled={packageDeleted || busy !== null} onClick={() => void softDeletePackage}>{busy === 'delete-package' ? <LoaderCircle className="spin" size={14} /> : <Archive size={14} />}归档 Package</button></section>
      <section className="skills-detail-section"><div className="skills-detail-heading"><h3>Manifest</h3><FileCode2 size={15} /></div><pre className="skills-manifest">{JSON.stringify(manifest, null, 2)}</pre></section>
    </div>
    {versionEditor && <SkillEditor currentVersion={currentVersion || versionEditor.target} targetVersion={versionEditor.target} action={versionEditor.action} onClose={() => setVersionEditor(null)} onConfirm={() => confirmVersionAction()} />}
  </aside>
}

function InstallationRow({ installation, isCurrent }: { installation: SkillInstallation; isCurrent: boolean }) {
  const enabled = Boolean(installation.enabled === true || installation.enabled === 1)
  return <div className="skills-installation-row"><div><strong className="skills-center-mono">{installation.id}</strong><small>Version {installation.currentVersionId || installation.current_version_id || '—'} · revision {installation.revision}</small></div><div><span className={'skills-status ' + installationStatusTone(installation.status, installation.enabled)}>{isCurrent ? '当前 · ' : ''}{installationStatusLabel(installation)}</span><small>{enabled ? '接受新 Run' : '阻止新 Run'}</small></div></div>
}

function parseVersionManifest(version: SkillVersion | undefined): PackageManifest {
  const fallback: PackageManifest = { name: '', description: '', runtime: 'instruction-agent', entryPath: 'SKILL.md', compatible: true, requestedCapabilities: [], outputArtifactTypes: [], references: [], assets: [], scripts: [], unsupported: [], unknownFrontmatter: {} }
  if (!version) return fallback
  const manifest = version.manifest && typeof version.manifest === 'object' ? version.manifest : parseJson<Record<string, unknown>>(version.manifest_json, {})
  return { ...fallback, ...manifest, requestedCapabilities: Array.isArray(manifest.requestedCapabilities) ? manifest.requestedCapabilities as PackageManifest['requestedCapabilities'] : [] }
}

function parseVersionSnapshot(version: SkillVersion | undefined) {
  if (!version) return {} as Record<string, unknown>
  return version.sourceSnapshot && typeof version.sourceSnapshot === 'object' ? version.sourceSnapshot : parseJson<Record<string, unknown>>(version.source_snapshot_json, {})
}

function buildSkillHistory(detail: PackageDetail) {
  const entries = detail.versions.flatMap((version) => [{ id: `version:${version.id}`, title: `Version v${version.version} 已记录`, detail: `${version.runtime} · ${version.securityStatus || version.security_status || '安全状态未知'} · manifest ${version.manifestHash || version.manifest_hash || '—'}`, at: version.publishedAt || version.published_at || version.createdAt || version.created_at || 0 }])
  for (const installation of detail.installations) {
    entries.push({ id: `installation:${installation.id}`, title: `Installation ${installation.status || 'unknown'}`, detail: `current version ${installation.currentVersionId || installation.current_version_id || '—'} · revision ${installation.revision}`, at: installation.changedAt || installation.changed_at || installation.updatedAt || installation.updated_at || installation.installedAt || installation.installed_at || 0 })
  }
  return entries.sort((a, b) => b.at - a.at)
}

function installationStatusLabel(installation: SkillInstallation | undefined) {
  if (!installation) return '未安装'
  if (installation.status === 'uninstalled') return '已卸载'
  if (installation.status === 'deleted') return '已删除'
  return Boolean(installation.enabled === true || installation.enabled === 1) ? '已启用' : '已禁用'
}

function installationStatusTone(status: string | undefined, enabled: boolean | 0 | 1 | undefined) {
  if (status === 'uninstalled' || status === 'deleted') return 'warning'
  return Boolean(enabled === true || enabled === 1) ? 'success' : 'muted'
}

function statusTone(status: string) { if (status === 'completed') return 'success'; if (status === 'failed' || status === 'cancelled') return 'danger'; if (status.startsWith('waiting')) return 'warning'; return 'info' }
