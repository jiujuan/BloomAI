import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MastraModelConfig } from '@mastra/core/llm'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'

const { agentGenerate, agentOptions } = vi.hoisted(() => ({
  agentGenerate: vi.fn(),
  agentOptions: vi.fn(),
}))

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(options: unknown) {
      agentOptions(options)
    }

    generate(...args: unknown[]) {
      return agentGenerate(...args)
    }
  },
}))

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests provider-validated structured output for production model calls', async () => {
    agentGenerate.mockResolvedValueOnce({
      text: 'The structured response is attached.',
      object: validBrief(),
      totalUsage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
    })
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })

    await expect(adapters.planner.plan(run)).resolves.toMatchObject({ title: run.topic })

    expect(agentGenerate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      structuredOutput: expect.objectContaining({
        schema: expect.anything(),
      }),
    }))
  })

  it('normalizes brief questions when the model returns structured text-shaped question items', async () => {
    agentGenerate.mockResolvedValueOnce({
      text: 'The structured response is attached.',
      object: {
        title: run.topic,
        objective: run.topic,
        audience: null,
        scope: 'Global enterprise market',
        definition: 'A topic-specific research category.',
        timeframe: '2024–2026',
        geography: 'Global',
        deliverables: ['Research report'],
        assumptions: ['Public sources only'],
        plannedSections: ['market-definition'],
        questions: [
          { text: `How should ${run.topic} be defined and bounded?` },
          `Which vendors and alternatives are relevant to ${run.topic}?`,
        ],
        criticalClarifications: [],
      },
      totalUsage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
    })
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })

    const brief = await adapters.planner.plan(run)

    expect(brief.questions).toHaveLength(5)
    expect(brief.questions?.[0]).toMatchObject({
      question: expect.stringContaining(run.topic),
      intent: expect.any(String),
      priority: expect.any(String),
      needPrimarySource: expect.any(Boolean),
      needRecentSource: expect.any(Boolean),
      needQuantitativeEvidence: expect.any(Boolean),
      sourceTargets: expect.any(Array),
    })
  })

  it('normalizes brief questions when the model returns a numbered text block', async () => {
    agentGenerate.mockResolvedValueOnce({
      text: 'The structured response is attached.',
      object: {
        title: run.topic,
        objective: run.topic,
        audience: null,
        scope: 'Global enterprise market',
        definition: 'A topic-specific research category.',
        timeframe: '2024–2026',
        geography: 'Global',
        deliverables: 'Research report',
        assumptions: 'Public sources only',
        plannedSections: 'market-definition; market-and-competition',
        questions: [
          '1. Which product categories and boundaries define Enterprise AI assistant market?',
          '2. Which vendors and alternatives are most relevant to Enterprise AI assistant market?',
        ].join('\n'),
        criticalClarifications: null,
      },
      totalUsage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
    })
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })

    const brief = await adapters.planner.plan(run)

    expect(brief.questions).toHaveLength(5)
    expect(brief.questions?.[0]).toMatchObject({
      question: 'Which product categories and boundaries define Enterprise AI assistant market?',
      intent: expect.any(String),
      needRecentSource: expect.any(Boolean),
      sourceTargets: expect.any(Array),
    })
    expect(brief.plannedSections).toEqual(expect.arrayContaining(['market-definition', 'market-and-competition']))
  })

  it('uses a deterministic topic-bound brief when brief planning returns non-json text twice', async () => {
    const generate = vi.fn(async () => ({ text: 'Here are several research subtopics in plain text instead of JSON.' }))
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })

    const brief = await adapters.planner.plan(run)

    expect(generate).toHaveBeenCalledTimes(2)
    expect(brief).toMatchObject({ title: run.topic, criticalClarifications: [] })
    expect(brief.questions).toHaveLength(7)
    expect(brief.questions?.every((question) => typeof question.needPrimarySource === 'boolean')).toBe(true)
  })

  it('falls back to an injected JSON schema when native structured output is unavailable', async () => {
    agentGenerate
      .mockRejectedValueOnce(new Error('response format is unsupported'))
      .mockResolvedValueOnce({
        text: 'The structured response is attached.',
        object: validBrief(),
        totalUsage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
      })
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })

    await expect(adapters.planner.plan(run)).resolves.toMatchObject({ title: run.topic })

    expect(agentGenerate).toHaveBeenCalledTimes(2)
    expect(agentGenerate.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      structuredOutput: expect.objectContaining({ jsonPromptInjection: true }),
    }))
  })

  it('accepts valid JSON text when an OpenAI-compatible provider omits the structured object', async () => {
    agentGenerate.mockResolvedValueOnce({
      text: JSON.stringify(validBrief()),
      object: undefined,
      totalUsage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
    })
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })

    await expect(adapters.planner.plan(run)).resolves.toMatchObject({ title: run.topic })
    expect(agentGenerate).toHaveBeenCalledTimes(1)
  })

  it('reports a stage timeout when Mastra resolves an aborted model call with an empty response', async () => {
    vi.useFakeTimers()
    agentGenerate.mockImplementation((_prompt: unknown, request: { abortSignal: AbortSignal }) => new Promise((resolve) => {
      const finish = () => resolve({
        text: '',
        object: undefined,
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      })
      if (request.abortSignal.aborted) finish()
      else request.abortSignal.addEventListener('abort', finish, { once: true })
    }))
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })

    const planning = adapters.planner.plan(run)
    const assertion = expect(planning).rejects.toMatchObject({ code: 'RESEARCH_MODEL_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(RESEARCH_LLM_STAGE_LIMITS.brief_planning.timeoutMs * 2)

    await assertion
    expect(agentGenerate).toHaveBeenCalledTimes(1)
  })



  it('does not issue a fallback request when an empty response already exhausted output tokens', async () => {
    agentGenerate.mockResolvedValueOnce({
      text: '',
      object: undefined,
      totalUsage: {
        inputTokens: 120,
        outputTokens: RESEARCH_LLM_STAGE_LIMITS.brief_planning.maxOutputTokens,
        totalTokens: 120 + RESEARCH_LLM_STAGE_LIMITS.brief_planning.maxOutputTokens,
      },
    })
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })

    await expect(adapters.planner.plan(run)).rejects.toMatchObject({ code: 'RESEARCH_MODEL_OUTPUT_LIMIT' })
    expect(agentGenerate).toHaveBeenCalledTimes(1)
  })

  it('lets the shared repair loop handle Mastra structured schema validation failures', async () => {
    const invalidPlans = [{ questionId: 'question-1', query: 'Enterprise AI assistant market' }]
    const validationError = Object.assign(new Error('Structured output validation failed: - 0.intent: Required'), {
      code: 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED',
      details: { value: JSON.stringify(invalidPlans) },
    })
    agentGenerate
      .mockRejectedValueOnce(validationError)
      .mockResolvedValueOnce({
        text: 'The structured response is attached.',
        object: [{ questionId: 'question-1', query: 'Enterprise AI assistant market official statistics', intent: 'market_data', sourceTargets: ['official statistics'] }],
        totalUsage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
      })
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })
    const question = {
      id: 'question-1', runId: run.id, parentQuestionId: null, ordinal: 1,
      ...validBrief().questions[0], status: 'planned', coverage: null,
    } as any

    await expect(adapters.queryPlanner.plan(run, [question])).resolves.toEqual([
      expect.objectContaining({ questionId: 'question-1', intent: 'market_data', sourceTargets: ['official statistics'] }),
    ])

    expect(agentGenerate).toHaveBeenCalledTimes(2)
    expect(agentGenerate.mock.calls[1]?.[0]).toContain('Repair the previous response')
  })

  it('normalizes repeated Mastra structured schema validation failures without leaking an internal error code', async () => {
    const validationError = Object.assign(new Error('Structured output validation failed: - 7.intent: Required'), {
      code: 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED',
    })
    agentGenerate.mockRejectedValue(validationError)
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })
    const question = {
      id: 'question-1', runId: run.id, parentQuestionId: null, ordinal: 1,
      ...validBrief().questions[0], status: 'planned', coverage: null,
    } as any

    await expect(adapters.queryPlanner.plan(run, [question])).rejects.toMatchObject({ code: 'RESEARCH_MODEL_INVALID_OUTPUT' })

    expect(agentGenerate).toHaveBeenCalledTimes(2)
    expect(agentGenerate.mock.calls[1]?.[1]).not.toHaveProperty('structuredOutput')
  })

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

  it('uses contextual evidence and applies stage-specific output budgets', async () => {
    const generate = vi.fn(async ({ stage }: { stage: string }) => ({
      text: stage === 'evidence_analysis'
        ? JSON.stringify([{
          questionId: 'question-1',
          sourceId: 'source-1',
          snapshotId: 'snapshot-1',
          passage: 'A bounded source passage with relevant factual context.',
          summary: 'The source provides relevant context for the research question.',
          claim: 'The bounded source passage provides relevant factual context.',
          evidenceType: 'fact',
          entities: ['source passage'],
          numbers: [],
          timeframe: null,
          stance: 'contextual',
          relevance: 0.8,
          confidence: 0.8,
          startOffset: 0,
          endOffset: 55,
        }])
        : JSON.stringify({ summary: 'Section summary', bodyMarkdown: '### Direct answer\n\nSection draft.\n\n### Comparison or classification\n\nClassified.\n\n### Evidence basis\n\nNo factual claims.\n\n### Conditions and limitations\n\nLimited.', claims: [], evidenceIds: [], limitations: [], missingEvidence: [] }),
    }))
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })

    await expect(adapters.evidenceAnalyst.analyze({ run, questions: [], packets: [] })).resolves.toMatchObject([
      {
        stance: 'contextual', snapshotId: 'snapshot-1', sourceId: 'source-1',
        claim: expect.any(String), evidenceType: 'fact', entities: expect.any(Array), numbers: expect.any(Array),
        relevance: expect.any(Number),
      },
    ])
    await expect(adapters.sectionWriter.draft({ run, section: { id: 'section-1' }, questions: [], evidence: [], sectionGoal: 'Draft the section.' } as never)).resolves.toMatchObject({ bodyMarkdown: expect.stringContaining('Section draft') })

    expect(RESEARCH_LLM_STAGE_LIMITS.brief_planning.maxOutputTokens)
      .toBeGreaterThan(RESEARCH_LLM_STAGE_LIMITS.query_planning.maxOutputTokens)
    expect(RESEARCH_LLM_STAGE_LIMITS.evidence_analysis.maxOutputTokens)
      .toBeGreaterThan(RESEARCH_LLM_STAGE_LIMITS.gap_analysis.maxOutputTokens)
    expect(RESEARCH_LLM_STAGE_LIMITS.section_writing.maxOutputTokens)
      .toBeGreaterThan(RESEARCH_LLM_STAGE_LIMITS.evidence_analysis.maxOutputTokens)
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

