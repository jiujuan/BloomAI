import { createHash } from 'node:crypto'
import type { ResearchQuestionDto, ResearchRunDto } from '@shared/deepresearch/contracts'

export const RESEARCH_QUERY_INTENTS = [
  'definition',
  'product_capability',
  'technical_architecture',
  'customer_case',
  'market_data',
  'primary_source',
  'counterevidence',
  'recent_update',
] as const

export type ResearchQueryIntent = typeof RESEARCH_QUERY_INTENTS[number]

export interface PlannedTopicQuery {
  questionId: string
  query: string
  intent: ResearchQueryIntent
  sourceTargets: string[]
  dedupeKey: string
}

const PUNCTUATION_OR_SYMBOLS = /[\p{P}\p{S}]+/gu
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'with', 'on', 'about', 'what', 'how', 'is', 'are'])

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

function containsAny(value: string, words: readonly string[]): boolean {
  const normalized = value.toLocaleLowerCase('en-US')
  return words.some((word) => normalized.includes(word.toLocaleLowerCase('en-US')))
}

function targetFor(question: ResearchQuestionDto, intent: ResearchQueryIntent): string[] {
  const targets = question.sourceTargets?.filter(Boolean) ?? []
  const byIntent: Record<ResearchQueryIntent, readonly string[]> = {
    definition: ['authoritative', '官方', '标准', 'reference', '定义'],
    product_capability: ['product', '产品', 'documentation', '文档', '官网'],
    technical_architecture: ['technical', '技术', 'architecture', '架构', 'documentation', '文档'],
    customer_case: ['customer', '客户', 'case', '案例', 'buyer', '买方'],
    market_data: ['market', '市场', 'research', '研究', '统计', 'association', '协会', '官方'],
    primary_source: ['primary', '一手', 'official', '官方', 'documentation', '文档'],
    counterevidence: ['independent', '独立', 'research', '研究', 'review', '评测'],
    recent_update: ['recent', '最新', 'news', '新闻', 'release', '发布'],
  }
  const matching = targets.filter((target) => containsAny(target, byIntent[intent]))
  if (matching.length > 0) return matching
  return targets.length > 0 ? targets.slice(0, 2) : defaultSourceTargets(intent, containsCjk(question.question))
}

function defaultSourceTargets(intent: ResearchQueryIntent, chinese: boolean): string[] {
  const targets: Record<ResearchQueryIntent, string[]> = chinese
    ? {
        definition: ['官方定义或标准'], product_capability: ['公司官网与产品文档'], technical_architecture: ['技术文档与开发者资料'],
        customer_case: ['客户案例与采购方资料'], market_data: ['研究机构、行业协会或官方统计'], primary_source: ['官方一手资料'],
        counterevidence: ['独立研究与可信行业媒体'], recent_update: ['近期官方发布与更新日志'],
      }
    : {
        definition: ['authoritative definitions or standards'], product_capability: ['company websites and product documentation'], technical_architecture: ['technical documentation and developer materials'],
        customer_case: ['customer cases and buyer materials'], market_data: ['research firms, associations, or official statistics'], primary_source: ['official primary sources'],
        counterevidence: ['independent research and credible trade media'], recent_update: ['recent official releases and changelogs'],
      }
  return targets[intent]
}

function siteConstraint(intent: ResearchQueryIntent, topic: string, targets: readonly string[]): string {
  if (intent !== 'market_data' && intent !== 'primary_source') return ''
  const chinese = containsCjk(topic) || targets.some(containsCjk)
  if (intent === 'market_data' && targets.some((target) => containsAny(target, ['官方', '统计', 'official', 'statistic']))) {
    return chinese ? ' site:gov.cn' : ' site:gov'
  }
  return ''
}

function queryText(topic: string, intent: ResearchQueryIntent, targets: readonly string[]): string {
  const chinese = containsCjk(topic)
  const phrasing: Record<ResearchQueryIntent, string> = chinese
    ? {
        definition: '定义 范围 官方资料', product_capability: '产品功能 能力 官方文档', technical_architecture: '技术架构 集成 数据流程 技术文档',
        customer_case: '客户案例 使用场景 买方实践', market_data: '市场规模 增长 数据 行业报告', primary_source: '官方公告 原始资料',
        counterevidence: '局限 风险 替代方案 独立评测', recent_update: '最新发布 更新 近一年',
      }
    : {
        definition: 'definition scope authoritative source', product_capability: 'product capabilities official documentation', technical_architecture: 'technical architecture integrations data flow documentation',
        customer_case: 'customer case study buyer use case', market_data: 'market size growth data industry report', primary_source: 'official announcement primary source',
        counterevidence: 'limitations risks alternatives independent review', recent_update: 'recent update release last year',
      }
  return `${topic} ${phrasing[intent]}${siteConstraint(intent, topic, targets)}`.trim()
}

export function normalizeQueryForDedupe(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(PUNCTUATION_OR_SYMBOLS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function createQueryDedupeKey(query: string): string {
  return 'query-dedupe:v1:' + createHash('sha256').update(normalizeQueryForDedupe(query)).digest('hex')
}

function tokenSet(query: string): Set<string> {
  const normalized = normalizeQueryForDedupe(query)
  const words = normalized.split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word))
  const cjkCharacters = [...normalized].filter((character) => /[\u3400-\u9fff]/u.test(character))
  return new Set([...words, ...cjkCharacters])
}

function lexicalSimilarity(left: string, right: string): number {
  const leftTokens = tokenSet(left)
  const rightTokens = tokenSet(right)
  const union = new Set([...leftTokens, ...rightTokens])
  if (union.size === 0) return 1
  let overlap = 0
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1
  return overlap / union.size
}

