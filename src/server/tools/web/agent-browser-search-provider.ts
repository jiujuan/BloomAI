import { htmlToText, stripTags } from '../utils/html'
import { AgentBrowserProvider } from './agent-browser-provider'
import { getWebBrowserConfig } from './config'
import { WebSearchSerpBlockedError } from './search-provider-router'
import type {
  WebLoadedPage,
  WebSearchOutput,
  WebSearchProvider,
  WebSearchRequest,
} from './contracts'

export type AgentBrowserSearchProviderOptions = {
  browserProvider?: Pick<AgentBrowserProvider, 'load' | 'close'>
  allowedSearchHosts?: readonly string[]
  locale?: string
  maxResults?: number
}

export class AgentBrowserSearchProvider implements WebSearchProvider {
  readonly id = 'agent_browser_serp' as const
  private readonly browserProvider: Pick<AgentBrowserProvider, 'load' | 'close'>
  private readonly allowedSearchHosts: readonly string[]
  private readonly locale: string
  private readonly maxResults: number

  constructor(options: AgentBrowserSearchProviderOptions = {}) {
    const config = getWebBrowserConfig()
    this.browserProvider = options.browserProvider ?? new AgentBrowserProvider({ config })
    this.allowedSearchHosts = normaliseHosts(options.allowedSearchHosts ?? config.allowedSearchHosts)
    this.locale = options.locale ?? config.searchLocale
    this.maxResults = Math.min(5, Math.max(1, options.maxResults ?? config.maxSearchResults))
  }

  async search(request: WebSearchRequest): Promise<WebSearchOutput> {
    throwIfAborted(request.signal)
    const limit = Math.min(this.maxResults, Math.max(1, Math.floor(request.limit)))
    const searchUrl = buildSearchUrl(this.allowedSearchHosts[0], request.query, this.locale, limit)
    const page = await this.browserProvider.load({
      url: searchUrl,
      render: true,
      timeoutMs: 15_000,
      signal: request.signal,
    })

    assertAllowedFinalUrl(page, this.allowedSearchHosts)
    const text = htmlToText(page.html)
    if (looksBlocked(text, page.html)) {
      throw new WebSearchSerpBlockedError('WEB_SEARCH_SERP_BLOCKED: CAPTCHA, login wall, or anti-automation page detected')
    }

    const results = extractSerpResults(page.html, page.finalUrl, this.allowedSearchHosts, limit)
    if (results.length === 0) {
      throw new WebSearchSerpBlockedError('WEB_SEARCH_SERP_BLOCKED: SERP page did not expose usable result links')
    }

    return {
      query: request.query,
      total: results.length,
      results,
      provider: this.id,
      fallbackFrom: request.fallbackFrom,
      fallbackReason: request.fallbackReason,
      diagnostics: page.diagnostics,
    }
  }

  async close(): Promise<void> {
    await this.browserProvider.close()
  }
}

function buildSearchUrl(host: string, query: string, locale: string, limit: number): string {
  const url = new URL(`https://${host}/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('num', String(limit))
  url.searchParams.set('hl', locale)
  return url.toString()
}

function assertAllowedFinalUrl(page: WebLoadedPage, allowedHosts: readonly string[]): void {
  let finalUrl: URL
  try {
    finalUrl = new URL(page.finalUrl)
  } catch {
    throw new WebSearchSerpBlockedError('WEB_SEARCH_SERP_BLOCKED: invalid SERP final URL')
  }
  if (finalUrl.protocol !== 'https:' || !allowedHosts.includes(finalUrl.hostname.toLowerCase())) {
    throw new WebSearchSerpBlockedError('WEB_SEARCH_SERP_BLOCKED: SERP navigation left the configured host')
  }
}

function extractSerpResults(
  html: string,
  baseUrl: string,
  allowedHosts: readonly string[],
  limit: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const seen = new Set<string>()
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorPattern.exec(html)) && results.length < limit) {
    const url = normaliseResultUrl(match[2], baseUrl, allowedHosts)
    if (!url || seen.has(url)) continue
    const inner = match[3]
    const title = extractTitle(inner)
    const text = htmlToText(inner)
    if (!title || text.length < 4) continue
    const snippet = text === title ? text : text.replace(title, '').trim().slice(0, 320)
    seen.add(url)
    results.push({ title, url, snippet: snippet || title })
  }
  return results
}

function extractTitle(html: string): string {
  const heading = html.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]
  return stripTags(heading ?? html).slice(0, 240)
}

function normaliseResultUrl(rawHref: string, baseUrl: string, allowedHosts: readonly string[]): string | null {
  const href = rawHref.replace(/&amp;/g, '&').trim()
  if (!href || href.startsWith('#') || /^(?:javascript|mailto|data|blob):/i.test(href)) return null

  let url: URL
  try {
    url = new URL(href, baseUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (allowedHosts.includes(url.hostname.toLowerCase())) return null
  url.username = ''
  url.password = ''
  return url.toString()
}

function normaliseHosts(hosts: readonly string[]): readonly string[] {
  const valid = hosts
    .map((host) => host.trim().toLowerCase())
    .filter((host) => /^[a-z0-9.-]+$/i.test(host) && host.length > 0)
  return valid.length > 0 ? valid : ['www.google.com']
}

function looksBlocked(text: string, html: string): boolean {
  const value = `${text}\n${html}`.toLowerCase()
  return /captcha|recaptcha|unusual traffic|are you a robot|verify you are human|access denied|robot check|sign in to continue|log in to continue/.test(value)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}
