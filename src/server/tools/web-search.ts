import { readConfigValue } from '../config/config'
import { AgentBrowserSearchProvider } from './web/agent-browser-search-provider'
import { createAnySearchSearchProvider } from './web/anysearch-search-provider'
import { getWebRoutingPolicy } from './web/config'
import type { WebSearchOutput, WebSearchRequest } from './web/contracts'
import { createSearchProviderRouter } from './web/search-provider-router'
import type { ToolExecutionContext, ToolExecutor } from './types'

type WebSearchInput = {
  query: string
  limit?: number
  tag?: string
  zone?: 'cn' | 'intl'
  language?: string
  params?: Record<string, unknown>
  format?: 'json' | 'markdown'
}
export type { WebSearchOutput }

type SearchDebugContext = {
  toolId: string
  sessionId?: string
  query: string
  limit: number
}

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
const ANYSEARCH_TIMEOUT_MS = 8000
const DUCKDUCKGO_TIMEOUT_MS = 5000
const TAVILY_TIMEOUT_MS = 8000

function previewQuery(query: string): string {
  return query.length > 160 ? `${query.slice(0, 157)}...` : query
}

function getErrorDetails(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message }
  if (typeof error === 'string') return { message: error }
  return { message: 'Unknown web search error' }
}

function getTavilyApiKey(): string {
  return readConfigValue('TAVILY_API_KEY').value
}

function getAnySearchApiKey(): string {
  return readConfigValue('ANYSEARCH_API_KEY').value
}

function getAnySearchSearchUrl(): string {
  return readConfigValue('ANYSEARCH_SEARCH_URL_API').value
}

export const webSearchTool: ToolExecutor<WebSearchInput, WebSearchOutput> = async (input, context: ToolExecutionContext) => {
  const startedAt = Date.now()
  const { query, limit = 8 } = input
  throwIfAborted(context.signal)
  const debugContext: SearchDebugContext = {
    toolId: context.toolId,
    sessionId: context.sessionId,
    query: previewQuery(query),
    limit,
  }

  console.log('[web_search] start', {
    ...debugContext,
    anysearchConfigured: Boolean(getAnySearchSearchUrl()),
    tavilyConfigured: Boolean(getTavilyApiKey()),
    preferredProvider: 'anysearch',
    fallbackProviders: ['tavily', 'duckduckgo'],
  })

  const anysearchSearchUrl = getAnySearchSearchUrl()
  const anysearchApiKey = getAnySearchApiKey()
  const tavilyApiKey = getTavilyApiKey()
  if (!anysearchSearchUrl) {
    console.warn('[web_search] provider skipped', {
      ...debugContext,
      provider: 'anysearch',
      reason: 'ANYSEARCH_SEARCH_URL_API is not configured',
    })
  }
  if (!tavilyApiKey) {
    console.warn('[web_search] provider skipped', {
      ...debugContext,
      provider: 'tavily',
      reason: 'TAVILY_API_KEY is not configured',
    })
  }

  const routingPolicy = getWebRoutingPolicy()
  let browserProvider: AgentBrowserSearchProvider | undefined
  const browserProviderFactory = routingPolicy.allowSearchFallback
    ? () => browserProvider ??= new AgentBrowserSearchProvider({
      allowedSearchHosts: routingPolicy.allowedSearchHosts,
      locale: routingPolicy.searchLocale,
      maxResults: routingPolicy.maxSearchResults,
    })
    : undefined

  try {
    const anysearchProvider = anysearchSearchUrl
      ? createAnySearchSearchProvider({
          endpoint: anysearchSearchUrl,
          apiKey: anysearchApiKey,
          timeoutMs: ANYSEARCH_TIMEOUT_MS,
        })
      : undefined
    const router = createSearchProviderRouter({
      routingPolicy,
      ...(anysearchProvider ? { anysearch: (request: WebSearchRequest) => anysearchProvider.search(request) } : {}),
      ...(tavilyApiKey ? {
        tavily: (request: WebSearchRequest) => searchWithTavily({
          query: request.query,
          limit: request.limit,
          apiKey: tavilyApiKey,
          debugContext,
          signal: request.signal,
        }),
      } : {}),
      duckduckgo: (request: WebSearchRequest) => searchWithDuckDuckGo({
        query: request.query,
        limit: request.limit,
        debugContext,
        signal: request.signal,
        fallbackFrom: request.fallbackFrom === 'tavily' ? 'tavily' : undefined,
        fallbackReason: request.fallbackReason,
      }),
      ...(browserProviderFactory ? { agentBrowser: browserProviderFactory } : {}),
    })
    const output = await router.search({
      query,
      limit,
      signal: context.signal,
      ...(input.tag ? { tag: input.tag } : {}),
      ...(input.zone ? { zone: input.zone } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.params ? { params: input.params } : {}),
      ...(input.format ? { format: input.format } : {}),
    })
    console.log('[web_search] done', {
      ...debugContext,
      provider: output.provider,
      fallbackFrom: output.fallbackFrom,
      resultCount: output.results.length,
      total: output.total,
      durationMs: Date.now() - startedAt,
    })
    return output
  } catch (err: unknown) {
    throwIfAborted(context.signal, err)
    const error = getErrorDetails(err)
    console.error('[web_search] error', {
      ...debugContext,
      provider: 'duckduckgo',
      ...error,
      durationMs: Date.now() - startedAt,
    })
    return { results: [], query, total: 0, provider: 'duckduckgo', error: error.message }
  } finally {
    await browserProvider?.close().catch(() => {})
  }
}

