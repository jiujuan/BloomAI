import React from 'react'
import { Download, ExternalLink, FileOutput } from 'lucide-react'
import type { SkillArtifact } from './skill-runtime.types'
import { artifactContentUrl, formatDate } from './skill-runtime.types'

export function ArtifactList({ runId, artifacts, onExport }: { runId: string; artifacts: SkillArtifact[]; onExport?: (artifact: SkillArtifact) => void }) {
  return <section className="skills-detail-section" aria-labelledby="artifact-list-title"><div className="skills-detail-heading"><h3 id="artifact-list-title">Artifacts</h3><FileOutput size={15} aria-hidden="true" /></div>
    {artifacts.length === 0 ? <p className="skills-muted">运行尚未产出可导出的文件。</p> : <div className="skills-artifact-list">{artifacts.map((artifact) => <ArtifactRow key={artifact.id} runId={runId} artifact={artifact} onExport={onExport} />)}</div>}
  </section>
}

function ArtifactRow({ runId, artifact, onExport }: { runId: string; artifact: SkillArtifact; onExport?: (artifact: SkillArtifact) => void }) {
  const metadata = artifact.metadata ?? {}
  const imageSessionId = typeof metadata.imageSessionId === 'string' ? metadata.imageSessionId : typeof metadata.image_session_id === 'string' ? metadata.image_session_id : null
  const preview = typeof metadata.previewText === 'string' ? metadata.previewText : typeof metadata.preview === 'string' ? metadata.preview : null
  return <article className="skills-artifact" data-artifact-kind={artifact.kind}><div className="skills-artifact-main"><a href={artifactContentUrl(artifact.id, runId)} target="_blank" rel="noreferrer"><FileOutput size={15} aria-hidden="true" /><span><strong>{artifact.kind}</strong><p>{artifact.path} · {formatBytes(artifact.sizeBytes)} · {formatDate(artifact.createdAt)}</p><small className="skills-mono">{artifact.sha256 || 'hash unavailable'}</small></span></a>{preview && <details className="skills-artifact-preview"><summary>预览</summary><pre>{preview}</pre></details>}{artifact.mimeType?.startsWith('image/') && <figure className="skills-artifact-image-preview"><img src={artifactContentUrl(artifact.id, runId)} alt={artifact.path} loading="lazy" /><figcaption>预览</figcaption></figure>}{imageSessionId && <a className="skills-text-button" href={`#image-studio/session=${encodeURIComponent(imageSessionId)}`}><ExternalLink size={13} aria-hidden="true" />打开 Image Studio</a>}</div><button type="button" className="skills-text-button" onClick={() => onExport?.(artifact)}><Download size={13} aria-hidden="true" />导出</button></article>
}

export function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
