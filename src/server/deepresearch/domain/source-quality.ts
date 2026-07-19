export const SOURCE_QUALITY_SCORING_VERSION = 'v1' as const

export const SOURCE_CATEGORIES = [
  'company-official-site',
  'product-documentation',
  'pricing',
  'customer-case',
  'investor-material',
  'official-statistics',
  'industry-association',
  'research-institute',
  'peer-reviewed',
  'news-secondary',
  'directory-aggregator',
  'low-quality-unavailable',
] as const

export type SourceCategory = typeof SOURCE_CATEGORIES[number]
export type SourceRejectionReason = 'invalid_url' | 'unavailable' | 'not_relevant' | 'low_quality'
export type SourceScoringMethod = 'keyword-fallback'

export interface CandidateSourceQualityInput {
  question: string
  plannedQuery: string
  sourceTargets?: readonly string[]
  url: string
  domain?: string
  title: string
  snippet: string
  publishedAt?: number | null
  existingDomains?: readonly string[]
  assessedAt?: number
}

export interface CandidateSourceQualityAssessment {
  version: typeof SOURCE_QUALITY_SCORING_VERSION
  category: SourceCategory
  scoringMethod: SourceScoringMethod
  diagnostics: readonly ['SOURCE_RELEVANCE_KEYWORD_FALLBACK']
  scores: {
    relevance: number
    authority: number
    recency: number
    independence: number
    fetchability: number
    final: number
  }
  reasons: string[]
  rejectionReasons: SourceRejectionReason[]
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'does', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'provide', 'the', 'to', 'what', 'with',
  '产品', '什么', '以及', '有关', '市场',
])
const NEWS_HOST_PARTS = new Set(['news', 'press', 'media'])
const DIRECTORY_HOST_PARTS = new Set(['wikipedia', 'linkedin', 'crunchbase', 'zoominfo', 'g2', 'capterra', 'yelp'])
const RESEARCH_HOST_PARTS = ['oecd', 'worldbank', 'imf', 'nber', 'brookings', 'mckinsey', 'gartner', 'forrester'] as const
const ASSOCIATION_HOST_PARTS = ['association', 'society', 'federation', 'chamber'] as const
const PEER_REVIEW_HOST_PARTS = ['doi', 'pubmed', 'nature', 'science', 'springer', 'ieee', 'acm', 'elsevier', 'wiley', 'jstor'] as const
const CATEGORY_AUTHORITY_BASE: Readonly<Record<SourceCategory, number>> = {
  'company-official-site': 0.56,
  'product-documentation': 0.68,
  pricing: 0.64,
  'customer-case': 0.58,
  'investor-material': 0.78,
  'official-statistics': 0.9,
  'industry-association': 0.74,
  'research-institute': 0.76,
  'peer-reviewed': 0.86,
  'news-secondary': 0.42,
  'directory-aggregator': 0.22,
  'low-quality-unavailable': 0.04,
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1_000) / 1_000))
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function hostParts(host: string): string[] {
  return normalize(host).replace(/^www\./, '').split('.').filter(Boolean)
}

function rootDomain(host: string): string {
  const parts = hostParts(host)
  return parts.slice(-2).join('.') || normalize(host)
}

function safeUrl(value: string): URL | null {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null
  } catch {
    return null
  }
}

function textTokens(value: string): Set<string> {
  const normalized = normalize(value)
  const tokens = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []
  return new Set(tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token)))
}

function overlapRatio(target: ReadonlySet<string>, candidate: ReadonlySet<string>): number {
  if (target.size === 0) return 0
  let matched = 0
  for (const term of target) {
    if (candidate.has(term)) matched += 1
  }
  return matched / target.size
}

function targetSupportsCategory(sourceTargets: readonly string[], category: SourceCategory): boolean {
  const targets = normalize(sourceTargets.join(' '))
  if (!targets) return false
  if (category === 'product-documentation') return /documentation|docs|官方文档/.test(targets)
  if (category === 'pricing') return /pricing|price|定价/.test(targets)
  if (category === 'customer-case') return /customer|case study|客户案例/.test(targets)
  if (category === 'investor-material') return /investor|filing|投资者|财报/.test(targets)
  if (category === 'official-statistics') return /official statistics|government|官方统计|政府/.test(targets)
  if (category === 'industry-association') return /association|协会/.test(targets)
  if (category === 'research-institute') return /research institute|研究机构/.test(targets)
  if (category === 'peer-reviewed') return /peer.reviewed|academic|同行评审|学术/.test(targets)
  return /official|primary|官网|一手/.test(targets)
}