async function searchWithTavily(input: {
  query: string
  limit: number
  apiKey: string
  debugContext: SearchDebugContext
  signal?: AbortSignal
}): Promise<WebSearchOutput> {
  const startedAt = Date.now()
  const body = {
    query: input.query,
    max_results: input.limit,
    search_depth: 'basic',
    topic: 'news',
    include_answer: false,
    include_raw_content: false,
    include_favicon: true,
  }

  console.log('[web_search] request', {
    ...input.debugContext,
    provider: 'tavily',
    endpoint: TAVILY_SEARCH_URL,
  })

  const res = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: combineSignals(input.signal, TAVILY_TIMEOUT_MS),
  })

  console.log('[web_search] response', {
    ...input.debugContext,
    provider: 'tavily',
    status: res.status,
    ok: res.ok,
    durationMs: Date.now() - startedAt,
  })

  if (!res.ok) throw new Error(`Tavily search failed with HTTP ${res.status}: ${await safeReadResponseText(res)}`)

  const data = await res.json() as any
  const results = toArray(data.results)
    .map((result) => ({
      title: firstString(result.title, result.url, input.query) ?? input.query,
      url: firstString(result.url) ?? '',
      snippet: firstString(result.content, result.snippet, result.description) ?? '',
    }))
    .filter((result) => result.url && result.snippet)
    .slice(0, input.limit)

  return {
    query: firstString(data.query, input.query) ?? input.query,
    total: results.length,
    provider: 'tavily',
    results,
  }
}

async function searchWithDuckDuckGo(input: {
  query: string
  limit: number
  debugContext: SearchDebugContext
  signal?: AbortSignal
  fallbackFrom?: 'tavily'
  fallbackReason?: string
}): Promise<WebSearchOutput> {
  const startedAt = Date.now()
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(input.query)}&format=json&no_html=1&skip_disambig=1`

  console.log('[web_search] request', {
    ...input.debugContext,
    provider: 'duckduckgo',
    fallbackFrom: input.fallbackFrom,
    fallbackReason: input.fallbackReason,
  })

  const res = await fetch(url, { signal: combineSignals(input.signal, DUCKDUCKGO_TIMEOUT_MS) })

  console.log('[web_search] response', {
    ...input.debugContext,
    provider: 'duckduckgo',
    fallbackFrom: input.fallbackFrom,
    status: res.status,
    ok: res.ok,
    durationMs: Date.now() - startedAt,
  })

  if (!res.ok) throw new Error(`DuckDuckGo search failed with HTTP ${res.status}: ${await safeReadResponseText(res)}`)

  const data = await res.json() as any
  const results: WebSearchOutput['results'] = []

  if (data.Abstract && data.AbstractURL) {
    results.push({ title: data.Heading || input.query, url: data.AbstractURL, snippet: data.Abstract })
  }

  for (const topic of flattenDuckDuckGoTopics(data.RelatedTopics)) {
    if (results.length >= input.limit) break
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.split(' - ')[0] || topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
      })
    }
  }

  return {
    results: results.slice(0, input.limit),
    query: input.query,
    total: results.length,
    provider: 'duckduckgo',
    fallbackFrom: input.fallbackFrom,
    fallbackReason: input.fallbackReason,
  }
}

function flattenDuckDuckGoTopics(value: unknown): any[] {
  const topics: any[] = []
  for (const item of toArray(value)) {
    if (Array.isArray(item.Topics)) topics.push(...flattenDuckDuckGoTopics(item.Topics))
    else topics.push(item)
  }
  return topics
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 240)
  } catch {
    return ''
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function toArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function combineSignals(upstream: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return upstream ? AbortSignal.any([upstream, timeoutSignal]) : timeoutSignal
}

function throwIfAborted(signal: AbortSignal | undefined, cause?: unknown): void {
  if (!signal?.aborted) return
  if (cause instanceof Error) throw cause
  throw new DOMException('The operation was aborted', 'AbortError')
}
