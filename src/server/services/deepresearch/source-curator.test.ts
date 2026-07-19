import { describe, expect, it } from 'vitest'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { SourceCurator } from './source-curator'

function createRun(): ResearchRunDto {
  return {
    id: 'run-source-curation', sessionId: null, topic: 'CRM 销售线索智能（sales lead intelligence）', profile: 'market', depth: 'standard',
    status: 'planning', phase: 'planning', progress: 0, brief: null, workflowRunId: null,
    budget: { maxQuestions: 10, maxIterations: 2, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
    usage: { questions: 1, iterations: 0, searchQueries: 1, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
    quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
  }
}

const context = {
  'query-crm': {
    questionId: 'question-crm',
    question: 'CRM 销售线索智能有哪些产品能力、技术架构和客户采用案例？',
    plannedQuery: 'CRM sales lead intelligence 产品能力 客户案例 官方文档',
    intent: 'product_capability',
    sourceTargets: ['公司官网与产品文档', '客户案例'],
    needPrimarySource: true,
    needQuantitativeEvidence: false,
  },
}

describe('SourceCurator relevance and classification', () => {
  it('ranks question-relevant CRM results above unrelated broad AI news and records an explainable fallback breakdown', () => {
    const curated = new SourceCurator().curate(createRun(), [
      { queryId: 'query-crm', title: 'CRM sales lead intelligence product documentation', url: 'https://docs.example-crm.com/lead-intelligence', snippet: 'Official documentation for sales lead scoring, enrichment, and CRM workflows.' },
      { queryId: 'query-crm', title: 'Insurance company launches a generic AI assistant', url: 'https://news.example.com/insurance-ai', snippet: 'A broad artificial intelligence news story about insurance claims.' },
      { queryId: 'query-crm', title: 'Mobile phone AI feature update', url: 'https://news.example.com/mobile-ai', snippet: 'Consumer smartphone feature coverage.' },
      { queryId: 'query-crm', title: 'PCB factory AI automation news', url: 'https://news.example.com/pcb-ai', snippet: 'Manufacturing and PCB quality automation.' },
    ], { queryContexts: context })

    const crm = curated.selected.find((source) => source.title.includes('CRM sales'))!
    const unrelated = [...curated.selected, ...curated.rejected].find((source) => source.title.includes('Insurance'))!
    expect(crm.score).toBeGreaterThan(unrelated.score ?? -1)
    expect(crm.scoreBreakdown.relevance).toBeGreaterThan(unrelated.scoreBreakdown?.relevance ?? -1)
    expect(crm.scoreBreakdown.relevanceMethod).toBe('keyword_fallback')
    expect(crm.diagnostics).toEqual(expect.objectContaining({ relevanceFallback: true }))
    expect(crm.scoreBreakdown.authority).not.toBe(crm.scoreBreakdown.relevance)
    expect(curated.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Insurance company launches a generic AI assistant', reason: 'not_relevant' }),
    ]))
  })

  it('classifies first-party, authoritative, secondary, aggregate, and unusable candidates without assigning a fixed source-type score', () => {
    const curated = new SourceCurator().curate(createRun(), [
      { queryId: 'query-crm', title: 'CRM product documentation', url: 'https://docs.vendor.com/lead-intelligence', snippet: 'CRM lead intelligence documentation' },
      { queryId: 'query-crm', title: 'CRM pricing', url: 'https://vendor.com/pricing', snippet: 'Pricing and package details' },
      { queryId: 'query-crm', title: 'Customer story', url: 'https://vendor.com/customers/acme', snippet: 'Customer case study for sales teams' },
      { queryId: 'query-crm', title: '2025 annual report', url: 'https://investor.vendor.com/annual-report', snippet: 'Investor relations annual report' },
      { queryId: 'query-crm', title: 'Official CRM statistics', url: 'https://www.census.gov/data/crm.html', snippet: 'Official statistics' },
      { queryId: 'query-crm', title: 'Trade association report', url: 'https://www.salesforce-association.org/report', snippet: 'Industry association report' },
      { queryId: 'query-crm', title: 'Research firm market report', url: 'https://www.gartner.com/en/reports/crm', snippet: 'Market research report' },
      { queryId: 'query-crm', title: 'Peer reviewed paper', url: 'https://doi.org/10.1234/crm.2026.1', snippet: 'Peer reviewed study' },
      { queryId: 'query-crm', title: 'News story', url: 'https://www.reuters.com/technology/crm-ai', snippet: 'News secondary coverage' },
      { queryId: 'query-crm', title: 'Directory listing', url: 'https://www.g2.com/categories/crm', snippet: 'Software directory listing' },
      { queryId: 'query-crm', title: 'Thin affiliate page', url: 'https://coupon.example.com/crm', snippet: 'Best CRM coupon and download' },
    ], { queryContexts: context, maxSources: 20 })

    const assessed = [...curated.selected, ...curated.rejected]
    expect(assessed.map((source) => source.sourceType)).toEqual(expect.arrayContaining([
      'product_documentation', 'pricing', 'customer_case', 'investor_material', 'official_statistics',
      'industry_association', 'research_firm', 'peer_reviewed', 'news_secondary', 'directory_aggregator',
    ]))
    expect(curated.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'low_quality_or_unavailable', reason: 'quality_insufficient' }),
    ]))
    const news = assessed.find((source) => source.sourceType === 'news_secondary')!
    const directory = assessed.find((source) => source.sourceType === 'directory_aggregator')!
    expect(news.score).not.toBe(directory.score)
  })

  it('prefers the required first-party source combination and reports a missing requirement when no matching source is available', () => {
    const curated = new SourceCurator().curate(createRun(), [
      { queryId: 'query-crm', title: 'Independent CRM market analysis', url: 'https://analysis.example.org/crm-leads', snippet: 'Independent analysis of CRM sales lead intelligence.' },
      { queryId: 'query-crm', title: 'CRM lead intelligence documentation', url: 'https://docs.vendor.com/lead-intelligence', snippet: 'Official product documentation.' },
    ], { queryContexts: context, maxSources: 2 })

    expect(curated.selected.some((source) => source.sourceType === 'product_documentation')).toBe(true)
    expect(curated.diagnostics.questionRequirements['question-crm']).toEqual(expect.objectContaining({
      requiredCategories: expect.arrayContaining(['company_official', 'product_documentation']),
      satisfied: true,
    }))

    const missing = new SourceCurator().curate(createRun(), [
      { queryId: 'query-crm', title: 'Independent CRM market analysis', url: 'https://analysis.example.org/crm-leads', snippet: 'Independent analysis of CRM sales lead intelligence.' },
    ], { queryContexts: context })
    expect(missing.diagnostics.questionRequirements['question-crm']?.missingCategories).toEqual(expect.arrayContaining(['company_official', 'product_documentation']))
  })
})