export function classifyCandidateSource(input: Pick<CandidateSourceQualityInput, 'url' | 'domain' | 'title' | 'snippet' | 'sourceTargets'>): { category: SourceCategory; reasons: string[] } {
  const parsed = safeUrl(input.url)
  if (!parsed) return { category: 'low-quality-unavailable', reasons: ['The candidate URL is not a valid HTTP(S) address.'] }

  const host = normalize(input.domain || parsed.hostname).replace(/^www\./, '')
  const parts = hostParts(host)
  const path = normalize(parsed.pathname)
  const text = normalize(`${input.title} ${input.snippet}`)
  const sourceTargets = input.sourceTargets ?? []

  if (DIRECTORY_HOST_PARTS.has(parts[0] ?? '') || /directory|aggregator|listing|compare vendors/.test(text)) {
    return { category: 'directory-aggregator', reasons: ['The domain or content identifies the result as a directory or aggregator.'] }
  }
  if (/(^|\.)gov(\.|$)/.test(host) || parts.includes('gov') || /official statistics|statistical (?:release|dataset)|government dataset/.test(text)) {
    return { category: 'official-statistics', reasons: ['Government/statistical publication signals were found in the domain or result text.'] }
  }
  if (/investors?|annual[-_/ ]report|earnings|10-[kq]|sec[-_/ ]filing/.test(`${path} ${text}`)) {
    return { category: 'investor-material', reasons: ['Investor-relations or regulatory filing signals were found.'] }
  }
  if (/case[-_/ ]stud(?:y|ies)|customer[-_/ ]stor(?:y|ies)|customers?\//.test(`${path} ${text}`)) {
    return { category: 'customer-case', reasons: ['Customer-case signals were found in the URL or result text.'] }
  }
  if (/pricing|plans|price-list|packages/.test(`${path} ${text}`)) {
    return { category: 'pricing', reasons: ['Pricing or plan signals were found in the URL or result text.'] }
  }
  if (/docs?|documentation|developers?|api-reference|knowledge-base/.test(`${path} ${text}`)) {
    return { category: 'product-documentation', reasons: ['Product documentation signals were found in the URL or result text.'] }
  }
  if (PEER_REVIEW_HOST_PARTS.some((part) => parts.includes(part)) || /peer[- ]reviewed|journal article|conference paper|doi:/.test(text)) {
    return { category: 'peer-reviewed', reasons: ['Peer-reviewed publication signals were found.'] }
  }
  if (ASSOCIATION_HOST_PARTS.some((part) => parts.includes(part)) || /industry association|trade association/.test(text)) {
    return { category: 'industry-association', reasons: ['Industry-association signals were found.'] }
  }
  if (RESEARCH_HOST_PARTS.some((part) => parts.includes(part)) || /research institute|research center|methodology report/.test(text)) {
    return { category: 'research-institute', reasons: ['Research-institute or methodology signals were found.'] }
  }
  if (NEWS_HOST_PARTS.has(parts[0] ?? '') || (!targetSupportsCategory(sourceTargets, 'company-official-site') && /news roundup|breaking news|press coverage/.test(text))) {
    return { category: 'news-secondary', reasons: ['News or secondary-reporting signals were found.'] }
  }
  if (targetSupportsCategory(sourceTargets, 'company-official-site')) {
    return { category: 'company-official-site', reasons: ['The result is treated as a company official source because the planned query requests primary or official material.'] }
  }
  return { category: 'company-official-site', reasons: ['No stronger category signal was found; the result is classified as a company official site provisionally.'] }
}

function scoreRelevance(input: CandidateSourceQualityInput, parsed: URL | null): { score: number; reasons: string[] } {
  const questionTokens = textTokens(input.question)
  const queryTokens = textTokens(input.plannedQuery)
  const targetTokens = new Set([...questionTokens, ...queryTokens])
  const titleTokens = textTokens(input.title)
  const snippetTokens = textTokens(input.snippet)
  const domainTokens = textTokens((input.domain || parsed?.hostname || '').replace(/[.-]/g, ' '))
  const titleOverlap = overlapRatio(questionTokens, titleTokens) * 0.35 + overlapRatio(queryTokens, titleTokens) * 0.65
  const snippetOverlap = overlapRatio(questionTokens, snippetTokens) * 0.35 + overlapRatio(queryTokens, snippetTokens) * 0.65
  const domainOverlap = overlapRatio(targetTokens, domainTokens)
  const sourceTargetOverlap = overlapRatio(textTokens((input.sourceTargets ?? []).join(' ')), new Set([...titleTokens, ...snippetTokens, ...domainTokens]))
  const candidateText = normalize(`${input.title} ${input.snippet}`)
  const phraseBonus = [...targetTokens].some((token) => token.length >= 4 && candidateText.includes(token)) ? 0.08 : 0
  const score = clamp(titleOverlap * 0.46 + snippetOverlap * 0.43 + domainOverlap * 0.03 + sourceTargetOverlap * 0.12 + phraseBonus)
  const reasons = score >= 0.25
    ? [`Keyword/entity overlap with the question and planned query is ${(score * 100).toFixed(0)}%.`]
    : [`Keyword/entity overlap with the question and planned query is only ${(score * 100).toFixed(0)}%.`]
  return { score, reasons }
}

