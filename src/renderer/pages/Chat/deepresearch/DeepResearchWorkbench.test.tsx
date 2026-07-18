import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ResearchEventDto, ResearchEvidenceDto, ResearchReportDto, ResearchRunDto, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { DeepResearchLauncher, isResearchDraftValid, RESEARCH_DEPTH_OPTIONS, RESEARCH_PROFILE_OPTIONS } from './DeepResearchLauncher'
import { DeepResearchRunView, getRunActionKinds } from './DeepResearchRunView'
import { ResearchProgress } from './ResearchProgress'
import { questionCoveragePercent } from './ResearchQuestionTree'
import { filterResearchSources } from './ResearchSourcesPanel'
import { selectReportCitation } from './ResearchReportView'
import { selectedEvidence } from './ResearchEvidencePanel'

const run: ResearchRunDto = {
  id: 'run-1', sessionId: 'session-1', topic: 'Enterprise AI assistant market', profile: 'market', depth: 'deep',
  status: 'researching', phase: 'researching', progress: 42, brief: null, workflowRunId: null,
  budget: { maxQuestions: 12, maxIterations: 4, maxSearchQueries: 20, maxNormalizedSources: 30, maxFetchedSources: 20, searchConcurrency: 2, fetchConcurrency: 2, maxDurationMs: 60_000 },
  usage: { questions: 2, iterations: 1, searchQueries: 4, normalizedSources: 5, fetchedSources: 4, tokens: 0, providerCostUsd: 0, startedAt: 1, deadlineAt: 60_001 },
  quality: null, reportArtifactId: 'artifact-1', resumePhase: null, error: null, createdAt: 1, updatedAt: 2, completedAt: null,
}

const sources: ResearchSourceDto[] = [
  { id: 'selected', runId: 'run-1', canonicalUrl: 'https://selected.example', domain: 'selected.example', title: 'Selected source', author: null, publisher: null, publishedAt: null, sourceType: 'web', selectionStatus: 'selected', scores: {} },
  { id: 'rejected', runId: 'run-1', canonicalUrl: 'https://rejected.example', domain: 'rejected.example', title: 'Rejected source', author: null, publisher: null, publishedAt: null, sourceType: 'web', selectionStatus: 'rejected', scores: {} },
]

const evidence: ResearchEvidenceDto = { id: 'evidence-1', runId: 'run-1', questionId: 'question-1', snapshotId: 'snapshot-1', passage: 'The market is expanding.', summary: 'Market expansion', stance: 'supporting', confidence: 0.91, startOffset: 0, endOffset: 24 }
const snapshotsById: Record<string, ResearchSourceSnapshotDto> = {
  'snapshot-1': { id: 'snapshot-1', runId: 'run-1', sourceId: 'selected', contentHash: 'hash', content: evidence.passage, metadata: {}, fetchedAt: 2, parserVersion: 'test', finalUrl: 'https://selected.example/article', httpStatus: 200 },
}
const report: ResearchReportDto = {
  runId: 'run-1', title: 'Market report', generatedAt: 2,
  sections: [{ id: 'section-1', runId: 'run-1', ordinal: 1, title: 'Market', purpose: 'Size', draft: 'Draft', verifiedText: 'Verified market analysis.', status: 'verified' }],
  claims: [{ id: 'claim-1', runId: 'run-1', sectionId: 'section-1', text: 'The market is expanding.', kind: 'factual', importance: 'high', verificationStatus: 'supported', confidence: 0.91, repairHistory: [] }],
  citations: [{ id: 'citation-1', runId: 'run-1', claimId: 'claim-1', evidenceId: 'evidence-1', entailmentStatus: 'supported', rationale: 'Direct support', ordinal: 1 }],
}

const events: ResearchEventDto[] = [{ runId: 'run-1', sequence: 1, type: 'research.evidence.extracted', phase: 'researching', timestamp: 2, payload: { count: 1 } }]

