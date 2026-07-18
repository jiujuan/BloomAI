import { describe, expect, it } from 'vitest'
import type { ResearchQuestionDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { createDeterministicGapAnalyst } from './gap-analyst'

const run: ResearchRunDto = {
  id: 'gap-run', sessionId: null, topic: '企业级 AI 助手市场', profile: 'market', depth: 'standard', status: 'researching', phase: 'gap_filling', progress: 50, workflowRunId: null,
  brief: null,
  budget: { maxQuestions: 10, maxIterations: 2, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
  usage: { questions: 1, iterations: 0, searchQueries: 2, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
}

const question: ResearchQuestionDto = {
  id: 'question-gap', runId: run.id, parentQuestionId: null, ordinal: 1, question: '企业级 AI 助手的市场风险和限制是什么？', intent: 'risk analysis', requiredEvidenceTypes: [],
  questionType: 'risk-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['独立研究与可信行业媒体', '官方一手资料'],
  priority: 'high', status: 'limited',
  coverage: { questionId: 'question-gap', score: 0.1, independentDomainCount: 0, evidenceCategories: [], primarySourceCount: 0, recentSourceCount: 0, supportingEvidenceCount: 0, contradictingEvidenceCount: 0, hasSingleSourceDependency: true, gaps: ['Missing required evidence category: primary_source'] },
}

describe('createDeterministicGapAnalyst', () => {
  it('rewrites coverage diagnostics into searchable multi-intent plans without leaking policy labels', async () => {
    const plans = await createDeterministicGapAnalyst().plan(run, [question])

    expect(plans).not.toHaveLength(0)
    expect(plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: question.id, intent: 'primary_source', sourceTargets: expect.any(Array), dedupeKey: expect.stringMatching(/^query-dedupe:v1:/) }),
    ]))
    expect(plans.every((plan) => !/required evidence category|primary_source/i.test(plan.query))).toBe(true)
  })
})
