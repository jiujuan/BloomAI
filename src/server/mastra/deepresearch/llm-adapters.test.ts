import { describe, expect, it, vi } from 'vitest'
import type { MastraModelConfig } from '@mastra/core/llm'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { createLlmDeepResearchAdapters, RESEARCH_LLM_STAGE_LIMITS } from './llm-adapters'

const run: ResearchRunDto = {
  id: 'run-llm', sessionId: null, topic: 'Enterprise AI assistant market', profile: 'market', depth: 'deep', status: 'planning', phase: 'planning', progress: 20, workflowRunId: null,
  brief: null,
  budget: { maxQuestions: 10, maxIterations: 3, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
  usage: { questions: 0, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
}

describe('createLlmDeepResearchAdapters', () => {
  it('uses a model-bound generator and reports its token usage', async () => {
    const usageReporter = vi.fn()
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        title: run.topic,
        objective: run.topic,
        audience: null,
        scope: 'Global enterprise market',
        assumptions: ['Public sources only'],
        plannedSections: ['executive-summary'],
        criticalClarifications: [],
      }),
      usage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
    }))
    const adapters = createLlmDeepResearchAdapters({
      model: {} as MastraModelConfig,
      generate,
      usageReporter,
    })

    await expect(adapters.planner.plan(run)).resolves.toMatchObject({ title: run.topic, plannedSections: ['executive-summary'] })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ stage: 'brief_planning', maxOutputTokens: expect.any(Number) }))
    expect(usageReporter).toHaveBeenCalledWith(expect.objectContaining({ stage: 'brief_planning', tokens: 20, inputTokens: 13, outputTokens: 7 }))
  })

  it('uses contextual evidence and assigns larger output budgets to evidence and writing stages', async () => {
    const generate = vi.fn(async ({ stage }: { stage: string }) => ({
      text: stage === 'evidence_analysis'
        ? JSON.stringify([{
          questionId: 'question-1',
          snapshotId: 'snapshot-1',
          passage: 'A bounded source passage with relevant factual context.',
          summary: 'The source provides relevant context for the research question.',
          stance: 'contextual',
          confidence: 0.8,
          startOffset: 0,
          endOffset: 55,
        }])
        : JSON.stringify({ markdown: 'Section draft' }),
    }))
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })

    await expect(adapters.evidenceAnalyst.analyze({ run, questions: [], packets: [] })).resolves.toMatchObject([
      { stance: 'contextual', snapshotId: 'snapshot-1' },
    ])
    await expect(adapters.sectionWriter.draft({ run, section: { id: 'section-1' }, evidence: [] } as never)).resolves.toBe('Section draft')

    expect(RESEARCH_LLM_STAGE_LIMITS.evidence_analysis.maxOutputTokens)
      .toBeGreaterThan(RESEARCH_LLM_STAGE_LIMITS.query_planning.maxOutputTokens)
    expect(RESEARCH_LLM_STAGE_LIMITS.section_writing.maxOutputTokens)
      .toBeGreaterThan(RESEARCH_LLM_STAGE_LIMITS.brief_planning.maxOutputTokens)
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'section_writing',
      timeoutMs: RESEARCH_LLM_STAGE_LIMITS.section_writing.timeoutMs,
      maxOutputTokens: RESEARCH_LLM_STAGE_LIMITS.section_writing.maxOutputTokens,
    }))
  })

  it('propagates provider failures instead of synthesizing a deterministic report', async () => {
    const providerFailure = new Error('provider unavailable')
    const generate = vi.fn(async () => { throw providerFailure })
    const usageReporter = vi.fn()
    const adapters = createLlmDeepResearchAdapters({
      model: {} as MastraModelConfig,
      generate,
      usageReporter,
    })

    await expect(adapters.planner.plan(run)).rejects.toBe(providerFailure)
    expect(usageReporter).not.toHaveBeenCalled()
  })

})

  it('uses the shared structured invoker for adapter output repair and safe trace reporting', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '{truncated', usage: { totalTokens: 3 } })
      .mockResolvedValueOnce({ text: JSON.stringify({
        title: run.topic,
        objective: run.topic,
        audience: null,
        scope: 'Global enterprise market',
        assumptions: ['Public sources only'],
        plannedSections: ['executive-summary'],
        criticalClarifications: [],
      }), usage: { totalTokens: 4 } })
    const traceReporter = vi.fn()
    const adapters = createLlmDeepResearchAdapters({
      model: {} as MastraModelConfig,
      generate,
      traceReporter,
    })

    await expect(adapters.planner.plan(run)).resolves.toMatchObject({ title: run.topic })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(traceReporter).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'brief_planning', parseStatus: 'invalid_json', retryReason: 'invalid_json',
    }))
  })
