import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { DeepResearchRunView } from './DeepResearchRunView'

const run: ResearchRunDto = {
  id: 'run-1', sessionId: null, topic: '企业 AI 助手市场', profile: 'market', depth: 'standard',
  status: 'failed', phase: 'failed', progress: 0, workflowRunId: null, brief: null,
  budget: { maxQuestions: 8, maxIterations: 1, maxSearchQueries: 20, maxNormalizedSources: 24, maxFetchedSources: 16, searchConcurrency: 4, fetchConcurrency: 3, maxDurationMs: 60_000 },
  usage: { questions: 0, iterations: 0, searchQueries: 20, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null,
  error: { code: 'RESEARCH_BUDGET_EXHAUSTED', message: 'Search budget exhausted', retryable: false },
  createdAt: 1, updatedAt: 1, completedAt: null,
}

describe('DeepResearchRunView', () => {
  it('renders a Chinese remediation message for a persisted run failure', () => {
    const markup = renderToStaticMarkup(<DeepResearchRunView
      run={run}
      questions={[]}
      sources={[]}
      snapshotsById={{}}
      report={null}
      artifacts={[]}
      evidenceById={{}}
      events={[]}
      selectedView="overview"
      selectedEvidenceId={null}
      loading={false}
      onSelectedViewChange={vi.fn()}
      onSelectEvidence={vi.fn()}
      onCancel={vi.fn()}
      onResume={vi.fn()}
      onExport={vi.fn()}
      onAnswerClarification={vi.fn()}
    />)

    expect(markup).toContain('搜索或资源预算上限')
    expect(markup).not.toContain('Search budget exhausted')
  })
})
