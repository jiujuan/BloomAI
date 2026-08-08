import React from 'react'
import { RotateCcw, Settings2, Trash2 } from 'lucide-react'
import type { SkillInstallation, SkillVersion } from './skill-runtime.types'
import { formatDate } from './skill-runtime.types'

export type InstallationState = 'active' | 'disabled' | 'installing' | 'uninstalling' | 'uninstalled' | 'deleted' | 'unknown'

export function getInstallationState(installation: SkillInstallation): InstallationState {
  const status = String(installation.status || '').toLowerCase()
  if (installation.deletedAt != null || installation.deleted_at != null || status === 'deleted') return 'deleted'
  if (installation.uninstalledAt != null || installation.uninstalled_at != null || status === 'uninstalled') return 'uninstalled'
  if (status === 'uninstalling') return 'uninstalling'
  if (status === 'installing' || status === 'pending') return 'installing'
  if (installation.enabled === false || installation.enabled === 0 || status === 'disabled') return 'disabled'
  if (installation.enabled === true || installation.enabled === 1 || status === 'active' || status === 'enabled') return 'active'
  return 'unknown'
}

export function installationStateLabel(state: InstallationState) {
  return { active: '已启用', disabled: '已禁用', installing: '安装中', uninstalling: '卸载中', uninstalled: '已卸载', deleted: '已删除', unknown: '未知' }[state]
}

export function installationStateTone(state: InstallationState) {
  if (state === 'active') return 'success'
  if (state === 'disabled' || state === 'unknown') return 'muted'
  if (state === 'installing' || state === 'uninstalling') return 'warning'
  return 'danger'
}

type SkillInstallationPanelProps = {
  installations: SkillInstallation[]
  versions: SkillVersion[]
  readOnly?: boolean
  busyInstallationIds?: Record<string, boolean>
  onToggle?: (installation: SkillInstallation, enabled: boolean) => void
  onRollback?: (installation: SkillInstallation, versionId?: string) => void
  onUninstall?: (installation: SkillInstallation) => void
}

export function SkillInstallationPanel({ installations, versions, readOnly = false, busyInstallationIds = {}, onToggle, onRollback, onUninstall }: SkillInstallationPanelProps) {
  const versionById = new Map(versions.map((version) => [version.id, version]))
  return <section className="skills-center-subpanel skills-installation-panel" aria-labelledby="skills-installation-panel-title">
    <div className="skills-center-subpanel-head"><div><h3 id="skills-installation-panel-title">Installations</h3><p>Installation 状态、当前版本、revision 和危险操作都由 Package Runtime server truth 驱动。</p></div><Settings2 size={15} aria-hidden="true" /></div>
    {readOnly && <div className="skills-message info">当前操作者只能查看允许范围，不能启用、禁用、回滚或卸载 Installation。</div>}
    {installations.length === 0 ? <div className="skills-empty-state"><strong>暂无 Installation</strong><p>Package 尚未安装，或当前上下文没有可查看的 Installation。</p></div> : <div className="skills-installation-list">
      {installations.map((installation) => {
        const state = getInstallationState(installation)
        const busy = Boolean(busyInstallationIds[installation.id])
        const currentVersionId = installation.currentVersionId || installation.current_version_id || ''
        const currentVersion = versionById.get(currentVersionId)
        const previousVersionId = installation.previousVersionId ?? installation.previous_version_id ?? undefined
        const rollbackVersionId = previousVersionId || versions.find((version) => version.id !== currentVersionId)?.id
        const canMutate = !readOnly && !busy && ['active', 'disabled'].includes(state)
        return <article className="skills-installation-card" key={installation.id} data-installation-id={installation.id}>
          <div className="skills-installation-card-head"><div><strong>{currentVersion ? `v${currentVersion.version}` : currentVersionId || '未选择版本'}</strong><small>Installation ID：{installation.id}</small><small>Package ID：{installation.packageId || installation.package_id || '—'}</small></div><span className={`skills-status ${installationStateTone(state)}`}>{installationStateLabel(state)}</span></div>
          <dl className="skills-detail-kv"><div><dt>当前 Version</dt><dd>{currentVersion ? `${currentVersion.version} · ${currentVersion.id}` : currentVersionId || '—'}</dd></div><div><dt>revision</dt><dd>revision {installation.revision}</dd></div><div><dt>updatedAt</dt><dd>{formatDate(installation.updatedAt ?? installation.updated_at)}</dd></div>{previousVersionId && <div><dt>previous Version</dt><dd>{versionById.get(previousVersionId)?.version || previousVersionId}</dd></div>}{installation.rollbackReason && <div><dt>rollback reason</dt><dd>{installation.rollbackReason}</dd></div>}</dl>
          {!readOnly && <div className="skills-installation-actions">
            {state === 'active' && <button type="button" className="skills-button" disabled={!canMutate} aria-label="禁用 Installation" title="禁用 Installation" onClick={() => onToggle?.(installation, false)}>{busy ? '处理中…' : '禁用 Installation'}</button>}
            {state === 'disabled' && <button type="button" className="skills-button primary" disabled={!canMutate} aria-label="启用 Installation" title="启用 Installation" onClick={() => onToggle?.(installation, true)}>{busy ? '处理中…' : '启用 Installation'}</button>}
            {rollbackVersionId && <button type="button" className="skills-button" disabled={!canMutate} aria-label="回滚 Installation" title={`回滚 Installation 到 ${versionById.get(rollbackVersionId)?.version || rollbackVersionId}`} onClick={() => onRollback?.(installation, rollbackVersionId)}><RotateCcw size={13} aria-hidden="true" />回滚</button>}
            <button type="button" className="skills-button danger" disabled={!canMutate} aria-label="卸载 Installation" title="卸载 Installation" onClick={() => onUninstall?.(installation)}><Trash2 size={13} aria-hidden="true" />卸载 Installation</button>
          </div>}
        </article>
      })}
    </div>}
  </section>
}
