import React from 'react'
import type { ResearchEvidenceDto } from '@shared/deepresearch/contracts'

export function selectedEvidence(evidenceById: Record<string, ResearchEvidenceDto>, evidenceId: string | null): ResearchEvidenceDto | null {
  return evidenceId ? evidenceById[evidenceId] ?? null : null
}

export function ResearchEvidencePanel({ evidenceById, selectedEvidenceId, onSelectEvidence }: { evidenceById: Record<string, ResearchEvidenceDto>; selectedEvidenceId: string | null; onSelectEvidence: (evidenceId: string | null) => void }) {
  const evidence = selectedEvidence(evidenceById, selectedEvidenceId)
  return (
    <aside className="research-evidence-panel" aria-labelledby="research-evidence-heading">
      <div className="research-section-heading"><h3 id="research-evidence-heading">证据</h3>{evidence && <button type="button" className="research-icon-button" aria-label="关闭证据面板" title="关闭证据面板" onClick={() => onSelectEvidence(null)}>×</button>}</div>
      {evidence ? <div className="research-evidence-detail" data-evidence-id={evidence.id}>
        <span className="research-status-badge" data-status={evidence.stance}>{evidence.stance}</span>
        <p>{evidence.passage}</p>
        <dl><div><dt>摘要</dt><dd>{evidence.summary}</dd></div><div><dt>置信度</dt><dd>{Math.round(evidence.confidence * 100)}%</dd></div></dl>
      </div> : <p className="research-empty">选择报告引用或下方证据，查看支撑主张的原文片段。</p>}
      <div className="research-evidence-list">
        {Object.values(evidenceById).map((item) => <button type="button" key={item.id} className="research-evidence-item" aria-pressed={item.id === selectedEvidenceId} onClick={() => onSelectEvidence(item.id)}>{item.summary}</button>)}
      </div>
    </aside>
  )
}
