import React from 'react'
import type { ResearchCitationDto, ResearchReportDto } from '@shared/deepresearch/contracts'

export function selectReportCitation(citation: ResearchCitationDto, onSelectEvidence: (evidenceId: string) => void) {
  onSelectEvidence(citation.evidenceId)
}

export function ResearchReportView({ report, onSelectEvidence }: { report: ResearchReportDto | null; onSelectEvidence: (evidenceId: string) => void }) {
  if (!report) return <section className="research-section"><p className="research-empty">报告完成后会在这里显示可核验正文与引用。</p></section>
  const citationsByClaim = new Map<string, ResearchCitationDto[]>()
  for (const citation of report.citations) citationsByClaim.set(citation.claimId, [...(citationsByClaim.get(citation.claimId) ?? []), citation])
  return (
    <article className="research-report" aria-labelledby="research-report-title">
      <header className="research-report-heading"><h2 id="research-report-title">{report.title}</h2><span>{report.sections.length} 节</span></header>
      {report.sections.map((section) => {
        const claims = report.claims.filter((claim) => claim.sectionId === section.id)
        return <section className="research-report-section" key={section.id}>
          <h3>{section.title}</h3>
          <p>{section.verifiedText ?? section.draft ?? '本节尚在撰写。'}</p>
          {claims.map((claim) => <p className="research-claim" key={claim.id}>
            <span>{claim.text}</span>
            {(citationsByClaim.get(claim.id) ?? []).map((citation) => <button type="button" className="research-citation" key={citation.id} aria-label={'查看证据 ' + citation.evidenceId} onClick={() => selectReportCitation(citation, onSelectEvidence)}>[{citation.ordinal}]</button>)}
          </p>)}
        </section>
      })}
    </article>
  )
}
