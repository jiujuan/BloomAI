import React from 'react'
import { GitCompare, ShieldCheck } from 'lucide-react'
import type { SkillVersion } from './skill-runtime.types'
import { formatDate } from './skill-runtime.types'

export function SkillVersionPanel({ versions, currentVersionId, onSelect }: { versions: SkillVersion[]; currentVersionId?: string; onSelect?: (version: SkillVersion) => void }) {
  return <section className="skills-center-subpanel" aria-labelledby="skills-version-panel-title"><div className="skills-center-subpanel-head"><div><h3 id="skills-version-panel-title">Versions / Diff</h3><p>版本快照不可变；回滚只切换安装指针，不删除历史记录。</p></div><GitCompare size={15} aria-hidden="true" /></div>{versions.length === 0 ? <p className="skills-muted">尚无版本记录。</p> : <div className="skills-center-version-list">{versions.map((version) => <button type="button" key={version.id} className={'skills-center-version-row ' + (version.id === currentVersionId ? 'selected' : '')} onClick={() => onSelect?.(version)}><span><strong>v{version.version}</strong><small>{formatDate(version.publishedAt || version.createdAt)} · {version.runtime}</small></span><span><span className={'skills-status ' + (version.isCompatible ? 'success' : 'danger')}>{version.isCompatible ? '兼容' : '不兼容'}</span><small className="skills-center-mono">{version.manifestHash.slice(0, 10)}</small></span></button>)}</div>}<div className="skills-center-inline-note"><ShieldCheck size={14} aria-hidden="true" /> Manifest、source SHA 和安全状态来自 server snapshot。</div></section>
}
