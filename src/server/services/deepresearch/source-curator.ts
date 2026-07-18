import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { canonicalizeResearchUrl } from '@server/deepresearch/domain/idempotency'

export type ResearchSourceCategory =
  | 'company_official'
  | 'product_documentation'
  | 'pricing'
  | 'customer_case'
  | 'investor_material'
  | 'official_statistics'
  | 'industry_association'
  | 'research_firm'
  | 'peer_reviewed'
  | 'news_secondary'
  | 'directory_aggregator'
  | 'low_quality_or_unavailable'

export interface DiscoveredResearchSource {
  queryId: string
  title: string
  url: string
  snippet: string
}

export interface SourceQueryContext {
  questionId: string
  question: string
  plannedQuery: string
  intent?: string | null
  sourceTargets?: string[]
  needPrimarySource?: boolean
  needQuantitativeEvidence?: boolean
}

export interface SourceRelevanceScore {
  score: number
  rationale: string
}

/** Optional seam for an embedding or lightweight-model ranker. The deterministic scorer is the safe fallback. */
export interface SourceRelevanceScorer {
  score(input: { run: ResearchRunDto; candidate: DiscoveredResearchSource; context: SourceQueryContext | null }): SourceRelevanceScore | null
}

export interface SourceScoreBreakdown {
  relevance: number
  authority: number
  categoryFit: number
  recency: number
  independence: number
  fetchability: number
  total: number
  relevanceMethod: 'semantic' | 'keyword_fallback'
  rationale: string[]
}

export interface SourceCurationDiagnostic {
  relevanceFallback: boolean
  reasons: string[]
}

export interface CuratedResearchSource extends DiscoveredResearchSource {
  canonicalUrl: string
  domain: string
  sourceType: ResearchSourceCategory
  score: number
  scoreBreakdown: SourceScoreBreakdown
  diagnostics: SourceCurationDiagnostic
}

export interface RejectedResearchSource extends DiscoveredResearchSource {
  reason: 'duplicate' | 'invalid_url' | 'not_relevant' | 'domain_cap' | 'budget_cap' | 'quality_insufficient'
  canonicalUrl?: string
  domain?: string
  sourceType?: ResearchSourceCategory
  score?: number
  scoreBreakdown?: SourceScoreBreakdown
  diagnostics?: SourceCurationDiagnostic
}

export interface QuestionSourceRequirementDiagnostic {
  requiredCategories: ResearchSourceCategory[]
  selectedCategories: ResearchSourceCategory[]
  missingCategories: ResearchSourceCategory[]
  satisfied: boolean
}

export interface SourceCurationResult {
  selected: CuratedResearchSource[]
  rejected: RejectedResearchSource[]
  diagnostics: { questionRequirements: Record<string, QuestionSourceRequirementDiagnostic> }
}

