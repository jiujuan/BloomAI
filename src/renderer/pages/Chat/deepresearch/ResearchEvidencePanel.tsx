import React from 'react'
import type { ResearchEvidenceDto, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { evidencePassagePreview, getEvidenceSourceContext } from './research-source-context'

export function selectedEvidence(evidenceById: Record<string, ResearchEvidenceDto>, evidenceId: string | null): ResearchEvidenceDto | null {
  return evidenceId ? evidenceById[evidenceId] ?? null : null
}

export function ResearchEvidencePanel({
  evidenceById,
  snapshotsById,
  sources,
  selectedEvidenceId,
  onSelectEvidence,
}: {
  evidenceById: Record<string, ResearchEvidenceDto>
  snapshotsById: Record<string, ResearchSourceSnapshotDto>
  sources: ResearchSourceDto[]
  selectedEvidenceId: string | null
  onSelectEvidence: (evidenceId: string | null) => void
}) {
  const evidence = selectedEvidence(evidenceById, selectedEvidenceId)
  const sourceContext = evidence ? getEvidenceSourceContext(evidence, snapshotsById, sources) : null
  return (
    <aside className="research-evidence-panel" aria-labelledby="research-evidence-heading">
      <div className="research-section-heading"><h3 id="research-evidence-heading">证据</h3>{evidence && <button type="button" className="research-icon-button" aria-label="关闭证据面板" title="关闭证据面板" onClick={() => onSelectEvidence(null)}>×</button>}</div>
      {evidence ? <div className="research-evidence-detail" data-evidence-id={evidence.id}>
        {sourceContext && <div className="research-evidence-source">
          {sourceContext.href ? <a href={sourceContext.href} target="_blank" rel="noreferrer">{sourceContext.title}</a> : <strong>{sourceContext.title}</strong>}
          {sourceContext.domain && <small>{sourceContext.domain}</small>}
        </div>}
        <span className="research-status-badge" data-status={evidence.stance}>{evidence.stance}</span>
        <p>{evidence.passage}</p>
        <dl><div><dt>摘要</dt><dd>{evidence.summary}</dd></div><div><dt>置信度</dt><dd>{Math.round(evidence.confidence * 100)}%</dd></div></dl>
      </div> : <p className="research-empty">选择报告引用或下方证据，查看支持主张的原文片段。</p>}
      <div className="research-evidence-list">
        {Object.values(evidenceById).map((item) => {
          const context = getEvidenceSourceContext(item, snapshotsById, sources)
          return <button type="button" key={item.id} className="research-evidence-item" aria-pressed={item.id === selectedEvidenceId} onClick={() => onSelectEvidence(item.id)}>
            <strong>{context.title}</strong>
            <span>{evidencePassagePreview(item)}</span>
            {context.domain && <small>{context.domain}</small>}
          </button>
        })}
      </div>
    </aside>
  )
}
