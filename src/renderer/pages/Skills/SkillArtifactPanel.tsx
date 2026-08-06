import React from 'react'
import { Download, FileOutput } from 'lucide-react'
import type { SkillArtifact } from './skill-runtime.types'
import { artifactContentUrl, formatDate } from './skill-runtime.types'

export function SkillArtifactPanel({ runId, artifacts, onExport }: { runId: string; artifacts: SkillArtifact[]; onExport?: (artifact: SkillArtifact) => void }) {
  return <section className="skills-center-subpanel" aria-labelledby="skills-artifact-panel-title"><div className="skills-center-subpanel-head"><div><h3 id="skills-artifact-panel-title">Artifacts</h3><p>Artifact 只读展示；导出必须再次确认目标目录并留下审计原因。</p></div><FileOutput size={15} aria-hidden="true" /></div>{artifacts.length === 0 ? <p className="skills-muted">暂无 Artifact。</p> : <div className="skills-center-artifact-list">{artifacts.map((artifact) => <div className="skills-center-artifact-row" key={artifact.id}><a href={artifactContentUrl(artifact.id, runId)} target="_blank" rel="noreferrer"><strong>{artifact.kind}</strong><small>{artifact.path} · {formatDate(artifact.createdAt)} · {formatBytes(artifact.sizeBytes)}</small></a><button type="button" className="skills-text-button" onClick={() => onExport?.(artifact)}><Download size={13} aria-hidden="true" />导出</button></div>)}</div>}</section>
}

function formatBytes(size: number) { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB` }
