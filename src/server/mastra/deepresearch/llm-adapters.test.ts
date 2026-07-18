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

function validBrief(topic = run.topic) {
  return {
    title: topic,
    objective: topic,
    audience: null,
    scope: 'Global enterprise market',
    definition: 'A topic-specific research category.',
    timeframe: '2024–2026',
    geography: 'Global',
    deliverables: ['Research report'],
    assumptions: ['Public sources only'],
    plannedSections: ['executive-summary', 'market-definition', 'market-and-competition', 'product-and-technology', 'risks-and-limitations'],
    questions: [
      { question: `How should ${topic} be defined and bounded?`, intent: 'define category scope', priority: 'high', sectionKey: 'market-definition', questionType: 'definition', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['official definitions'] },
      { question: `Which vendors and alternatives are relevant to ${topic}?`, intent: 'identify market alternatives', priority: 'high', sectionKey: 'market-and-competition', questionType: 'competitive-landscape', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['company pages'] },
      { question: `What technical architecture supports ${topic}?`, intent: 'analyze technical architecture', priority: 'high', sectionKey: 'product-and-technology', questionType: 'technical-analysis', needPrimarySource: true, needRecentSource: false, needQuantitativeEvidence: false, sourceTargets: ['technical documentation'] },
      { question: `Which quantitative market signals describe ${topic}?`, intent: 'assess market signals', priority: 'medium', sectionKey: 'market-and-competition', questionType: 'market-analysis', needPrimarySource: false, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['industry data'] },
      { question: `What risks and limitations affect ${topic}?`, intent: 'assess risks and limitations', priority: 'high', sectionKey: 'risks-and-limitations', questionType: 'risk-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['regulatory guidance'] },
    ],
    criticalClarifications: [],
  }
}

describe('createLlmDeepResearchAdapters', () => {
  it('uses a model-bound generator and reports its token usage', async () => {
    const usageReporter = vi.fn()
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        ...validBrief(run.topic),
      }),
      usage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
    }))
    const adapters = createLlmDeepResearchAdapters({
      model: {} as MastraModelConfig,
      generate,
      usageReporter,
    })

    await expect(adapters.planner.plan(run)).resolves.toMatchObject({ title: run.topic, plannedSections: expect.arrayContaining(['executive-summary']) })
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
        ...validBrief(run.topic),
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

describe('DRQ-03 brief planning', () => {
  it('keeps a broad market topic moving with topic-bound complementary questions and evidence targets', async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        title: 'Market and sales lead intelligence agents',
        objective: 'Assess the market for market and sales lead intelligence agents.',
        audience: 'Product and go-to-market leaders',
        scope: 'Global enterprise market, using current public information.',
        definition: 'Software agents that identify, enrich, prioritize, or route prospective customer leads for revenue teams.',
        timeframe: '2024–2026',
        geography: 'Global, with regional differences noted where material.',
        deliverables: ['Market landscape', 'Vendor comparison', 'Risks and limitations'],
        assumptions: ['Use global public sources because no geography was specified.'],
        plannedSections: ['market-definition', 'product-and-technology', 'data-and-workflows', 'market-and-competition', 'risks-and-limitations'],
        questions: [
          { question: 'Which product categories and buyer workflows are included in market and sales lead intelligence agents?', intent: 'define the category and buyer use cases', priority: 'high', sectionKey: 'market-definition', questionType: 'definition', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['product documentation', 'buyer research'] },
          { question: 'Which representative vendors offer market and sales lead intelligence agents, and how are they positioned?', intent: 'identify vendors and positioning', priority: 'high', sectionKey: 'market-and-competition', questionType: 'competitive-landscape', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['company product pages', 'independent market analysis'] },
          { question: 'What technical architecture and integrations support lead discovery, enrichment, scoring, and routing?', intent: 'explain product architecture', priority: 'high', sectionKey: 'product-and-technology', questionType: 'technical-analysis', needPrimarySource: true, needRecentSource: false, needQuantitativeEvidence: false, sourceTargets: ['technical documentation', 'integration documentation'] },
          { question: 'Which first- and third-party data sources are used, and what accuracy, consent, and provenance constraints apply?', intent: 'assess data sources and governance', priority: 'high', sectionKey: 'data-and-workflows', questionType: 'data-governance', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['privacy documentation', 'regulatory guidance'] },
          { question: 'Which buyer segments, sales scenarios, and operating models most benefit from these agents?', intent: 'analyze buyers and sales scenarios', priority: 'medium', sectionKey: 'data-and-workflows', questionType: 'use-case-analysis', needPrimarySource: false, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['customer case studies', 'buyer surveys'] },
          { question: 'What market size, growth signals, and competitive dynamics are reported for this category?', intent: 'size the market', priority: 'high', sectionKey: 'market-and-competition', questionType: 'market-analysis', needPrimarySource: false, needRecentSource: true, needQuantitativeEvidence: true, sourceTargets: ['industry association data', 'research institute data'] },
          { question: 'What legal, data-quality, model-reliability, and adoption risks could limit deployment?', intent: 'identify deployment risks', priority: 'high', sectionKey: 'risks-and-limitations', questionType: 'risk-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: false, sourceTargets: ['regulatory guidance', 'security documentation'] },
        ],
        criticalClarifications: [],
      }),
    }))
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })

    const brief = await adapters.planner.plan({ ...run, topic: 'Market and sales lead intelligence agents' })

    expect(brief).toMatchObject({
      definition: expect.stringContaining('lead'),
      timeframe: '2024–2026',
      geography: expect.stringContaining('Global'),
      deliverables: expect.arrayContaining(['Market landscape']),
    })
    const questions = brief.questions!
    expect(questions).toHaveLength(7)
    expect(questions.map((question) => question.question)).not.toContain('market-definition')
    expect(new Set(questions.map((question) => question.sectionKey)).size).toBeGreaterThan(3)
    expect(questions.filter((question) => question.priority === 'high').every((question) => question.sourceTargets.length > 0)).toBe(true)
  })
})
