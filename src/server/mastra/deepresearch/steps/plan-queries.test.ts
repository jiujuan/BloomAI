import { describe, expect, it, vi } from 'vitest'
import type { ResearchQuestionDto, ResearchRunDto } from '@shared/deepresearch/contracts'
import { createPlanQueriesStep } from './plan-queries'
import { createQueryDedupeKey } from '../query-strategy'

function createRun(): ResearchRunDto {
  return {
    id: 'run-query-plan', sessionId: null, topic: 'CRM 销售线索智能', profile: 'market', depth: 'standard', status: 'planning', phase: 'planning', progress: 10, workflowRunId: null,
    brief: null,
    budget: { maxQuestions: 10, maxIterations: 2, maxSearchQueries: 4, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
    usage: { questions: 1, iterations: 0, searchQueries: 0, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
    quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
  }
}

const question: ResearchQuestionDto = {
  id: 'question-1', runId: 'run-query-plan', parentQuestionId: null, ordinal: 1,
  question: 'CRM 销售线索智能产品能力和客户采用情况如何？', intent: 'product evaluation', requiredEvidenceTypes: [],
  questionType: 'market-analysis', needPrimarySource: true, needRecentSource: true, needQuantitativeEvidence: true,
  sourceTargets: ['公司官网与产品文档', '客户案例', '官方统计'], priority: 'high', status: 'planned', coverage: null,
}

const secondQuestion: ResearchQuestionDto = {
  ...question,
  id: 'question-2',
  ordinal: 2,
  question: 'CRM 销售线索智能产品的价格和采购流程如何？',
}

const brief = { title: 'brief', objective: null, audience: null, scope: 'scope', assumptions: [], plannedSections: [], criticalClarificationIds: [] }

describe('createPlanQueriesStep', () => {
  it('persists only distinct multi-intent query plans with durable intent, source targets, and dedupe keys', async () => {
    const run = createRun()
    const created: any[] = []
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), setUsage: vi.fn() },
      researchQuestionRepo: {
        list: vi.fn(() => [question]),
        listSearchQueries: vi.fn(() => []),
        createSearchQuery: vi.fn((input) => {
          created.push(input)
          return { id: 'query-' + created.length, ...input }
        }),
      },
      researchEventRepo: { append: vi.fn() },
      researchAttemptRepo: { get: vi.fn(() => undefined) },
    } as any
    const planner: any = {
      plan: vi.fn(async () => [
        { questionId: question.id, query: 'CRM 销售线索智能 产品能力 官网', intent: 'product_capability', sourceTargets: ['公司官网与产品文档'], dedupeKey: 'untrusted-model-key' },
        { questionId: question.id, query: 'crm 销售线索智能 产品能力 官网！！！', intent: 'product_capability', sourceTargets: ['公司官网与产品文档'] },
        { questionId: question.id, query: 'CRM 销售线索智能 客户案例 采购方实践', intent: 'customer_case', sourceTargets: ['客户案例'] },
      ]),
    }

    const step = createPlanQueriesStep({ repositories, planner })
    await (step as any).execute({ inputData: { runId: run.id, brief } })

    expect(created).toHaveLength(2)
    expect(created).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: question.id, intent: 'product_capability', sourceTargets: ['公司官网与产品文档'], dedupeKey: expect.stringMatching(/^query-dedupe:v1:/), idempotencyKey: expect.stringMatching(/^initial-query:v2:question-1:query-dedupe:v1:/) }),
      expect.objectContaining({ questionId: question.id, intent: 'customer_case', sourceTargets: ['客户案例'], dedupeKey: expect.stringMatching(/^query-dedupe:v1:/) }),
    ]))
    expect(created.find((item) => item.intent === 'product_capability')?.dedupeKey).toBe(createQueryDedupeKey('CRM 销售线索智能 产品能力 官网'))
    expect(repositories.researchRunRepo.setUsage).toHaveBeenCalledWith(run.id, expect.objectContaining({ searchQueries: 2 }))
  })

  it('caps initial search queries by the actual number of planned subtopics', async () => {
    const run = createRun()
    const created: any[] = []
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), setUsage: vi.fn() },
      researchQuestionRepo: {
        list: vi.fn(() => [question]),
        listSearchQueries: vi.fn(() => []),
        createSearchQuery: vi.fn((input) => {
          created.push(input)
          return { id: 'query-' + created.length, ...input }
        }),
      },
      researchEventRepo: { append: vi.fn() },
      researchAttemptRepo: { get: vi.fn(() => undefined) },
    } as any
    const planner: any = {
      plan: vi.fn(async () => [
        { questionId: question.id, query: 'CRM 销售线索智能 产品能力 官网', intent: 'product_capability', sourceTargets: ['公司官网与产品文档'] },
        { questionId: question.id, query: 'CRM 销售线索智能 客户案例', intent: 'customer_case', sourceTargets: ['客户案例'] },
        { questionId: question.id, query: 'CRM 销售线索智能 行业数据', intent: 'market_data', sourceTargets: ['官方统计'] },
        { questionId: question.id, query: 'CRM 销售线索智能 采购价格', intent: 'recent_update', sourceTargets: ['公司官网与产品文档'] },
      ]),
    }

    const step = createPlanQueriesStep({ repositories, planner })
    await (step as any).execute({ inputData: { runId: run.id, brief } })

    expect(created).toHaveLength(3)
    expect(repositories.researchRunRepo.setUsage).toHaveBeenCalledWith(run.id, expect.objectContaining({ searchQueries: 3 }))
  })

  it('does not reallocate one subtopic search budget to another subtopic', async () => {
    const run = createRun()
    run.budget = { ...run.budget, maxSearchQueries: 10 }
    const created: any[] = []
    const repositories = {
      researchRunRepo: { get: vi.fn(() => run), setUsage: vi.fn() },
      researchQuestionRepo: {
        list: vi.fn(() => [question, secondQuestion]),
        listSearchQueries: vi.fn(() => []),
        createSearchQuery: vi.fn((input) => {
          created.push(input)
          return { id: 'query-' + created.length, ...input }
        }),
      },
      researchEventRepo: { append: vi.fn() },
      researchAttemptRepo: { get: vi.fn(() => undefined) },
    } as any
    const planner: any = {
      plan: vi.fn(async () => [
        { questionId: question.id, query: 'CRM 销售线索智能 官方定义', intent: 'definition', sourceTargets: ['公司官网与产品文档'] },
        { questionId: question.id, query: 'CRM 销售线索智能 产品功能', intent: 'product_capability', sourceTargets: ['公司官网与产品文档'] },
        { questionId: question.id, query: 'CRM 销售线索智能 技术架构', intent: 'technical_architecture', sourceTargets: ['公司官网与产品文档'] },
        { questionId: question.id, query: 'CRM 销售线索智能 客户案例', intent: 'customer_case', sourceTargets: ['客户案例'] },
        { questionId: secondQuestion.id, query: 'CRM 销售线索智能 采购价格', intent: 'recent_update', sourceTargets: ['公司官网与产品文档'] },
      ]),
    }

    const step = createPlanQueriesStep({ repositories, planner })
    await (step as any).execute({ inputData: { runId: run.id, brief } })

    expect(created.filter((item) => item.questionId === question.id)).toHaveLength(3)
    expect(created.filter((item) => item.questionId === secondQuestion.id)).toHaveLength(1)
    expect(repositories.researchRunRepo.setUsage).toHaveBeenCalledWith(run.id, expect.objectContaining({ searchQueries: 4 }))
  })
})