it('repairs a malformed section draft before it can bypass the structured writer retry', async () => {
  const invalidDraft = {
    summary: 'Too short.',
    bodyMarkdown: '### Direct answer\n\nShort.\n\n### Comparison or classification\n\nClassified answer.\n\n### Evidence basis\n\nNo factual claims.\n\n### Conditions and limitations\n\nLimited.',
    claims: [], evidenceIds: [], limitations: ['Limited evidence.'], missingEvidence: ['Evidence'],
  }
  const validDraft = {
    ...invalidDraft,
    bodyMarkdown: '### Direct answer\n\nThe available routed evidence supports a bounded answer.\n\n### Comparison or classification\n\nThe answer is classified by the mapped question.\n\n### Evidence basis\n\nNo factual claims are asserted beyond the bounded answer.\n\n### Conditions and limitations\n\nEvidence coverage remains limited.',
  }
  const generate = vi.fn()
    .mockResolvedValueOnce({ text: JSON.stringify(invalidDraft) })
    .mockResolvedValueOnce({ text: JSON.stringify(validDraft) })
  const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })

  await expect(adapters.sectionWriter.draft({ run, section: { id: 'section-1' }, questions: [], evidence: [], sectionGoal: 'Draft the section.' } as never)).resolves.toMatchObject(validDraft)
  expect(generate).toHaveBeenCalledTimes(2)
})