export { canonicalizeResearchUrl } from '@server/deepresearch/domain/idempotency'

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'with', 'on', 'about', 'what', 'how', 'is', 'are',
  '产品', '能力', '官方', '资料', '文档', '案例', '市场', '数据', '研究', '问题', '哪些', '如何', '什么',
])
const LOW_QUALITY_HOST = /(coupon|download|torrent|spam|affiliate|aggregator|pinterest|facebook\.com|twitter\.com|x\.com)$/i
const DIRECTORY_HOST = /(g2\.com|capterra\.com|crunchbase\.com|zoominfo\.com|wikipedia\.org)$/i
const RESEARCH_HOST = /(gartner\.com|forrester\.com|idc\.com|statista\.com|marketsandmarkets\.com|grandviewresearch\.com|mckinsey\.com|deloitte\.com|pwc\.com)$/i
const NEWS_HOST = /(reuters\.com|bloomberg\.com|ft\.com|wsj\.com|techcrunch\.com|theverge\.com|wired\.com|forbes\.com)$/i
const ASSOCIATION_HOST = /(association|alliance|federation|chamber|society|\.org)$/i
// Search-provider candidates with one direct topic/entity match remain eligible for downstream
// fetching and evidence checks; results with no match are rejected as off-topic noise.
const MINIMUM_RELEVANCE_SCORE = 19

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function tokenize(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US')
  const latinTokens = normalized.match(/[a-z0-9][a-z0-9+.#-]{1,}/g) ?? []
  const cjkTerms = normalized.match(/[\u3400-\u9fff]{2,}/gu) ?? []
  return [...new Set([...latinTokens, ...cjkTerms].filter((token) => !STOP_WORDS.has(token) && token.length > 1))]
}

function sourceText(candidate: DiscoveredResearchSource, domain: string): string {
  return `${candidate.title} ${candidate.snippet} ${domain.replace(/[.-]/g, ' ')}`.normalize('NFKC').toLocaleLowerCase('en-US')
}

function classifySource(url: URL, candidate: DiscoveredResearchSource): ResearchSourceCategory {
  const host = url.hostname.replace(/^www\./, '').toLocaleLowerCase('en-US')
  const path = url.pathname.toLocaleLowerCase('en-US')
  const text = `${candidate.title} ${candidate.snippet} ${path}`.toLocaleLowerCase('en-US')
  if (LOW_QUALITY_HOST.test(host) || /coupon|torrent|free download|adult|casino|seo backlinks/.test(text)) return 'low_quality_or_unavailable'
  if (DIRECTORY_HOST.test(host) || /directory|compare software|list of tools/.test(text)) return 'directory_aggregator'
  if (host.endsWith('.gov') || host.endsWith('.gov.cn') || /statistics|statistical|census|dataset|官方统计|统计数据/.test(text)) return 'official_statistics'
  if (host === 'doi.org' || host.includes('journals.') || host.includes('springer') || host.includes('sciencedirect') || /peer[ -]?reviewed|同行评审/.test(text)) return 'peer_reviewed'
  if (/\/docs?(\/|$)|documentation|developer|api reference|技术文档|开发者文档/.test(path + ' ' + text)) return 'product_documentation'
  if (/pricing|plans|套餐|价格/.test(path + ' ' + text)) return 'pricing'
  if (/customers?|case[- ]?stud(y|ies)|success[- ]?stor(y|ies)|客户案例|客户故事/.test(path + ' ' + text)) return 'customer_case'
  if (/investor|investors|annual[- ]?report|earnings|10-k|10-q|股东|年报|财报/.test(host + ' ' + path + ' ' + text) || host === 'sec.gov') return 'investor_material'
  if (RESEARCH_HOST.test(host) || /market research|research report|行业研究|市场报告/.test(text)) return 'research_firm'
  if (ASSOCIATION_HOST.test(host) && /association|alliance|federation|society|协会|联盟/.test(host + ' ' + text)) return 'industry_association'
  if (NEWS_HOST.test(host) || /news|press coverage|报道/.test(path + ' ' + text)) return 'news_secondary'
  if (/independent (analysis|research)|independent analyst|独立(分析|研究)/.test(text)) return 'research_firm'
  return 'company_official'
}

function authorityFor(category: ResearchSourceCategory): number {
  return {
    company_official: 76,
    product_documentation: 88,
    pricing: 78,
    customer_case: 74,
    investor_material: 86,
    official_statistics: 98,
    industry_association: 84,
    research_firm: 82,
    peer_reviewed: 96,
    news_secondary: 52,
    directory_aggregator: 28,
    low_quality_or_unavailable: 4,
  }[category]
}

function profileFit(run: ResearchRunDto, category: ResearchSourceCategory): number {
  const preferred: Record<ResearchRunDto['profile'], ResearchSourceCategory[]> = {
    general: ['company_official', 'official_statistics', 'peer_reviewed', 'news_secondary'],
    market: ['official_statistics', 'industry_association', 'research_firm', 'investor_material', 'company_official'],
    competitor: ['company_official', 'product_documentation', 'pricing', 'customer_case', 'investor_material'],
    academic: ['peer_reviewed', 'official_statistics', 'research_firm'],
  }
  return preferred[run.profile].includes(category) ? 92 : category === 'directory_aggregator' || category === 'low_quality_or_unavailable' ? 8 : 58
}

function freshnessFor(candidate: DiscoveredResearchSource): number {
  const years = [...`${candidate.title} ${candidate.snippet}`.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]))
  if (years.some((year) => year >= 2025)) return 96
  if (years.some((year) => year <= 2019)) return 28
  return 68
}

