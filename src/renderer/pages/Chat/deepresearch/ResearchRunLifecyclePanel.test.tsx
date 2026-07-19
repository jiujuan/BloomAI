import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ResearchRunDto, ResearchRunLifecycleDto } from '@shared/deepresearch/contracts'
import { ResearchRunLifecyclePanel } from './ResearchRunLifecyclePanel'

const run: ResearchRunDto = {
  id: 'run-1', sessionId: null, topic: 'Lifecycle integration', profile: 'general', depth: 'standard',
  status: 'researching', phase: 'researching', progress: 42, brief: null, workflowRunId: null,
  budget: { maxQuestions: 12, maxIterations: 4, maxSearchQueries: 20, maxNormalizedSources: 30, maxFetchedSources: 20, searchConcurrency: 2, fetchConcurrency: 2, maxDurationMs: 60_000 },
  usage: { questions: 2, iterations: 1, searchQueries: 4, normalizedSources: 5, fetchedSources: 4, tokens: 120, providerCostUsd: 0, startedAt: 1, deadlineAt: 60_001 },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 2, completedAt: null,
}

function lifecycle(overrides: Partial<ResearchRunLifecycleDto> = {}): ResearchRunLifecycleDto {
  return {
    currentAttempt: { id: 'attempt-1', ordinal: 2, trigger: 'manual_resume', status: 'running', startCheckpointKey: 'plan-queries', endCheckpointKey: null, error: null, startedAt: 2, endedAt: null, createdAt: 1 },
    resumeCheckpoint: { id: 'checkpoint-1', attemptId: 'attempt-1', sequence: 4, checkpointKey: 'extract-evidence', phase: 'researching', status: 'completed', resumeCursor: { version: 1, nextPhase: 'extract-evidence', iteration: 1 }, replayPolicy: 'reuse', createdAt: 2 },
    assessment: { id: 'assessment-1', runId: 'run-1', attemptId: 'attempt-1', iterationId: 'iteration-1', iteration: 1, policyVersion: 'v2', inputFingerprint: 'never-render-this-fingerprint', aggregateScore: 0.68, questionVerdicts: [{ questionId: 'question-1', score: 0.68, verdict: 'limited', gapCodes: ['NO_EVIDENCE'], limitations: ['Needs independent confirmation'] }], questionAssessments: [], coverageProjections: [], limitations: ['Needs independent confirmation'], createdAt: 2 },
    attemptHistory: { items: [], nextCursor: null },
    iterationHistory: { items: [{ id: 'iteration-1', runId: 'run-1', ordinal: 1, status: 'executing', decision: null, targetQuestionIds: ['question-1'], plannedQueryCount: 2, executedQueryCount: 1, newSourceCount: 1, newEvidenceCount: 1, stopReason: null, createdAt: 1, completedAt: null }], nextCursor: null },
    budget: { limit: run.budget, usage: run.usage },
    stopReason: null,
    limitations: [],
    cancellation: null,
    capabilities: { canCancel: true, canResume: false, canRetry: false, canProvideClarification: false },
    ...overrides,
  }
}

describe('ResearchRunLifecyclePanel', () => {
  it('renders V2 lifecycle state, coverage, budget, and only safe public fields', () => {
    const markup = renderToStaticMarkup(<ResearchRunLifecyclePanel
      run={{ ...run, status: 'cancelling', phase: 'gap_filling' }}
      lifecycle={lifecycle({
        cancellation: { requestedAt: 2, reason: 'C:\\private\\token=TOP_SECRET' },
        limitations: ['Provider https://example.test/data?token=TOP_SECRET', 'C:\\private\\report.md authorization=TOP_SECRET'],
      })}
      loading={false}
      onCancel={vi.fn()}
      onResume={vi.fn()}
    />)

    expect(markup).toContain('研究生命周期')
    expect(markup).toContain('正在取消')
    expect(markup).toContain('尝试 #2')
    expect(markup).toContain('extract-evidence')
    expect(markup).toContain('68%')
    expect(markup).toContain('已使用迭代 1 / 4')
    expect(markup).toContain('子主题预算')
    expect(markup).toContain('取消请求已持久化')
    expect(markup).toContain('disabled')
    expect(markup).not.toContain('TOP_SECRET')
    expect(markup).not.toContain('C:\\private')
    expect(markup).not.toContain('example.test/data')
    expect(markup).not.toContain('never-render-this-fingerprint')
  })

  it('does not offer resume for cancelled runs and exposes interrupted cursor only when capable', () => {
    const cancelled = renderToStaticMarkup(<ResearchRunLifecyclePanel run={{ ...run, status: 'cancelled' }} lifecycle={lifecycle({ capabilities: { canCancel: false, canResume: true, canRetry: false, canProvideClarification: false } })} loading={false} onCancel={vi.fn()} onResume={vi.fn()} />)
    const interrupted = renderToStaticMarkup(<ResearchRunLifecyclePanel run={{ ...run, status: 'interrupted' }} lifecycle={lifecycle({ capabilities: { canCancel: false, canResume: true, canRetry: false, canProvideClarification: false } })} loading={false} onCancel={vi.fn()} onResume={vi.fn()} />)

    expect(cancelled).toContain('已取消')
    expect(cancelled).not.toContain('恢复研究')
    expect(interrupted).toContain('已中断')
    expect(interrupted).toContain('恢复游标：extract-evidence')
    expect(interrupted).toContain('恢复研究')
  })

  it('distinguishes retryable and non-retryable failures from server capabilities', () => {
    const retryable = renderToStaticMarkup(<ResearchRunLifecyclePanel run={{ ...run, status: 'failed', error: { code: 'TIMEOUT', message: 'C:\\private\\token=TOP_SECRET', retryable: true } }} lifecycle={lifecycle({ capabilities: { canCancel: false, canResume: false, canRetry: true, canProvideClarification: false } })} loading={false} onCancel={vi.fn()} onResume={vi.fn()} />)
    const nonRetryable = renderToStaticMarkup(<ResearchRunLifecyclePanel run={{ ...run, status: 'failed', error: { code: 'VALIDATION', message: 'TOP_SECRET', retryable: false } }} lifecycle={lifecycle({ capabilities: { canCancel: false, canResume: false, canRetry: false, canProvideClarification: false } })} loading={false} onCancel={vi.fn()} onResume={vi.fn()} />)

    expect(retryable).toContain('失败（可恢复）')
    expect(retryable).toContain('重试研究')
    expect(nonRetryable).toContain('失败（不可恢复）')
    expect(nonRetryable).not.toContain('重试研究')
    expect(retryable).not.toContain('TOP_SECRET')
    expect(nonRetryable).not.toContain('TOP_SECRET')
  })
})