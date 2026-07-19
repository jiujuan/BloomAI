import React, { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { platform } from '@renderer/api'
import type { ResearchArtifactDto, ResearchCitationDto, ResearchEvidenceDto, ResearchQualityDto, ResearchReportDto, ResearchRunStatus, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { getEvidenceSourceContext } from './research-source-context'
import { ResearchQualityPanel } from './ResearchQualityPanel'

export function selectReportCitation(citation: ResearchCitationDto, onSelectEvidence: (evidenceId: string) => void) {
  onSelectEvidence(citation.evidenceId)
}

function markdownTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || null
}


export function buildReportReferences(
  citations: ResearchCitationDto[],
  evidenceById: Record<string, ResearchEvidenceDto>,
  snapshotsById: Record<string, ResearchSourceSnapshotDto>,
  sources: ResearchSourceDto[],
) {
  return citations
    .map((citation) => ({ citation, evidence: evidenceById[citation.evidenceId] }))
    .map(({ citation, evidence }) => ({ citation, context: evidence ? getEvidenceSourceContext(evidence, snapshotsById, sources) : null }))
    .sort((left, right) => left.citation.ordinal - right.citation.ordinal)
}

export function ResearchReportView({
  report,
  quality,
  runStatus,
  evidenceById,
  snapshotsById,
  sources,
  artifacts,
  onSelectEvidence,
}: {
  report: ResearchReportDto | null
  quality: ResearchQualityDto | null
  runStatus: ResearchRunStatus
  evidenceById: Record<string, ResearchEvidenceDto>
  snapshotsById: Record<string, ResearchSourceSnapshotDto>
  sources: ResearchSourceDto[]
  artifacts: ResearchArtifactDto[]
  onSelectEvidence: (evidenceId: string) => void
}) {
  const chineseArtifact = artifacts.find((artifact) => artifact.type === 'report_markdown_zh_cn')
  const [language, setLanguage] = useState<'en' | 'zh'>('en')
  const [translatedMarkdown, setTranslatedMarkdown] = useState<string | null>(null)
  const [translationError, setTranslationError] = useState<string | null>(null)

  useEffect(() => {
    setTranslatedMarkdown(null)
    setTranslationError(null)
    setLanguage('en')
  }, [chineseArtifact?.id])

  useEffect(() => {
    if (!chineseArtifact && language === 'zh') setLanguage('en')
  }, [chineseArtifact, language])

  useEffect(() => {
    if (language !== 'zh' || !chineseArtifact || translatedMarkdown !== null || translationError) return
    let active = true
    void fetch(platform.deepResearch.artifactUrl(chineseArtifact.runId, chineseArtifact.id))
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取中文报告。')
        return response.text()
      })
      .then((content) => { if (active) setTranslatedMarkdown(content) })
      .catch((error: unknown) => { if (active) setTranslationError(error instanceof Error ? error.message : '无法读取中文报告。') })
    return () => { active = false }
  }, [chineseArtifact, language, translatedMarkdown, translationError])

  const citationsByClaim = useMemo(() => {
    const byClaim = new Map<string, ResearchCitationDto[]>()
    for (const citation of report?.citations ?? []) byClaim.set(citation.claimId, [...(byClaim.get(citation.claimId) ?? []), citation])
    return byClaim
  }, [report])

  if (!report) return <section className="research-section"><p className="research-empty">报告完成后会在这里显示可核验正文与引用。</p></section>

  const references = buildReportReferences(report.citations, evidenceById, snapshotsById, sources)
  const displayTitle = language === 'zh' && translatedMarkdown ? (markdownTitle(translatedMarkdown) ?? report.title) : report.title

  return (
    <article className="research-report" aria-labelledby="research-report-title">
      <header className="research-report-heading">
        <div><h2 id="research-report-title">{displayTitle}</h2><span>{report.sections.length} 节</span></div>
        {chineseArtifact && <div className="research-report-language-tabs" role="tablist" aria-label="报告语言">
          <button type="button" role="tab" aria-selected={language === 'zh'} className="research-report-language-tab" onClick={() => setLanguage('zh')}>中 CN</button>
          <button type="button" role="tab" aria-selected={language === 'en'} className="research-report-language-tab" onClick={() => setLanguage('en')}>英 EN</button>
        </div>}
      </header>
      <ResearchQualityPanel quality={quality} runStatus={runStatus} />
      {language === 'zh' ? (
        translatedMarkdown ? <div className="research-translated-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{translatedMarkdown}</ReactMarkdown></div>
          : <p className="research-empty" role="status">{translationError ?? '正在加载中文报告…'}</p>
      ) : <>
        {report.sections.map((section) => {
          const claims = report.claims.filter((claim) => claim.sectionId === section.id)
          return <section className="research-report-section" key={section.id}>
            <h3>{section.title}</h3>
            <p>{section.verifiedText ?? section.draft ?? '本节尚在撰写。'}</p>
            {claims.map((claim) => <p className="research-claim" key={claim.id}>
              <span>{claim.text}</span>
              {(citationsByClaim.get(claim.id) ?? []).map((citation) => {
                const evidence = evidenceById[citation.evidenceId]
                const context = evidence ? getEvidenceSourceContext(evidence, snapshotsById, sources) : null
                return <button type="button" className="research-citation" key={citation.id} aria-label={'查看证据 ' + citation.evidenceId} title={context?.title ?? '查看证据'} onClick={() => selectReportCitation(citation, onSelectEvidence)}>[{citation.ordinal}]</button>
              })}
            </p>)}
          </section>
        })}
      </>}
      {references.length > 0 && <section className="research-report-references" aria-labelledby="research-report-references-title">
        <h3 id="research-report-references-title">引用来源</h3>
        <ol>
          {references.map(({ citation, context }) => <li key={citation.id}>
            <button type="button" className="research-citation" aria-label={'查看证据 ' + citation.evidenceId} onClick={() => selectReportCitation(citation, onSelectEvidence)}>[{citation.ordinal}]</button>
            {context?.href ? <a href={context.href} target="_blank" rel="noreferrer">{context.title}</a> : <span>{context?.title ?? '未解析来源'}</span>}
            {context?.domain && <small>{context.domain}</small>}
          </li>)}
        </ol>
      </section>}
    </article>
  )
}
