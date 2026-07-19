import type { JsonObject } from '@shared/deepresearch/contracts'

export const SOURCE_CONTENT_PARSER_VERSION = 'deepresearch-main-content-v2'
export const MINIMUM_MAIN_CONTENT_CHARACTERS = 200

export type SourceContentRejectionReason =
  | 'captcha'
  | 'login_required'
  | 'paywall'
  | 'robots_denied'
  | 'error_page'
  | 'navigation_heavy'
  | 'too_short'
  | 'needs_rendering'
  | 'unsupported_pdf'

export interface SourceContentDiagnostics {
  parser: string
  rawCharacters: number
  mainCharacters: number
  paragraphCount: number
  contentDensity: number
  navigationRatio: number
  duplicateTextRatio: number
  language: 'zh' | 'en' | 'mixed' | 'unknown'
  readability: number
  rendered: boolean | null
  rejectionReasons: SourceContentRejectionReason[]
}

export interface MainContentExtraction {
  content: string
  metadata: JsonObject
  diagnostics: SourceContentDiagnostics
  rejectionReasons: SourceContentRejectionReason[]
}

export interface MainContentExtractionInput {
  text: string
  finalUrl: string
  title?: string | null
  byline?: string | null
  publishedAt?: string | number | null
  canonicalUrl?: string | null
  rendered?: boolean | null
}

const BLOCK_TAGS = /<\/?(?:article|main|section|p|div|li|h[1-6]|blockquote|pre|tr|br|hr)\b[^>]*>/gi
const BOILERPLATE_TAGS = /<(?:script|style|noscript|template|svg|canvas|iframe|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg|canvas|iframe|nav|header|footer|aside|form)>/gi
const TAGS = /<[^>]+>/g
const NAVIGATION_LINE = /^(?:home|menu|navigation|search|subscribe|sign in|log in|login|privacy(?: policy)?|terms(?: of (?:use|service))?|cookie(?: settings)?|contact|about|share|follow us|skip to (?:content|main content)|首页|菜单|导航|搜索|登录|注册|订阅|隐私(?:政策)?|服务条款|联系我们|返回顶部)$/i
const CAPTCHA = /(?:captcha|recaptcha|hcaptcha|verify you(?:'|’)re human|security check|人机验证|验证码)/i
const LOGIN = /(?:sign in to continue|log in to continue|login required|create an account to continue|请登录(?:后)?(?:查看|继续)|登录后(?:查看|继续))/i
const PAYWALL = /(?:subscribe to continue|subscription required|sign in to read|this content is for subscribers|purchase to continue|付费(?:阅读|订阅)|订阅后(?:查看|阅读)|会员专享)/i
const ROBOTS = /(?:robots\.txt|access denied by robots|automated access|bot (?:access )?(?:denied|blocked)|crawl(?:er)? (?:denied|blocked))/i
const ERROR_PAGE = /(?:^|\b)(?:404|410|500|502|503|504)(?:\b|$)|(?:page not found|not found|access denied|something went wrong|internal server error|服务不可用|页面不存在|访问被拒绝)/i
const NEEDS_RENDERING = /(?:enable javascript|javascript (?:is )?required|turn on javascript|requires javascript|please wait while (?:we )?load|正在加载(?:中)?|请开启(?:浏览器)?javascript)/i

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_match, hex, decimal) => {
      const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    })
}

