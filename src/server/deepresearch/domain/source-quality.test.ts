import { describe, expect, it } from 'vitest'
import { assessCandidateSourceQuality } from './source-quality'

const ASSESSED_AT = Date.UTC(2026, 6, 18)

describe('assessCandidateSourceQuality', () => {
  const context = {
    question: 'What CRM and sales lead intelligence capabilities does Acme provide?',
    plannedQuery: 'Acme CRM sales lead intelligence product documentation',
    sourceTargets: ['official source', 'product documentation'],
    assessedAt: ASSESSED_AT,
  }

  it('ranks an on-topic product document above unrelated generic AI news', () => {
    const productDocument = assessCandidateSourceQuality({
      ...context,
      url: 'https://docs.acme.example.com/sales/lead-intelligence',
      domain: 'docs.acme.example.com',
      title: 'Sales lead intelligence for CRM teams',
      snippet: 'Product documentation explains CRM enrichment, lead scoring, and sales workflow automation.',
    })
    const genericNews = assessCandidateSourceQuality({
      ...context,
      url: 'https://news.example.net/ai-insurance-mobile-pcb',
      domain: 'news.example.net',
      title: 'AI changes insurance, mobile phones, and PCB design',
      snippet: 'A broad news roundup about artificial intelligence trends across unrelated industries.',
    })

    expect(productDocument.category).toBe('product-documentation')
    expect(productDocument.scores.relevance).toBeGreaterThan(genericNews.scores.relevance)
    expect(productDocument.scores.final).toBeGreaterThan(genericNews.scores.final)
    expect(productDocument.rejectionReasons).toEqual([])
    expect(genericNews.rejectionReasons).toContain('not_relevant')
  })

  it('keeps authority separate from category and records the keyword fallback diagnostic', () => {
    const wellSignaled = assessCandidateSourceQuality({
      ...context,
      url: 'https://acme.example.com/investors/annual-report-2026.pdf',
      domain: 'acme.example.com',
      title: '2026 audited annual report for investors',
      snippet: 'Investor materials with audited operating metrics and methodology.',
    })
    const poorlySignaled = assessCandidateSourceQuality({
      ...context,
      url: 'https://acme.example.com/blog/ai-news',
      domain: 'acme.example.com',
      title: 'AI news roundup',
      snippet: 'A marketing post without source citations or methodology.',
    })

    expect(wellSignaled.category).toBe('investor-material')
    expect(poorlySignaled.category).toBe('company-official-site')
    expect(wellSignaled.scores.authority).toBeGreaterThan(poorlySignaled.scores.authority)
    expect(wellSignaled.scoringMethod).toBe('keyword-fallback')
    expect(wellSignaled.diagnostics).toContain('SOURCE_RELEVANCE_KEYWORD_FALLBACK')
  })

  it('classifies official statistics and detects repeated domains independently from relevance', () => {
    const assessment = assessCandidateSourceQuality({
      question: 'How large is the CRM market?',
      plannedQuery: 'CRM market size official statistics',
      sourceTargets: ['official statistics'],
      url: 'https://data.gov.example/markets/crm-2026',
      domain: 'data.gov.example',
      title: '2026 CRM market statistics dataset',
      snippet: 'Official statistics publication with methodology and downloadable data.',
      existingDomains: ['data.gov.example'],
      assessedAt: ASSESSED_AT,
    })

    expect(assessment.category).toBe('official-statistics')
    expect(assessment.scores.relevance).toBeGreaterThan(0.5)
    expect(assessment.scores.independence).toBeLessThan(0.5)
    expect(assessment.reasons.join(' ')).toContain('already represented')
  })
})