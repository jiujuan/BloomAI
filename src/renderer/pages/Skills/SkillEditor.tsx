import React from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, X } from 'lucide-react'
import type { SkillVersion } from './skill-runtime.types'
import { buildSkillVersionDiff } from './SkillVersionPanel'

export type VersionImpactAction = 'update' | 'rollback'
export type VersionImpactSummary = {
  actionLabel: string
  impact: string
  risk: string
  requiresConfirmation: true
}

export function getVersionImpactSummary(currentVersion: SkillVersion, targetVersion: SkillVersion, action: VersionImpactAction): VersionImpactSummary {
  if (action === 'rollback') return {
    actionLabel: '回滚',
    impact: `Installation 将从 v${currentVersion.version} 切换到历史版本 v${targetVersion.version}；现有 Run、Event 和 Artifact 仍引用原始 Version。`,
    risk: `当前版本 v${currentVersion.version} 不会删除；回滚目标的 Capability、Runtime 兼容性和安全状态必须重新确认。`,
    requiresConfirmation: true,
  }
  return {
    actionLabel: '更新',
    impact: `将以 v${currentVersion.version} 为基线创建新的 Package Version；发布后由 server 决定是否更新当前 Installation 指针。`,
    risk: `当前版本 v${currentVersion.version} 和历史审计记录会保留；新版本的文件、Capability scope 和安全扫描结果未通过前不能启用。`,
    requiresConfirmation: true,
  }
}

type SkillEditorProps = {
  currentVersion: SkillVersion
  targetVersion: SkillVersion
  action?: VersionImpactAction
  onClose: () => void
  onConfirm?: () => void | Promise<void>
}

/** Package Runtime version update/rollback preview. This replaces the old Legacy Skill creator entry. */
export function SkillEditor({ currentVersion, targetVersion, action = 'update', onClose, onConfirm }: SkillEditorProps) {
  const summary = getVersionImpactSummary(currentVersion, targetVersion, action)
  const diff = buildSkillVersionDiff(currentVersion, targetVersion)
  return <div className="editor-overlay" role="presentation" onClick={onClose}>
    <section className="skill-editor-modal skills-version-editor" role="dialog" aria-modal="true" aria-labelledby="skill-version-editor-title" onClick={(event) => event.stopPropagation()}>
      <div className="editor-head"><div><span className="editor-title" id="skill-version-editor-title">Package Version {summary.actionLabel}预览</span><small className="skills-muted">Package Runtime · server snapshot</small></div><button type="button" className="editor-close" onClick={onClose} aria-label="关闭版本预览" title="关闭版本预览"><X size={14} /></button></div>
      <div className="editor-body">
        <div className="skills-version-transition"><span>当前 v{currentVersion.version}</span><ArrowRight size={15} aria-hidden="true" /><strong>{action === 'rollback' ? '目标' : '基线'} v{targetVersion.version}</strong></div>
        <div className="skills-message warning"><AlertTriangle size={15} aria-hidden="true" /><div><strong>危险操作确认</strong><p>{summary.impact}</p></div></div>
        <dl className="skills-detail-kv"><div><dt>影响</dt><dd>{summary.impact}</dd></div><div><dt>风险</dt><dd>{summary.risk}</dd></div><div><dt>文件 Diff</dt><dd>新增 {diff.added.length} · 删除 {diff.removed.length} · 变更 {diff.changed.length}</dd></div><div><dt>可追溯性</dt><dd>当前 Version、历史 Version、Installation revision 和审计记录都会保留。</dd></div></dl>
        <div className="skills-message success"><CheckCircle2 size={15} aria-hidden="true" />服务端仍会重新校验 revision、兼容性、安全状态和 Capability policy。</div>
      </div>
      <div className="editor-foot"><button type="button" className="editor-btn" onClick={onClose}>取消</button><button type="button" className="editor-btn primary" onClick={() => void onConfirm?.()}>{action === 'rollback' ? '继续回滚确认' : '创建更新 Draft'}</button></div>
    </section>
  </div>
}