function scoreAuthority(category: SourceCategory, input: CandidateSourceQualityInput): { score: number; reasons: string[] } {
  const text = normalize(`${input.title} ${input.snippet} ${input.url}`)
  let score = CATEGORY_AUTHORITY_BASE[category]
  const reasons = [`Base authority reflects the classified source category: ${category}.`]
  for (const signal of ['official', 'audited', 'annual report', 'methodology', 'dataset', 'regulatory', 'peer-reviewed']) {
    if (text.includes(signal)) {
      score += 0.045
      reasons.push(`Authority signal detected: ${signal}.`)
    }
  }
  if (/blog|roundup|marketing|sponsored|opinion/.test(text)) {
    score -= 0.12
    reasons.push('Promotional or opinion-style wording reduces authority.')
  }
  if (targetSupportsCategory(input.sourceTargets ?? [], category)) {
    score += 0.04
    reasons.push('The classified category satisfies a planned source target.')
  }
  return { score: clamp(score), reasons }
}

function scoreRecency(publishedAt: number | null | undefined, assessedAt: number): { score: number; reasons: string[] } {
  if (!publishedAt || !Number.isFinite(publishedAt)) return { score: 0.5, reasons: ['Publication date is unavailable; recency is scored as unknown.'] }
  const ageDays = Math.max(0, (assessedAt - publishedAt) / 86_400_000)
  const score = ageDays <= 365 ? 1 : ageDays <= 365 * 3 ? 0.75 : ageDays <= 365 * 5 ? 0.5 : 0.2
  return { score, reasons: [`Publication age is ${Math.floor(ageDays)} days.`] }
}

function scoreIndependence(domain: string, existingDomains: readonly string[]): { score: number; reasons: string[] } {
  const normalizedDomain = rootDomain(domain)
  if (!normalizedDomain) return { score: 0.3, reasons: ['The candidate domain is unavailable, so independence cannot be established.'] }
  const seen = new Set(existingDomains.map(rootDomain).filter(Boolean))
  if (seen.has(normalizedDomain)) return { score: 0.2, reasons: [`The domain ${normalizedDomain} is already represented by another candidate.`] }
  return { score: seen.size === 0 ? 0.8 : 1, reasons: [`The domain ${normalizedDomain} adds an independent source domain.`] }
}

function scoreFetchability(parsed: URL | null): { score: number; reasons: string[] } {
  if (!parsed) return { score: 0, reasons: ['The candidate cannot be fetched because its URL is invalid or uses an unsafe protocol.'] }
  if (parsed.hostname === 'localhost' || /^127(?:\.\d{1,3}){3}$/.test(parsed.hostname)) {
    return { score: 0, reasons: ['The candidate URL points to a local address and is not fetchable by research retrieval.'] }
  }
  return { score: 1, reasons: ['The candidate has a fetchable HTTP(S) URL.'] }
}

export function assessCandidateSourceQuality(input: CandidateSourceQualityInput): CandidateSourceQualityAssessment {
  const parsed = safeUrl(input.url)
  const classification = classifyCandidateSource(input)
  const relevance = scoreRelevance(input, parsed)
  const authority = scoreAuthority(classification.category, input)
  const recency = scoreRecency(input.publishedAt, input.assessedAt ?? Date.now())
  const independence = scoreIndependence(input.domain || parsed?.hostname || '', input.existingDomains ?? [])
  const fetchability = scoreFetchability(parsed)
  const final = Math.round(100 * (
    relevance.score * 0.42
    + authority.score * 0.23
    + recency.score * 0.1
    + independence.score * 0.13
    + fetchability.score * 0.12
  ))
  const rejectionReasons: SourceRejectionReason[] = []
  if (!parsed) rejectionReasons.push('invalid_url')
  if (fetchability.score === 0 && parsed) rejectionReasons.push('unavailable')
  if (relevance.score < 0.25) rejectionReasons.push('not_relevant')
  if (final < 35 || classification.category === 'low-quality-unavailable') rejectionReasons.push('low_quality')

  return {
    version: SOURCE_QUALITY_SCORING_VERSION,
    category: classification.category,
    scoringMethod: 'keyword-fallback',
    diagnostics: ['SOURCE_RELEVANCE_KEYWORD_FALLBACK'],
    scores: {
      relevance: relevance.score,
      authority: authority.score,
      recency: recency.score,
      independence: independence.score,
      fetchability: fetchability.score,
      final,
    },
    reasons: [...classification.reasons, ...relevance.reasons, ...authority.reasons, ...recency.reasons, ...independence.reasons, ...fetchability.reasons],
    rejectionReasons,
  }
}