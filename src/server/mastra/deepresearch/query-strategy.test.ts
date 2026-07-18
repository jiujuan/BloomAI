import { describe, expect, it } from 'vitest'
import type { ResearchQuestionDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import {
  createQueryDedupeKey,
  dedupeResearchQueryPlans,
  createTopicBoundQueryPlans,
  rewriteCoverageGapAsSearchBrief,
} from './query-strategy'

const run: ResearchRunDto = {
  id: 'run-query-strategy', sessionId: null, topic: '中国销售线索智能体（sales lead intelligence）市场', profile: 'market', depth: 'standard',
  status: 'planning', phase: 'planning', progress: 0, brief: null, workflowRunId: null,
  budget: { maxQuestions: 10, maxIterations: 2, maxSearchQueries: 30, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
  usage: { questions: 1, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
  quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
}

const question: ResearchQuestionDto = {
  id: 'question-market', runId: run.id, parentQuestionId: null, ordinal: 1,
  question: '中国销售线索智能体有哪些产品能力、技术架构、客户场景和市场限制？',
  intent: '评估产品、技术、客户场景和市场限制', requiredEvidenceTypes: ['产品文档', '客户案例', '市场研究'],
  sectionKey: 'market-landscape', questionType: 'market-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: true,
  sourceTargets: ['公司官网与产品文档', '客户案例', '研究机构或官方统计'], priority: 'high', status: 'planned', coverage: null,
}

describe('topic-bound query strategy', () => {
  it('creates complementary 2–5 query intents per question while preserving the user language', () => {
    const plans = createTopicBoundQueryPlans(run, question)

    expect(plans).toHaveLength(5)
    expect(plans.map((plan) => plan.intent)).toEqual(expect.arrayContaining([
      'product_capability', 'technical_architecture', 'customer_case', 'market_data', 'counterevidence',
    ]))
    expect(plans.every((plan) => plan.query.includes('中国销售线索智能体'))).toBe(true)
    expect(plans.some((plan) => plan.query.includes('site:'))).toBe(true)
    expect(plans.every((plan) => plan.sourceTargets.length > 0 && plan.dedupeKey.length > 0)).toBe(true)
  })

  it('normalizes lexical duplicates and keeps complementary intents', () => {
    const plans = dedupeResearchQueryPlans([
      { questionId: question.id, query: 'CRM  Sales Lead Intelligence  产品能力', intent: 'product_capability', sourceTargets: ['产品文档'], dedupeKey: createQueryDedupeKey('CRM Sales Lead Intelligence 产品能力') },
      { questionId: question.id, query: 'crm sales lead intelligence 产品能力!!!', intent: 'product_capability', sourceTargets: ['产品文档'], dedupeKey: createQueryDedupeKey('crm sales lead intelligence 产品能力!!!') },
      { questionId: question.id, query: 'CRM sales lead intelligence 客户案例', intent: 'customer_case', sourceTargets: ['客户案例'], dedupeKey: createQueryDedupeKey('CRM sales lead intelligence 客户案例') },
    ])

    expect(plans).toHaveLength(2)
    expect(plans.map((plan) => plan.intent)).toEqual(['product_capability', 'customer_case'])
  })

  it('rewrites coverage gaps as a user-searchable brief without leaking internal category labels', () => {
    const brief = rewriteCoverageGapAsSearchBrief({
      question,
      gap: 'Missing required evidence category: primary_source',
      recommendedSearchIntent: 'primary_source',
    })

    expect(brief).toContain('寻找')
    expect(brief).not.toMatch(/required evidence category|primary_source/i)
    expect(brief).toContain('一手')
  })
})