describe('Deep Research workbench', () => {
  it('renders four Profile controls, three Depth controls, and blocks an empty topic', () => {
    const markup = renderToStaticMarkup(<DeepResearchLauncher draft={{ topic: '', profile: 'general', depth: 'standard' }} loading={false} error={null} onDraftChange={() => {}} onStart={() => {}} />)

    expect(RESEARCH_PROFILE_OPTIONS).toHaveLength(4)
    expect(RESEARCH_DEPTH_OPTIONS).toHaveLength(3)
    expect(markup).toContain('市场研究')
    expect(markup).toContain('竞品研究')
    expect(markup).toContain('学术研究')
    expect(markup).toContain('深入')
    expect(markup).toContain('disabled')
    expect(isResearchDraftValid({ topic: 'AI research', profile: 'general', depth: 'standard' })).toBe(true)
    expect(isResearchDraftValid({ topic: '   ', profile: 'general', depth: 'standard' })).toBe(false)
  })

  it('shows progress and question coverage with stable operational details', () => {
    const markup = renderToStaticMarkup(<ResearchProgress run={run} />)
    expect(markup).toContain('42%')
    expect(markup).toContain('<dt>已检索</dt><dd>4</dd>')
    expect(questionCoveragePercent({ questionId: 'question-1', score: 0.76, independentDomainCount: 2, evidenceCategories: [], primarySourceCount: 1, recentSourceCount: 1, supportingEvidenceCount: 2, contradictingEvidenceCount: 0, hasSingleSourceDependency: false, gaps: [] })).toBe(76)
  })

  it('keeps selected and rejected source views distinct', () => {
    expect(filterResearchSources(sources, 'selected').map((source) => source.id)).toEqual(['selected'])
    expect(filterResearchSources(sources, 'rejected').map((source) => source.id)).toEqual(['rejected'])
  })

  it('maps a report citation to the selected evidence drawer', () => {
    const selectEvidence = vi.fn()
    selectReportCitation(report.citations[0], selectEvidence)

    expect(selectEvidence).toHaveBeenCalledWith('evidence-1')
    expect(selectedEvidence({ 'evidence-1': evidence }, 'evidence-1')).toEqual(evidence)
  })

  it('renders clarification, cancel, resume, retry, export, and report evidence controls', () => {
    const clarificationRun: ResearchRunDto = { ...run, status: 'awaiting_input', brief: { title: 'Brief', objective: null, audience: null, scope: 'US', assumptions: [], plannedSections: [], criticalClarificationIds: ['scope'] } }
    const markup = renderToStaticMarkup(<DeepResearchRunView
      run={clarificationRun}
      lifecycle={{ currentAttempt: { id: 'attempt-1', ordinal: 1, trigger: 'initial', status: 'running', startCheckpointKey: null, endCheckpointKey: null, error: null, startedAt: 1, endedAt: null, createdAt: 1 }, resumeCheckpoint: null, assessment: null, attemptHistory: { items: [], nextCursor: null }, iterationHistory: { items: [], nextCursor: null }, budget: { limit: run.budget, usage: run.usage }, stopReason: null, limitations: [], cancellation: null, capabilities: { canCancel: true, canResume: false, canRetry: false, canProvideClarification: false } }}
      questions={[{ id: 'question-1', runId: 'run-1', parentQuestionId: null, ordinal: 1, question: 'What is the market size?', intent: 'market size', requiredEvidenceTypes: ['primary'], priority: 'high', status: 'covered', coverage: { questionId: 'question-1', score: 0.76, independentDomainCount: 2, evidenceCategories: [], primarySourceCount: 1, recentSourceCount: 1, supportingEvidenceCount: 2, contradictingEvidenceCount: 0, hasSingleSourceDependency: false, gaps: [] } }]}
      sources={sources}
      snapshotsById={snapshotsById}
      report={report}
      artifacts={[{ id: 'artifact-zh', runId: 'run-1', type: 'report_markdown_zh_cn', fileName: 'report.zh-CN.md', contentType: 'text/markdown', sizeBytes: 42, createdAt: 2 }]}
      evidenceById={{ 'evidence-1': evidence }}
      events={events}
      selectedView="report"
      selectedEvidenceId="evidence-1"
      onSelectedViewChange={() => {}}
      onSelectEvidence={() => {}}
      onCancel={() => {}}
      onResume={() => {}}
      onExport={() => {}}
      onAnswerClarification={() => {}}
      loading={false}
    />)

    expect(markup).toContain('需要澄清')
    expect(markup).toContain('研究生命周期')
    expect(markup).toContain('取消研究')
    expect(markup).toContain('aria-label="导出报告"')
    expect(markup).toContain('aria-label="查看证据 evidence-1"')
    expect(markup).toContain('Selected source')
    expect(markup).toContain('href="https://selected.example/article"')
    expect(markup).toContain('\u4e2d CN')
    expect(markup).toContain('\u82f1 EN')
    expect(getRunActionKinds({ ...run, status: 'interrupted', capabilities: { canCancel: false, canResume: true, canRetry: false, canProvideClarification: false } })).toContain('resume')
    expect(getRunActionKinds({ ...run, status: 'failed', error: { code: 'TIMEOUT', message: 'Retry later', retryable: true }, capabilities: { canCancel: false, canResume: false, canRetry: true, canProvideClarification: false } })).toContain('retry')
    expect(getRunActionKinds({ ...run, status: 'cancelled', capabilities: { canCancel: false, canResume: true, canRetry: false, canProvideClarification: false } })).not.toContain('resume')
  })
})