function independenceFor(category: ResearchSourceCategory): number {
  if (['company_official', 'product_documentation', 'pricing', 'customer_case', 'investor_material'].includes(category)) return 38
  if (['official_statistics', 'industry_association', 'research_firm', 'peer_reviewed'].includes(category)) return 88
  if (category === 'news_secondary') return 74
  if (category === 'directory_aggregator') return 35
  return 5
}

function fetchabilityFor(category: ResearchSourceCategory): number {
  if (category === 'low_quality_or_unavailable') return 5
  if (category === 'directory_aggregator') return 42
  if (category === 'news_secondary') return 68
  return 90
}

function fallbackRelevance(candidate: DiscoveredResearchSource, context: SourceQueryContext | null, domain: string): SourceRelevanceScore {
  const focus = context ? `${context.question} ${context.plannedQuery}` : ''
  const terms = tokenize(focus)
  if (terms.length === 0) return { score: 50, rationale: 'No question/query terms were available; applied neutral deterministic relevance.' }
  const text = sourceText(candidate, domain)
  const matched = terms.filter((term) => text.includes(term))
  const title = candidate.title.normalize('NFKC').toLocaleLowerCase('en-US')
  const titleMatches = matched.filter((term) => title.includes(term)).length
  const ratio = matched.length / terms.length
  return {
    score: clamp(10 + ratio * 70 + Math.min(20, titleMatches * 5)),
    rationale: `Matched ${matched.length}/${terms.length} normalized question/query terms${matched.length ? `: ${matched.slice(0, 6).join(', ')}` : ''}.`,
  }
}

function requiredCategoryGroups(context: SourceQueryContext): ResearchSourceCategory[][] {
  const haystack = `${context.question} ${context.plannedQuery} ${context.intent ?? ''} ${(context.sourceTargets ?? []).join(' ')}`.toLocaleLowerCase('en-US')
  const groups: ResearchSourceCategory[][] = []
  if (context.needPrimarySource || /product|产品|capability|功能|technical|技术|pricing|定价/.test(haystack)) {
    groups.push(['company_official', 'product_documentation', 'pricing', 'investor_material'])
  }
  if (context.needQuantitativeEvidence || /market size|market data|市场规模|市场数据|统计/.test(haystack)) {
    groups.push(['official_statistics', 'industry_association', 'research_firm'])
  }
  return groups
}

function createRequirementDiagnostics(
  contexts: Readonly<Record<string, SourceQueryContext>>,
  selected: readonly CuratedResearchSource[],
): Record<string, QuestionSourceRequirementDiagnostic> {
  const categoriesByQuestion = new Map<string, Set<ResearchSourceCategory>>()
  for (const source of selected) {
    const questionId = contexts[source.queryId]?.questionId
    if (!questionId) continue
    const categories = categoriesByQuestion.get(questionId) ?? new Set<ResearchSourceCategory>()
    categories.add(source.sourceType)
    categoriesByQuestion.set(questionId, categories)
  }
  const result: Record<string, QuestionSourceRequirementDiagnostic> = {}
  for (const context of Object.values(contexts)) {
    const selectedCategories = [...(categoriesByQuestion.get(context.questionId) ?? new Set<ResearchSourceCategory>())]
    const groups = requiredCategoryGroups(context)
    const requiredCategories = [...new Set(groups.flat())]
    const missingCategories = groups.flatMap((group) => group.some((category) => selectedCategories.includes(category)) ? [] : group)
    result[context.questionId] = { requiredCategories, selectedCategories, missingCategories, satisfied: missingCategories.length === 0 }
  }
  return result
}

export class SourceCurator {
  private readonly maxSourcesPerDomain: number
  private readonly relevanceScorer?: SourceRelevanceScorer

  constructor(options: { maxSourcesPerDomain?: number; relevanceScorer?: SourceRelevanceScorer } = {}) {
    this.maxSourcesPerDomain = options.maxSourcesPerDomain ?? 2
    this.relevanceScorer = options.relevanceScorer
  }

