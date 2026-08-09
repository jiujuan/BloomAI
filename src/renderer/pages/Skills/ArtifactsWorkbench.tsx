import React, { useMemo, useState } from 'react'
import { Download, FileOutput, Search, ShieldCheck } from 'lucide-react'
import type { SkillArtifact } from './skill-runtime.types'
import { artifactContentUrl, formatDate } from './skill-runtime.types'
import { ArtifactSecurityBadge, getArtifactPreviewText, getArtifactSecurityView } from './ArtifactList'

export type ArtifactExplorerRecord = { artifact: SkillArtifact; skillLabel?: string }

type ArtifactsWorkbenchProps = {
  records: ArtifactExplorerRecord[]
  loading?: boolean
  error?: string | null
  onOpenRun: (runId: string) => void
  onExport?: (artifact: SkillArtifact) => void
}

export function ArtifactsWorkbench({ records, loading = false, error = null, onOpenRun, onExport }: ArtifactsWorkbenchProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => records.filter(({ artifact, skillLabel }) => !normalizedQuery || [artifact.id, artifact.runId, artifact.kind, artifact.path, skillLabel].some((value) => String(value || '').toLowerCase().includes(normalizedQuery))), [normalizedQuery, records])
  return <section className="skills-center-panel skills-artifacts-workbench" aria-labelledby="skills-artifacts-workbench-title">
    <div className="skills-center-panel-head"><div><div className="skills-eyebrow"><FileOutput size={14} aria-hidden="true" /> Output / Audit</div><h2 id="skills-artifacts-workbench-title">Artifacts</h2><p>浏览所有 Run 产物；每个 Artifact 都保留来源 Skill、Run ID、安全扫描状态和导出审计入口。</p></div><span className="skills-status info"><ShieldCheck size={12} aria-hidden="true" />{filtered.length} / {records.length}</span></div>
    <label className="skills-filter-field skills-artifact-search"><span>搜索 Artifact</span><span className="skills-filter-input"><Search size={13} aria-hidden="true" /><input aria-label="搜索 Artifact、Skill 或 Run" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Artifact、Skill、Run ID" /></span></label>
    {error && <div className="skills-message error" role="alert">{error}</div>}
    {loading && <div className="skills-center-state" role="status">正在加载 Artifacts…</div>}
    {!loading && filtered.length === 0 && <div className="skills-center-state"><FileOutput size={17} aria-hidden="true" /><div><strong>暂无 Artifact</strong><p>完成一个 Package Run 后，产物会在这里显示。</p></div></div>}
    {!loading && filtered.length > 0 && <div className="skills-table-scroll" tabIndex={0} aria-label="Artifacts 表格，可横向滚动"><table className="skills-data-table skills-artifact-table"><caption className="skills-sr-only">Skill Runtime Artifacts</caption><thead><tr><th scope="col">Artifact</th><th scope="col">来源 Skill</th><th scope="col">Run ID</th><th scope="col">创建时间</th><th scope="col">大小</th><th scope="col">安全状态</th><th scope="col">操作</th></tr></thead><tbody>{filtered.map(({ artifact, skillLabel }) => <ArtifactExplorerRow key={artifact.id} artifact={artifact} skillLabel={skillLabel} onOpenRun={onOpenRun} onExport={onExport} />)}</tbody></table></div>}
  </section>
}

function ArtifactExplorerRow({ artifact, skillLabel, onOpenRun, onExport }: { artifact: SkillArtifact; skillLabel?: string; onOpenRun: (runId: string) => void; onExport?: (artifact: SkillArtifact) => void }) {
  const preview = getArtifactPreviewText(artifact)
  const security = getArtifactSecurityView(artifact)
  return <tr data-artifact-id={artifact.id}><td><a className="skills-artifact-link" href={artifactContentUrl(artifact.id, artifact.runId)} target="_blank" rel="noreferrer"><FileOutput size={14} aria-hidden="true" /><span><strong>{artifact.kind}</strong><small>{artifact.path}</small></span></a>{preview && <details className="skills-artifact-table-preview"><summary>预览</summary><pre>{preview}</pre></details>}</td><td>{skillLabel || 'Package Runtime'}</td><td className="skills-center-mono">{artifact.runId}</td><td><time dateTime={new Date(artifact.createdAt).toISOString()}>{formatDate(artifact.createdAt)}</time></td><td>{formatBytes(artifact.sizeBytes)}</td><td><ArtifactSecurityBadge artifact={artifact} /><span className="skills-sr-only">{security.label}</span></td><td><div className="skills-table-actions"><button type="button" className="skills-button" onClick={() => onOpenRun(artifact.runId)} aria-label={`查看 Run ${artifact.runId}`}><FileOutput size={13} aria-hidden="true" />查看 Run</button><button type="button" className="skills-button" onClick={() => onExport?.(artifact)} aria-label={`导出 Artifact ${artifact.kind}`}><Download size={13} aria-hidden="true" />导出</button></div></td></tr>
}

function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
