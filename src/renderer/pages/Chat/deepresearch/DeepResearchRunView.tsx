import React, { useState } from 'react'
import { Download } from 'lucide-react'
import type { ResearchArtifactDto, ResearchEventDto, ResearchEvidenceDto, ResearchQuestionDto, ResearchReportDto, ResearchRunDto, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { DEEP_RESEARCH_VIEWS, type DeepResearchLifecycle, type DeepResearchView } from './deep-research.types'
import { ResearchEvidencePanel } from './ResearchEvidencePanel'
import { ResearchProgress } from './ResearchProgress'
import { ResearchQuestionTree } from './ResearchQuestionTree'
import { ResearchReportView } from './ResearchReportView'
import { ResearchRunLifecyclePanel } from './ResearchRunLifecyclePanel'
import { ResearchSourcesPanel } from './ResearchSourcesPanel'

const VIEW_LABELS: Record<DeepResearchView, string> = { overview: '概览', questions: '问题', sources: '来源', report: '报告', evidence: '证据', activity: '活动' }

export type ResearchRunActionKind = 'cancel' | 'resume' | 'retry' | 'export'

/** Server capabilities are authoritative; lifecycle status only supplies an extra cancelled safety guard. */
export function getRunActionKinds(run: ResearchRunDto, lifecycle?: DeepResearchLifecycle): ResearchRunActionKind[] {
  const actions: ResearchRunActionKind[] = []
  const capabilities = lifecycle?.capabilities ?? run.capabilities
  if (capabilities?.canCancel) actions.push('cancel')
  if (capabilities?.canResume && run.status !== 'cancelled') actions.push('resume')
  if (capabilities?.canRetry) actions.push('retry')
  if (run.reportArtifactId) actions.push('export')
  return actions
}

export interface DeepResearchRunViewProps {
  run: ResearchRunDto
  lifecycle?: DeepResearchLifecycle
  questions: ResearchQuestionDto[]
  sources: ResearchSourceDto[]
  snapshotsById: Record<string, ResearchSourceSnapshotDto>
  report: ResearchReportDto | null
  artifacts: ResearchArtifactDto[]
  evidenceById: Record<string, ResearchEvidenceDto>
  events: ResearchEventDto[]
  selectedView: DeepResearchView
  selectedEvidenceId: string | null
  loading: boolean
  error?: string | null
  onSelectedViewChange: (view: DeepResearchView) => void
  onSelectEvidence: (evidenceId: string | null) => void
  onCancel: () => void
  onResume: () => void
  onExport: () => void
  onAnswerClarification: (clarificationId: string, answer: string) => void
}

function ClarificationForm({ run, loading, onAnswer }: { run: ResearchRunDto; loading: boolean; onAnswer: (clarificationId: string, answer: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const clarificationIds = run.brief?.criticalClarificationIds ?? []
  if (run.status !== 'awaiting_input' || clarificationIds.length === 0) return null
  return <section className="research-clarifications" aria-labelledby="research-clarifications-heading"><div className="research-section-heading"><h3 id="research-clarifications-heading">需要澄清</h3></div>{clarificationIds.map((id) => <label key={id}><span>{id}</span><div><input value={answers[id] ?? ''} onChange={(event) => setAnswers({ ...answers, [id]: event.target.value })} /><button type="button" disabled={loading || !(answers[id] ?? '').trim()} onClick={() => onAnswer(id, answers[id].trim())}>提交</button></div></label>)}</section>
}

export function DeepResearchRunView(props: DeepResearchRunViewProps) {
  const actions = getRunActionKinds(props.run, props.lifecycle)
  return (
    <section className="deep-research-run" aria-live="polite">
      <header className="deep-research-run-header">
        <div><h2>{props.run.topic}</h2><span>{VIEW_LABELS[props.selectedView]}视图</span></div>
        <div className="deep-research-run-actions">
          {actions.includes('export') && <button type="button" className="research-icon-button" aria-label="导出报告" title="导出报告" disabled={props.loading} onClick={props.onExport}><Download size={16} /></button>}
        </div>
      </header>
      {(props.error ?? props.run.error?.message) && <p className="deep-research-error" role="alert">{props.error ?? props.run.error?.message}</p>}
      <ResearchProgress run={props.run} />
      <ResearchRunLifecyclePanel run={props.run} lifecycle={props.lifecycle ?? null} loading={props.loading} onCancel={props.onCancel} onResume={props.onResume} />
      <ClarificationForm run={props.run} loading={props.loading} onAnswer={props.onAnswerClarification} />
      <nav className="deep-research-tabs" role="tablist" aria-label="研究视图">
        {DEEP_RESEARCH_VIEWS.map((view) => <button type="button" key={view} role="tab" aria-selected={props.selectedView === view} className="deep-research-tab" onClick={() => props.onSelectedViewChange(view)}>{VIEW_LABELS[view]}</button>)}
      </nav>
      <div className="deep-research-run-layout">
        <div className="deep-research-main-panel" role="tabpanel">
          {props.selectedView === 'overview' && <section className="research-section"><div className="research-section-heading"><h3>研究摘要</h3></div><p>{props.run.brief?.scope ?? '正在根据研究主题规划范围与证据要求。'}</p>{props.run.quality && <p>高优先级问题覆盖：{Math.round(props.run.quality.highPriorityQuestionCoverage * 100)}%</p>}</section>}
          {props.selectedView === 'questions' && <ResearchQuestionTree questions={props.questions} />}
          {props.selectedView === 'sources' && <ResearchSourcesPanel sources={props.sources} />}
          {props.selectedView === 'report' && <ResearchReportView report={props.report} evidenceById={props.evidenceById} snapshotsById={props.snapshotsById} sources={props.sources} artifacts={props.artifacts} onSelectEvidence={props.onSelectEvidence} />}
          {props.selectedView === 'evidence' && <ResearchEvidencePanel evidenceById={props.evidenceById} snapshotsById={props.snapshotsById} sources={props.sources} selectedEvidenceId={props.selectedEvidenceId} onSelectEvidence={props.onSelectEvidence} />}
          {props.selectedView === 'activity' && <section className="research-section" aria-labelledby="research-activity-heading"><div className="research-section-heading"><h3 id="research-activity-heading">活动</h3><span>{props.events.length} 项</span></div><ol className="research-activity-list">{props.events.map((event) => <li key={event.eventId ?? `${event.runId}:${event.sequence}`}><span>{event.sequence}</span><strong>{event.type}</strong><small>{event.phase}</small></li>)}</ol></section>}
        </div>
        {props.selectedView !== 'evidence' && <ResearchEvidencePanel evidenceById={props.evidenceById} snapshotsById={props.snapshotsById} sources={props.sources} selectedEvidenceId={props.selectedEvidenceId} onSelectEvidence={props.onSelectEvidence} />}
      </div>
    </section>
  )
}