  curate(
    run: ResearchRunDto,
    candidates: DiscoveredResearchSource[],
    options: { maxSources?: number; queryContexts?: Record<string, SourceQueryContext> } = {},
  ): SourceCurationResult {
    const rejected: RejectedResearchSource[] = []
    const byCanonicalUrl = new Set<string>()
    const normalized: Array<CuratedResearchSource & { ordinal: number }> = []
    const queryContexts = options.queryContexts ?? {}

    candidates.forEach((candidate, ordinal) => {
      let canonicalUrl: string
      try {
        canonicalUrl = canonicalizeResearchUrl(candidate.url)
      } catch {
        rejected.push({ ...candidate, reason: 'invalid_url' })
        return
      }
      if (byCanonicalUrl.has(canonicalUrl)) {
        rejected.push({ ...candidate, reason: 'duplicate', canonicalUrl })
        return
      }
      byCanonicalUrl.add(canonicalUrl)
      const url = new URL(canonicalUrl)
      const domain = url.hostname.replace(/^www\./, '')
      const context = queryContexts[candidate.queryId] ?? null
      const sourceType = classifySource(url, candidate)
      const semantic = this.relevanceScorer?.score({ run, candidate, context }) ?? null
      const relevance = semantic?.score ?? fallbackRelevance(candidate, context, domain).score
      const relevanceRationale = semantic?.rationale ?? fallbackRelevance(candidate, context, domain).rationale
      const scoreBreakdown: SourceScoreBreakdown = {
        relevance: clamp(relevance),
        authority: authorityFor(sourceType),
        categoryFit: profileFit(run, sourceType),
        recency: freshnessFor(candidate),
        independence: independenceFor(sourceType),
        fetchability: fetchabilityFor(sourceType),
        total: 0,
        relevanceMethod: semantic ? 'semantic' : 'keyword_fallback',
        rationale: [relevanceRationale, `Classified as ${sourceType}.`],
      }
      scoreBreakdown.total = clamp(
        scoreBreakdown.relevance * 0.44
        + scoreBreakdown.authority * 0.20
        + scoreBreakdown.categoryFit * 0.12
        + scoreBreakdown.recency * 0.08
        + scoreBreakdown.independence * 0.08
        + scoreBreakdown.fetchability * 0.08,
      )
      const diagnostics: SourceCurationDiagnostic = {
        relevanceFallback: !semantic,
        reasons: [...scoreBreakdown.rationale, semantic ? 'Used injected semantic relevance scorer.' : 'Embedding/lightweight scorer unavailable; used explainable keyword fallback.'],
      }
      const normalizedCandidate: CuratedResearchSource & { ordinal: number } = {
        ...candidate, canonicalUrl, domain, sourceType, score: scoreBreakdown.total, scoreBreakdown, diagnostics, ordinal,
      }
      if (sourceType === 'low_quality_or_unavailable') {
        rejected.push({ ...normalizedCandidate, reason: 'quality_insufficient' })
        return
      }
      if (scoreBreakdown.relevance < MINIMUM_RELEVANCE_SCORE) {
        rejected.push({ ...normalizedCandidate, reason: 'not_relevant' })
        return
      }
      normalized.push(normalizedCandidate)
    })

    const remainingNormalizedSources = Math.max(0, run.budget.maxNormalizedSources - run.usage.normalizedSources)
    const reservationCap = options.maxSources === undefined ? remainingNormalizedSources : Math.max(0, Math.floor(options.maxSources))
    const sourceBudget = Math.min(remainingNormalizedSources, reservationCap)
    const selected: CuratedResearchSource[] = []
    const domainCounts = new Map<string, number>()
    for (const candidate of normalized.sort((left, right) => right.score - left.score || left.ordinal - right.ordinal)) {
      if (selected.length >= sourceBudget) {
        rejected.push({ ...candidate, reason: 'budget_cap' })
        continue
      }
      const count = domainCounts.get(candidate.domain) ?? 0
      if (count >= this.maxSourcesPerDomain) {
        rejected.push({ ...candidate, reason: 'domain_cap' })
        continue
      }
      domainCounts.set(candidate.domain, count + 1)
      const { ordinal: _ordinal, ...selectedCandidate } = candidate
      selected.push(selectedCandidate)
    }

    return { selected, rejected, diagnostics: { questionRequirements: createRequirementDiagnostics(queryContexts, selected) } }
  }
}
