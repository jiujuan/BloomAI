import React from 'react'
import { Download, ExternalLink, FileOutput, Image as ImageIcon, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SkillArtifact } from './skill-runtime.types'
import { artifactContentUrl, formatDate } from './skill-runtime.types'

export type ArtifactSecurityView = { label: string; tone: 'success' | 'warning' | 'danger' | 'muted'; icon: LucideIcon }

export function getArtifactSecurityView(artifact: SkillArtifact): ArtifactSecurityView {
  const metadata = artifact.metadata ?? {}
  const raw = metadata.securityStatus ?? metadata.security_status ?? metadata.scanStatus ?? metadata.scan_status ?? metadata.security
  const status = String(raw ?? '').toLowerCase()
  if (['passed', 'pass', 'clean', 'approved', 'safe'].includes(status)) return { label: '扫描通过', tone: 'success', icon: ShieldCheck }
  if (['scanning', 'pending', 'queued', 'in_progress'].includes(status)) return { label: '扫描中', tone: 'warning', icon: ShieldQuestion }
  if (['failed', 'error', 'rejected', 'quarantined', 'blocked', 'danger'].includes(status)) return { label: '需关注', tone: 'danger', icon: ShieldAlert }
  return { label: '未扫描', tone: 'muted', icon: ShieldQuestion }
}

export function getArtifactPreviewText(artifact: SkillArtifact): string | null {
  const metadata = artifact.metadata ?? {}
  const preview = metadata.previewText ?? metadata.preview_text ?? metadata.preview
  return typeof preview === 'string' && preview.trim() ? preview : null
}

export function ArtifactSecurityBadge({ artifact }: { artifact: SkillArtifact }) {
  const view = getArtifactSecurityView(artifact)
  const Icon = view.icon
  return <span className={`skills-status skills-security-badge ${view.tone}`} data-security-status={view.label}><Icon size={12} aria-hidden="true" />{view.label}</span>
}

export function ArtifactList({ runId, skillLabel, artifacts, onExport }: { runId: string; skillLabel?: string; artifacts: SkillArtifact[]; onExport?: (artifact: SkillArtifact) => void }) {
  return <section className="skills-detail-section" aria-labelledby="artifact-list-title"><div className="skills-detail-heading"><div><h3 id="artifact-list-title">Artifacts</h3><p className="skills-muted">来源、Run、创建时间、大小和安全扫描状态均来自 Runtime 记录。</p></div><FileOutput size={15} aria-hidden="true" /></div>
    {artifacts.length === 0 ? <p className="skills-muted">运行尚未产出可导出的文件。</p> : <div className="skills-artifact-list">{artifacts.map((artifact) => <ArtifactRow key={artifact.id} runId={runId} skillLabel={skillLabel} artifact={artifact} onExport={onExport} />)}</div>}
  </section>
}

export function ArtifactRow({ runId, skillLabel, artifact, onExport, compact = false }: { runId: string; skillLabel?: string; artifact: SkillArtifact; onExport?: (artifact: SkillArtifact) => void; compact?: boolean }) {
  const metadata = artifact.metadata ?? {}
  const imageSessionId = typeof metadata.imageSessionId === 'string' ? metadata.imageSessionId : typeof metadata.image_session_id === 'string' ? metadata.image_session_id : null
  const preview = getArtifactPreviewText(artifact)
  const sourceSkill = skillLabel || firstString(metadata.sourceSkill, metadata.source_skill, metadata.skillName, metadata.skill_name) || 'Package Runtime'
  const previewUrl = artifactContentUrl(artifact.id, runId)
  return <article className={`skills-artifact ${compact ? 'compact' : ''}`} data-artifact-kind={artifact.kind} data-artifact-id={artifact.id}>
    <div className="skills-artifact-main"><a href={previewUrl} target="_blank" rel="noreferrer"><FileOutput size={15} aria-hidden="true" /><span><strong>{artifact.kind}</strong><p>{artifact.path} · {formatBytes(artifact.sizeBytes)}</p></span></a>
      <dl className="skills-artifact-kv"><div><dt>来源 Skill</dt><dd>{sourceSkill}</dd></div><div><dt>Run ID</dt><dd className="skills-mono">{runId}</dd></div><div><dt>创建时间</dt><dd>{formatDate(artifact.createdAt)}</dd></div><div><dt>大小</dt><dd>{formatBytes(artifact.sizeBytes)}</dd></div></dl>
      <div className="skills-artifact-meta-row"><span className="skills-mono">{artifact.sha256 || 'hash unavailable'}</span><ArtifactSecurityBadge artifact={artifact} /></div>
      {preview && <details className="skills-artifact-preview"><summary>预览</summary><pre>{preview}</pre></details>}
      {artifact.mimeType?.startsWith('image/') && <figure className="skills-artifact-image-preview"><img src={previewUrl} alt={`${sourceSkill} Artifact ${artifact.path}`} loading="lazy" /><figcaption><ImageIcon size={12} aria-hidden="true" />图片预览</figcaption></figure>}
      {imageSessionId && <a className="skills-text-button" href={`#image-studio/session=${encodeURIComponent(imageSessionId)}`}><ExternalLink size={13} aria-hidden="true" />打开 Image Studio</a>}
    </div>
    <button type="button" className="skills-button" onClick={() => onExport?.(artifact)} aria-label={`导出 Artifact ${artifact.kind}`} title="导出 Artifact"><Download size={13} aria-hidden="true" />导出</button>
  </article>
}

export function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
function firstString(...values: unknown[]) { return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? null }