/** Removes exact and near lexical duplicates for the same question and search intent. */
export function dedupeResearchQueryPlans<T extends PlannedTopicQuery>(plans: readonly T[]): T[] {
  const deduped: T[] = []
  for (const plan of plans) {
    const normalized = { ...plan, query: plan.query.trim(), dedupeKey: createQueryDedupeKey(plan.query) } as T
    if (!normalized.query) continue
    const duplicate = deduped.some((existing) => (
      existing.questionId === normalized.questionId
      && existing.intent === normalized.intent
      && (existing.dedupeKey === normalized.dedupeKey || lexicalSimilarity(existing.query, normalized.query) >= 0.9)
    ))
    if (!duplicate) deduped.push(normalized)
  }
  return deduped
}

function relevantIntents(question: ResearchQuestionDto): ResearchQueryIntent[] {
  const content = [question.question, question.intent, question.questionType ?? '', ...(question.sourceTargets ?? [])].join(' ')
  const intents: ResearchQueryIntent[] = []
  if (containsAny(content, ['product', '产品', 'capability', '功能', '官网', '文档'])) intents.push('product_capability')
  if (containsAny(content, ['technical', '技术', 'architecture', '架构', 'integration', '集成'])) intents.push('technical_architecture')
  if (containsAny(content, ['customer', '客户', 'case', '案例', 'buyer', '买方', '场景'])) intents.push('customer_case')
  if (question.needQuantitativeEvidence || containsAny(content, ['market', '市场', 'size', '规模', 'growth', '增长', 'data', '数据'])) intents.push('market_data')
  if (question.priority === 'high' || question.priority === 'critical' || containsAny(content, ['risk', '风险', 'limit', '限制', 'disagree', '争议'])) intents.push('counterevidence')
  if (question.needPrimarySource && intents.length < 2) intents.push('primary_source')
  if (question.needRecentSource && intents.length < 2) intents.push('recent_update')
  if (intents.length < 2) intents.unshift('definition')
  if (intents.length < 2) intents.push('primary_source')
  return [...new Set(intents)].slice(0, 5)
}

/** Deterministic fallback for tests and legacy planners; production LLM plans use the same contract. */
export function createTopicBoundQueryPlans(run: ResearchRunDto, question: ResearchQuestionDto): PlannedTopicQuery[] {
  return dedupeResearchQueryPlans(relevantIntents(question).map((intent) => {
    const sourceTargets = targetFor(question, intent)
    const query = queryText(run.topic, intent, sourceTargets)
    return { questionId: question.id, query, intent, sourceTargets, dedupeKey: createQueryDedupeKey(query) }
  }))
}

const GAP_LANGUAGE: Record<string, string> = {
  primary_source: '可直接引用的官方一手资料',
  independent_source: '独立且可信的来源',
  recent_update: '近期更新或最新变化的资料',
  market_data: '可核查的市场数据或统计',
  counterevidence: '独立的限制、风险或反证资料',
}

/** Converts coverage diagnostics into a safe search brief rather than leaking internal policy labels. */
export function rewriteCoverageGapAsSearchBrief(input: {
  question: ResearchQuestionDto
  gap: string
  recommendedSearchIntent?: string | null
}): string {
  const intent = input.recommendedSearchIntent?.trim().toLocaleLowerCase('en-US') ?? ''
  const need = GAP_LANGUAGE[intent] ?? '能够补足当前证据缺口的可核查资料'
  const chinese = containsCjk(input.question.question)
  return chinese
    ? `寻找${need}，直接回答：${input.question.question}`
    : `Find ${need} that directly answers: ${input.question.question}`
}

function lower(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase('en-US') ?? ''
}

/** Maps coverage-policy diagnostics to a stable public query intent without exposing policy text to search. */
export function queryIntentForCoverageGap(gap: string, recommendedSearchIntent?: string | null): ResearchQueryIntent {
  const diagnostic = `${lower(gap)} ${lower(recommendedSearchIntent)}`
  if (/(primary|official|一手|官方|search_primary)/u.test(diagnostic)) return 'primary_source'
  if (/(recent|latest|更新|最新|release|新闻)/u.test(diagnostic)) return 'recent_update'
  if (/(market|data|statistic|quantitative|市场|数据|统计)/u.test(diagnostic)) return 'market_data'
  if (/(counter|contradic|risk|limit|independent|反证|风险|独立|限制)/u.test(diagnostic)) return 'counterevidence'
  if (/(customer|case|客户|案例|buyer|采购)/u.test(diagnostic)) return 'customer_case'
  if (/(technical|architecture|技术|架构|integration|集成)/u.test(diagnostic)) return 'technical_architecture'
  if (/(product|capabilit|产品|功能|documentation|文档)/u.test(diagnostic)) return 'product_capability'
  return 'definition'
}

/** Builds a gap-fill plan from an explicit search brief rather than serializing coverage diagnostics into a query. */
export function createGapQueryPlan(
  run: ResearchRunDto,
  question: ResearchQuestionDto,
  gap: string,
  recommendedSearchIntent?: string | null,
): PlannedTopicQuery {
  const intent = queryIntentForCoverageGap(gap, recommendedSearchIntent)
  const sourceTargets = targetFor(question, intent)
  const searchBrief = rewriteCoverageGapAsSearchBrief({ question, gap, recommendedSearchIntent })
  const query = `${queryText(run.topic, intent, sourceTargets)} ${searchBrief}`.trim()
  return { questionId: question.id, query, intent, sourceTargets, dedupeKey: createQueryDedupeKey(query) }
}
