import React from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { DraftPreview, DraftValidation } from './skill-runtime.types'

type SkillCreatorPublishDialogProps = {
  preview: DraftPreview | null
  validation: DraftValidation | null
  enabled: boolean
  busy?: boolean
  onClose: () => void
  onPublish: (input: { enable?: boolean }) => void
}

export function SkillCreatorPublishDialog({ preview, validation, enabled, busy = false, onClose, onPublish }: SkillCreatorPublishDialogProps) {
  const allowed = enabled && Boolean(validation?.valid && preview?.validation.valid && preview.draft) && !busy
  if (!preview) return null
  const publish = () => {
    if (!allowed) return
    if (typeof window !== 'undefined' && !window.confirm('确认发布 immutable SkillVersion？发布会记录 capability 审批需求和 source hash，不能修改已发布版本。')) return
    onPublish({ enable: false })
  }
  return <div className="skills-modal-backdrop" role="presentation"><section className="skills-modal" role="dialog" aria-modal="true" aria-labelledby="creator-publish-title">
    <header className="skills-modal-head"><div><div className="skills-eyebrow"><AlertTriangle size={14} /> Publish</div><h2 id="creator-publish-title">发布 Creator Draft</h2></div><button type="button" className="skills-icon-button" aria-label="关闭发布窗口" onClick={onClose}><X size={16} /></button></header>
    <div className="skills-modal-body"><p>发布前请确认 immutable version、source hash 和 capability 风险。发布后版本快照不可编辑。</p><dl className="skills-compact-kv"><div><dt>Version</dt><dd>{preview.immutableVersion ? `v${preview.immutableVersion.version}` : '待服务端生成'}</dd></div><div><dt>Source hash</dt><dd>{preview.immutableVersion?.sourceHash || '待服务端生成'}</dd></div><div><dt>Capability risks</dt><dd>{preview.capabilityRisks?.length || 0} 项，需按审批策略处理</dd></div></dl>{!enabled && <div className="skills-message warning">Publish feature flag 已关闭。</div>}{!validation?.valid && <div className="skills-message error">Validation 未通过，不能发布。</div>}</div>
    <footer className="skills-modal-foot"><button type="button" className="skills-button secondary" onClick={onClose}>取消</button><button type="button" className="skills-button primary" disabled={!allowed} onClick={publish}>{busy ? '发布中…' : '确认 Publish'}</button></footer>
  </section></div>
}
