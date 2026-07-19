import type { ToolExecutor } from './types'
import {
  extractMainHtml,
  extractMetaDescription,
  extractTitle,
  htmlToText,
  resolveUrl,
  stripTags,
} from './utils/html'
import { loadPage } from './utils/render'

type WebExtractInput = {
  url: string
  /** Max characters of main text to include (default 20000). */
  maxChars?: number
  /** Max number of links to return (default 50). */
  maxLinks?: number
  /** true = force JS rendering, false = static only, omitted = auto (render if thin). */
  render?: boolean
  /** Network timeout per attempt in ms (default 20000). */
  timeoutMs?: number
}

type ExtractedLink = { url: string; text: string }

type WebExtractOutput = {
  title: string
  description?: string
  finalUrl: string
  headings: string[]
  links: ExtractedLink[]
  text: string
  truncated: boolean
  rendered: boolean
  byline?: string
  publishedAt?: string
  canonicalUrl?: string
}

const DEFAULT_MAX_CHARS = 20000
const DEFAULT_MAX_LINKS = 50
const DEFAULT_MAX_HEADINGS = 40
const DEFAULT_TIMEOUT_MS = 20000

export const webExtractTool: ToolExecutor<WebExtractInput, WebExtractOutput> = async (input) => {
  const { url, maxChars = DEFAULT_MAX_CHARS, maxLinks = DEFAULT_MAX_LINKS, render, timeoutMs = DEFAULT_TIMEOUT_MS } = input

  const page = await loadPage(url, { render, timeoutMs })
  const { html, finalUrl } = page

  const title = extractTitle(html) || finalUrl
  const description = extractMetaDescription(html)
  const headings = extractHeadings(html)
  const links = extractLinks(html, finalUrl, maxLinks)
  const byline = extractMetadata(html, ['author', 'article:author', 'byline'])
  const publishedAt = extractMetadata(html, ['article:published_time', 'datepublished', 'publishdate', 'date'])
  const canonicalUrl = extractCanonicalUrl(html, finalUrl)

  let text = htmlToText(extractMainHtml(html))
  if (text.length < 200) text = htmlToText(html)
  const truncated = text.length > maxChars
  if (truncated) text = text.slice(0, maxChars)

  return {
    title,
    description: description || undefined,
    finalUrl,
    headings,
    links,
    text,
    truncated,
    rendered: page.rendered,
    byline: byline || undefined,
    publishedAt: publishedAt || undefined,
    canonicalUrl: canonicalUrl || undefined,
  }
}

function extractHeadings(html: string): string[] {
  const headings: string[] = []
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && headings.length < DEFAULT_MAX_HEADINGS) {
    const text = stripTags(m[2])
    if (text) headings.push(text)
  }
  return headings
}

function extractLinks(html: string, baseUrl: string, maxLinks: number): ExtractedLink[] {
  const links: ExtractedLink[] = []
  const seen = new Set<string>()
  // href in single or double quotes, tolerant of other attributes and nested tags.
  const re = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && links.length < maxLinks) {
    const rawHref = m[1].trim()
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) {
      continue
    }
    const abs = resolveUrl(baseUrl, rawHref)
    if (seen.has(abs)) continue
    seen.add(abs)
    links.push({ url: abs, text: stripTags(m[2]) })
  }
  return links
}

function extractMetadata(html: string, names: readonly string[]): string {
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    const name = attribute(tag, 'name') || attribute(tag, 'property') || attribute(tag, 'itemprop')
    if (name && wanted.has(name.toLowerCase())) return attribute(tag, 'content') || ''
  }
  return ''
}

function extractCanonicalUrl(html: string, baseUrl: string): string {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    const rel = attribute(tag, 'rel')
    const href = attribute(tag, 'href')
    if (rel?.split(/\s+/).some((value) => value.toLowerCase() === 'canonical') && href) return resolveUrl(baseUrl, href)
  }
  return baseUrl
}

function attribute(tag: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag)
  if (quoted) return stripTags(quoted[2]).trim()
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag)
  return unquoted ? stripTags(unquoted[1]).trim() : null
}