function normalizeText(value: string): string {
  return decodeEntities(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\t \f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function htmlToText(value: string, removeBoilerplate: boolean): string {
  const html = removeBoilerplate ? value.replace(BOILERPLATE_TAGS, '\n') : value
  return normalizeText(
    html
      .replace(BLOCK_TAGS, '\n')
      .replace(TAGS, ' '),
  )
}

function looksLikeHtml(value: string): boolean {
  return /<(?:html|body|article|main|p|div|nav|header|footer|section)\b/i.test(value)
}

function splitParagraphs(value: string, deduplicate = true): string[] {
  const initial = normalizeText(value).split(/\n{2,}/).flatMap((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    return lines.length > 1 && lines.every((line) => line.length < 180) ? lines : [block.trim()]
  })
  const paragraphs: string[] = []
  const seen = new Set<string>()
  for (const paragraph of initial) {
    const normalized = paragraph.replace(/\s+/g, ' ').trim()
    if (!normalized || NAVIGATION_LINE.test(normalized)) continue
    const key = normalized.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
    if (key.length > 24 && deduplicate && seen.has(key)) continue
    if (key.length > 24) seen.add(key)
    paragraphs.push(normalized)
  }
  return paragraphs
}

function duplicateTextRatio(paragraphs: readonly string[]): number {
  const seen = new Set<string>()
  let total = 0
  let duplicate = 0
  for (const paragraph of paragraphs) {
    const key = paragraph.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
    total += paragraph.length
    if (key.length > 24 && seen.has(key)) duplicate += paragraph.length
    else if (key.length > 24) seen.add(key)
  }
  return total === 0 ? 0 : round(duplicate / total)
}

function detectLanguage(content: string): SourceContentDiagnostics['language'] {
  const han = (content.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (content.match(/[A-Za-z]/g) ?? []).length
  if (han + latin < 24) return 'unknown'
  if (han > latin * 1.8) return 'zh'
  if (latin > han * 1.8) return 'en'
  return 'mixed'
}

function readabilityScore(content: string, paragraphs: readonly string[], language: SourceContentDiagnostics['language']): number {
  const sentences = content.split(/[.!?。！？]+/).map((value) => value.trim()).filter((value) => value.length >= 8)
  const averageSentenceLength = content.length / Math.max(1, sentences.length)
  const sentenceScore = averageSentenceLength >= 20 && averageSentenceLength <= 360 ? 1 : averageSentenceLength < 12 || averageSentenceLength > 700 ? 0.25 : 0.65
  const lengthScore = clamp(content.length / 1_500)
  const paragraphScore = clamp(paragraphs.length / 6)
  const languageScore = language === 'unknown' ? 0.25 : 1
  return Math.round(100 * (0.35 * lengthScore + 0.3 * sentenceScore + 0.2 * paragraphScore + 0.15 * languageScore))
}

function parsePublishedAt(value: MainContentExtractionInput['publishedAt']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function classifyText(value: string, rendered: boolean | null | undefined): SourceContentRejectionReason | null {
  if (CAPTCHA.test(value)) return 'captcha'
  if (LOGIN.test(value)) return 'login_required'
  if (PAYWALL.test(value)) return 'paywall'
  if (ROBOTS.test(value)) return 'robots_denied'
  if (ERROR_PAGE.test(value)) return 'error_page'
  if (rendered !== true && NEEDS_RENDERING.test(value)) return 'needs_rendering'
  return null
}

export function classifySourceFetchFailure(message: string, finalUrl?: string): SourceContentRejectionReason | null {
  if (/\.pdf(?:$|[?#])/i.test(finalUrl ?? '')) return 'unsupported_pdf'
  if (ROBOTS.test(message) || /\b403\b/.test(message)) return 'robots_denied'
  if (/\b401\b/.test(message) || LOGIN.test(message)) return 'login_required'
  if (/\b402\b/.test(message) || PAYWALL.test(message)) return 'paywall'
  if (/\b404\b|\b410\b|\b5\d\d\b/.test(message) || ERROR_PAGE.test(message)) return 'error_page'
  return null
}

function listSummary(value: string): JsonObject {
  const items = [...value.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => htmlToText(match[1], false).replace(/\n+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20)
  return { itemCount: items.length, items }
}

function tableSummary(value: string): JsonObject {
  const rows = [...value.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => htmlToText(match[1], false).replace(/\n+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20)
  return { rowCount: rows.length, rows }
}

export function extractMainContent(input: MainContentExtractionInput): MainContentExtraction {
  const raw = normalizeText(input.text)
  const rawText = looksLikeHtml(raw) ? htmlToText(raw, false) : raw
  const candidate = looksLikeHtml(raw) ? htmlToText(raw, true) : raw
  const rawParagraphs = splitParagraphs(candidate, false)
  const allParagraphs = splitParagraphs(candidate)
  const duplicateRatio = duplicateTextRatio(rawParagraphs)
  const content = allParagraphs.join('\n\n')
  let nextOffset = 0
  const paragraphs = allParagraphs.map((text, ordinal) => {
    const startOffset = nextOffset
    nextOffset += text.length + 2
    return { ordinal, startOffset, endOffset: startOffset + text.length }
  })
  const navigationRatio = rawText.length === 0 ? 1 : round(clamp(1 - content.length / rawText.length))
  const density = rawText.length === 0 ? 0 : round(clamp(content.length / rawText.length))
  const language = detectLanguage(content)
  const readability = readabilityScore(content, allParagraphs, language)
  const reasons: SourceContentRejectionReason[] = []
  const pageReason = classifyText(rawText, input.rendered)
  if (pageReason) reasons.push(pageReason)
  if (!pageReason && content.length < MINIMUM_MAIN_CONTENT_CHARACTERS) reasons.push('too_short')
  if (!pageReason && navigationRatio >= 0.75) reasons.push('navigation_heavy')
  if (!pageReason && duplicateRatio >= 0.5) reasons.push('navigation_heavy')
  const diagnostics: SourceContentDiagnostics = {
    parser: SOURCE_CONTENT_PARSER_VERSION,
    rawCharacters: rawText.length,
    mainCharacters: content.length,
    paragraphCount: paragraphs.length,
    contentDensity: density,
    navigationRatio,
    duplicateTextRatio: duplicateRatio,
    language,
    readability,
    rendered: input.rendered ?? null,
    rejectionReasons: reasons,
  }
  return {
    content,
    metadata: {
      title: input.title?.trim() || '',
      byline: input.byline?.trim() || null,
      publishedAt: parsePublishedAt(input.publishedAt),
      canonicalUrl: input.canonicalUrl?.trim() || input.finalUrl,
      paragraphs,
      lists: listSummary(raw),
      tables: tableSummary(raw),
      offsetUnit: 'utf16_code_unit',
      extraction: { ...diagnostics },
    },
    diagnostics,
    rejectionReasons: reasons,
  }
}