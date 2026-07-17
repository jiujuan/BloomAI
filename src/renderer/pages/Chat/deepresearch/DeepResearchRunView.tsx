import React, { useState } from 'react'
import { Ban, Download, RotateCcw, Play, X } from 'lucide-react'
import type { ResearchEventDto, ResearchEvidenceDto, ResearchQuestionDto, ResearchReportDto, ResearchRunDto, ResearchSourceDto } from '@shared/deepresearch/contracts'
import { DEEP_RESEARCH_VIEWS, type DeepResearchView } from './deep-research.types'
import { ResearchEvidencePanel } from './ResearchEvidencePanel'
import { ResearchProgress } from './ResearchProgress'
import { ResearchQuestionTree } from './ResearchQuestionTree'
import { ResearchReportView } from './ResearchReportView'
import { ResearchSourcesPanel } from './ResearchSourcesPanel'

const VIEW_LABELS: Record<DeepResearchView, string> = { overview: '概览', questions: '问题', sources: '来源', report: '报告', evidence: '证据', activity: '活动' }

export type ResearchRunActionKind = 'cancel' | 'resume' | 'retry' | 'export'

export function getRunActionKinds(run: ResearchRunDto): ResearchRunActionKind[] {
  const actions: ResearchRunActionKind[] = []
  if (!['completed', 'completed_with_limitations', 'cancelled', 'failed', 'interrupted'].includes(run.status)) actions.push('cancel')
  if (['interrupted', 'cancelled'].includes(run.status)) actions.push('resume')
  if (run.status === 'failed' && run.error?.retryable) actions.push('retry')
  if (run.reportArtifactId) actions.push('export')
  return actions
}

export interface DeepResearchRunViewProps {
  run: ResearchRunDto
  questions: ResearchQuestionDto[]
  sources: ResearchSourceDto[]
  report: ResearchReportDto | null
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
  const actions = getRunActionKinds(props.run)
  return (
    <section className="deep-research-run" aria-live="polite">
      <header className="deep-research-run-header">
        <div><h2>{props.run.topic}</h2><span>{VIEW_LABELS[props.selectedView]}视图</span></div>
        <div className="deep-research-run-actions">
          {actions.includes('cancel') && <button type="button" className="research-icon-button" aria-label="取消研究" title="取消研究" disabled={props.loading} onClick={props.onCancel}><Ban size={16} /></button>}
          {actions.includes('resume') && <button type="button" className="research-icon-button" aria-label="恢复研究" title="恢复研究" disabled={props.loading} onClick={props.onResume}><Play size={16} /></button>}
          {actions.includes('retry') && <button type="button" className="research-icon-button" aria-label="重试研究" title="重试研究" disabled={props.loading} onClick={props.onResume}><RotateCcw size={16} /></button>}
          {actions.includes('export') && <button type="button" className="research-icon-button" aria-label="导出报告" title="导出报告" disabled={props.loading} onClick={props.onExport}><Download size={16} /></button>}
        </div>
      </header>
      {(props.error ?? props.run.error?.message) && <p className="deep-research-error" role="alert">{props.error ?? props.run.error?.message}</p>}
      <ResearchProgress run={props.run} />
      <ClarificationForm run={props.run} loading={props.loading} onAnswer={props.onAnswerClarification} />
      <nav className="deep-research-tabs" role="tablist" aria-label="研究视图">
        {DEEP_RESEARCH_VIEWS.map((view) => <button type="button" key={view} role="tab" aria-selected={props.selectedView === view} className="deep-research-tab" onClick={() => props.onSelectedViewChange(view)}>{VIEW_LABELS[view]}</button>)}
      </nav>
      <div className="deep-research-run-layout">
        <div className="deep-research-main-panel" role="tabpanel">
          {props.selectedView === 'overview' && <section className="research-section"><div className="research-section-heading"><h3>研究摘要</h3></div><p>{props.run.brief?.scope ?? '正在根据研究主题规划范围与证据要求。'}</p>{props.run.quality && <p>高优先级问题覆盖：{Math.round(props.run.quality.highPriorityQuestionCoverage * 100)}%</p>}</section>}
          {props.selectedView === 'questions' && <ResearchQuestionTree questions={props.questions} />}
          {props.selectedView === 'sources' && <ResearchSourcesPanel sources={props.sources} />}
          {props.selectedView === 'report' && <ResearchReportView report={props.report} onSelectEvidence={props.onSelectEvidence} />}
          {props.selectedView === 'evidence' && <ResearchEvidencePanel evidenceById={props.evidenceById} selectedEvidenceId={props.selectedEvidenceId} onSelectEvidence={props.onSelectEvidence} />}
          {props.selectedView === 'activity' && <section className="research-section" aria-labelledby="research-activity-heading"><div className="research-section-heading"><h3 id="research-activity-heading">活动</h3><span>{props.events.length} 项</span></div><ol className="research-activity-list">{props.events.map((event) => <li key={event.sequence}><span>{event.sequence}</span><strong>{event.type}</strong><small>{event.phase}</small></li>)}</ol></section>}
        </div>
        {props.selectedView !== 'evidence' && <ResearchEvidencePanel evidenceById={props.evidenceById} selectedEvidenceId={props.selectedEvidenceId} onSelectEvidence={props.onSelectEvidence} />}
      </div>
    </section>
  )
}