it('normalizes translated or missing section draft headings before schema validation', async () => {
  const generate = vi.fn(async () => ({
    text: JSON.stringify({
      summary: 'The routed evidence supports a bounded market answer.',
      bodyMarkdown: '## 直接回答：\n\nThe routed evidence supports a bounded market answer.\n\n## 证据基础：\n\nThe conclusion uses only supplied evidence.\n\n## 局限性：\n\nCoverage remains limited.',
      claims: [], evidenceIds: ['evidence-1'], limitations: ['Coverage remains limited.'], missingEvidence: [],
    }),
  }))
  const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })

  const result = await adapters.sectionWriter.draft({ run, section: { id: 'section-1' }, questions: [], evidence: [], sectionGoal: 'Draft the section.' } as never)

  expect(result.bodyMarkdown).toMatch(/^### Direct answer[\s\S]*### Comparison or classification[\s\S]*### Evidence basis[\s\S]*### Conditions and limitations/m)
  expect(result.bodyMarkdown).toContain('The routed evidence supports a bounded market answer.')
  expect(result.bodyMarkdown).toContain('No additional comparison or classification is available beyond the routed evidence for this section.')
  expect(result.bodyMarkdown).toContain('The conclusion uses only supplied evidence.')
  expect(result.bodyMarkdown).toContain('Coverage remains limited.')
  expect(generate).toHaveBeenCalledTimes(1)
})


it('unwraps common section draft envelopes and fills optional arrays before validation', async () => {
  const generate = vi.fn(async () => ({
    text: JSON.stringify({
      output: {
        overview: 'Wrapped section output with useful content.',
        content: '### Direct answer\n\nWrapped section output with useful content.\n\n### Evidence basis\n\nThe draft only uses routed evidence.',
      },
    }),
  }))
  const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })

  const result = await adapters.sectionWriter.draft({ run, section: { id: 'section-1' }, questions: [], evidence: [], sectionGoal: 'Draft the section.' } as never)

  expect(result).toMatchObject({
    summary: 'Wrapped section output with useful content.',
    claims: [],
    evidenceIds: [],
    limitations: [],
    missingEvidence: [],
  })
  expect(result.bodyMarkdown).toContain('### Direct answer')
  expect(result.bodyMarkdown).toContain('### Comparison or classification')
  expect(result.bodyMarkdown).toContain('### Evidence basis')
  expect(result.bodyMarkdown).toContain('### Conditions and limitations')
  expect(generate).toHaveBeenCalledTimes(1)
})


it('uses a loose provider schema for section writing and validates strictly after normalization', async () => {
  agentGenerate.mockResolvedValueOnce({
    text: 'The section draft is attached.',
    object: {
      draft: {
        summary: 'A provider-wrapped section draft is normalized.',
        bodyMarkdown: '### Direct answer\n\nA provider-wrapped section draft is normalized.\n\n### Comparison or classification\n\nNo comparison is required.\n\n### Evidence basis\n\nThe content is bounded to supplied evidence.\n\n### Conditions and limitations\n\nCoverage is limited.',
      },
    },
    totalUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  })
  const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig })

  await expect(adapters.sectionWriter.draft({ run, section: { id: 'section-1' }, questions: [], evidence: [], sectionGoal: 'Draft the section.' } as never)).resolves.toMatchObject({
    summary: 'A provider-wrapped section draft is normalized.',
    claims: [],
  })
  expect(agentGenerate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    structuredOutput: expect.objectContaining({ schema: expect.anything() }),
  }))
})


it('retries a citation response that omits the required semantic checks', async () => {
  const generate = vi.fn()
    .mockResolvedValueOnce({ text: JSON.stringify({ status: 'supported', rationale: 'Missing checks.' }) })
    .mockResolvedValueOnce({ text: JSON.stringify({ status: 'supported', rationale: 'Every semantic dimension is directly supported.', checks: { entity: 'supported', numericTemporal: 'not_applicable', relationship: 'supported', stance: 'supported' } }) })
  const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })

  await expect(adapters.citationVerifier.verify({
    claim: { id: 'claim-1', runId: run.id, sectionId: 'section-1', text: 'Acme grew in 2025.', kind: 'factual', importance: 'high', verificationStatus: 'not_applicable', confidence: 0.8, repairHistory: [] },
    evidence: { id: 'evidence-1', runId: run.id, questionId: 'question-1', snapshotId: 'snapshot-1', passage: 'Acme grew in 2025.', summary: 'Acme grew in 2025.', stance: 'supporting', confidence: 0.8, startOffset: 0, endOffset: 18 },
  })).resolves.toMatchObject({ status: 'supported', verificationMethod: 'semantic_llm' })
  expect(generate).toHaveBeenCalledTimes(2)
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

describe('DRQ-04 query planning', () => {
  it('requires structured multi-intent plans with source targets and safe gap briefs', async () => {
    const generate = vi.fn(async ({ stage }: { stage: string }) => ({
      text: JSON.stringify(stage === 'query_planning'
        ? [{ questionId: 'question-llm', query: 'Enterprise AI assistant market market size data site:gov', intent: 'market_data', sourceTargets: ['official statistics'] }]
        : [{ questionId: 'question-llm', query: 'Enterprise AI assistant market independent limitations evidence', intent: 'counterevidence', sourceTargets: ['independent research'] }]),
    }))
    const adapters = createLlmDeepResearchAdapters({ model: {} as MastraModelConfig, generate })
    const question = {
      id: 'question-llm', runId: run.id, parentQuestionId: null, ordinal: 1,
      ...validBrief().questions[0], status: 'planned', coverage: {
        questionId: 'question-llm', score: 0.1, independentDomainCount: 0, evidenceCategories: [], primarySourceCount: 0, recentSourceCount: 0, supportingEvidenceCount: 0, contradictingEvidenceCount: 0, hasSingleSourceDependency: true, gaps: ['Missing required evidence category: primary_source'],
      },
    } as any

    await expect(adapters.queryPlanner.plan(run, [question])).resolves.toEqual([
      expect.objectContaining({ intent: 'market_data', sourceTargets: ['official statistics'] }),
    ])
    await expect(adapters.gapAnalyst.plan(run, [question])).resolves.toEqual([
      expect.objectContaining({ intent: 'counterevidence', sourceTargets: ['independent research'] }),
    ])

    const queryRequest: any = generate.mock.calls.find(([input]) => input.stage === 'query_planning')![0]
    const gapRequest: any = generate.mock.calls.find(([input]) => input.stage === 'gap_analysis')![0]
    expect(queryRequest.prompt).toContain('2 to 5')
    expect(queryRequest.prompt).toContain('sourceTargets')
    expect(queryRequest.prompt).toContain('original user language')
    expect(gapRequest.prompt).toContain('searchBrief')
    expect(gapRequest.prompt).not.toContain('Missing required evidence category')
  })
})
