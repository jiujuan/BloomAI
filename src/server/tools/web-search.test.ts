import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webSearchTool } from './web-search'

const fetchMock = vi.fn()
const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }
let testEnvDir = ''

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('webSearchTool', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    process.env = { ...originalEnv }
    delete process.env.TAVILY_API_KEY
    delete process.env.ANYSEARCH_API_KEY
    delete process.env.ANYSEARCH_SEARCH_URL_API
    testEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-web-search-env-'))
    fs.writeFileSync(path.join(testEnvDir, '.env'), '')
    vi.spyOn(process, 'cwd').mockReturnValue(testEnvDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
    globalThis.fetch = originalFetch
  })

  it('uses Tavily when AnySearch is not configured', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    fetchMock.mockResolvedValueOnce(jsonResponse({
      query: 'NBA trades',
      results: [
        { title: 'Trade tracker', url: 'https://example.com/trades', content: 'Latest NBA trade updates', score: 0.9, favicon: 'https://example.com/favicon.ico' },
      ],
      response_time: 1.2,
      request_id: 'req-1',
    }))

    const output = await webSearchTool({ query: 'NBA trades', limit: 3 }, { toolId: 'web_search', sessionId: 'session-1' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer tvly-test-key' }),
    }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      query: 'NBA trades',
      max_results: 3,
      search_depth: 'basic',
      topic: 'news',
      include_answer: false,
      include_raw_content: false,
      include_favicon: true,
    })
    expect(output).toEqual({
      query: 'NBA trades',
      total: 1,
      provider: 'tavily',
      results: [
        { title: 'Trade tracker', url: 'https://example.com/trades', snippet: 'Latest NBA trade updates' },
      ],
    })
  })

  it('uses AnySearch first when its endpoint is configured', async () => {
    process.env.ANYSEARCH_API_KEY = 'any-test-key'
    process.env.ANYSEARCH_SEARCH_URL_API = 'https://api.anysearch.test/v1/search'
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      message: 'success',
      request_id: 'request-1',
      data: {
        results: [
          { title: 'AnySearch result', url: 'https://example.com/anysearch', snippet: 'AnySearch snippet' },
        ],
        metadata: { total_results: 1, search_time_ms: 10 },
      },
    }))

    const output = await webSearchTool({
      query: 'AnySearch first',
      limit: 3,
      tag: 'code.doc',
      zone: 'intl',
      language: 'en',
      params: { library: 'golang' },
      format: 'json',
    }, { toolId: 'web_search' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.anysearch.test/v1/search', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer any-test-key' }),
    }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      query: 'AnySearch first',
      max_results: 3,
      tag: 'code.doc',
      zone: 'intl',
      language: 'en',
      params: { library: 'golang' },
      format: 'json',
    })
    expect(output).toEqual({
      query: 'AnySearch first',
      total: 1,
      provider: 'anysearch',
      results: [
        { title: 'AnySearch result', url: 'https://example.com/anysearch', snippet: 'AnySearch snippet' },
      ],
    })
  })

  it('supports anonymous AnySearch calls without an Authorization header', async () => {
    process.env.ANYSEARCH_SEARCH_URL_API = 'https://api.anysearch.test/v1/search'
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      message: 'success',
      data: {
        results: [
          { title: 'Anonymous result', url: 'https://example.com/anonymous', snippet: 'Anonymous snippet' },
        ],
      },
    }))

    const output = await webSearchTool({ query: 'anonymous AnySearch', limit: 1 }, { toolId: 'web_search' })
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit

    expect(requestInit.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(output.provider).toBe('anysearch')
    expect(output.results).toHaveLength(1)
  })

  it('falls back to DuckDuckGo when Tavily is unavailable', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, { status: 429, ok: false }))
      .mockResolvedValueOnce(jsonResponse({
        Abstract: '',
        AbstractURL: '',
        RelatedTopics: [
          { Text: 'NBA trade news - Latest movement', FirstURL: 'https://example.com/ddg' },
        ],
      }))

    const output = await webSearchTool({ query: 'NBA trades', limit: 5 }, { toolId: 'web_search', sessionId: 'session-1' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('https://api.duckduckgo.com/')
    expect(output).toMatchObject({
      query: 'NBA trades',
      total: 1,
      provider: 'duckduckgo',
      fallbackFrom: 'tavily',
      fallbackReason: 'Tavily search failed with HTTP 429: {"error":"rate limited"}',
      results: [{ title: 'NBA trade news', url: 'https://example.com/ddg', snippet: 'NBA trade news - Latest movement' }],
    })
  })

  it('falls back from AnySearch to Tavily before DuckDuckGo', async () => {
    process.env.ANYSEARCH_API_KEY = 'any-test-key'
    process.env.ANYSEARCH_SEARCH_URL_API = 'https://api.anysearch.test/v1/search'
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: -1, message: 'service unavailable', request_id: 'request-2' }))
      .mockResolvedValueOnce(jsonResponse({
        query: 'AnySearch fallback',
        results: [
          { title: 'Tavily result', url: 'https://example.com/tavily', content: 'Tavily snippet' },
        ],
      }))

    const output = await webSearchTool({ query: 'AnySearch fallback', limit: 5 }, { toolId: 'web_search' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anysearch.test/v1/search')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.tavily.com/search')
    expect(output).toMatchObject({
      provider: 'tavily',
      fallbackFrom: 'anysearch',
      fallbackReason: 'AnySearch API error (-1): service unavailable (request_id=request-2)',
    })
  })

  it('returns a soft failure summary when all web search providers fail', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, { status: 429, ok: false }))
      .mockResolvedValueOnce(jsonResponse({ error: 'offline' }, { status: 503, ok: false }))

    const output = await webSearchTool({ query: 'NBA trades', limit: 5 }, { toolId: 'web_search', sessionId: 'session-1' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(output).toMatchObject({
      query: 'NBA trades',
      total: 0,
      provider: 'duckduckgo',
      fallbackFrom: 'tavily',
      fallbackReason: 'Tavily search failed with HTTP 429: {"error":"rate limited"}',
      error: 'DuckDuckGo search failed with HTTP 503: {"error":"offline"}',
      results: [],
    })
  })

  it('reads TAVILY_API_KEY from .env when process.env is not set', async () => {
    fs.writeFileSync(path.join(testEnvDir, '.env'), 'TAVILY_API_KEY=tvly-dotenv-key\n')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      query: 'NBA trades',
      results: [],
      response_time: 0.5,
    }))

    await webSearchTool({ query: 'NBA trades', limit: 2 }, { toolId: 'web_search' })

    expect(fetchMock).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tvly-dotenv-key' }),
    }))
  })

  it('reads AnySearch endpoint and API key from .env when process.env is not set', async () => {
    fs.writeFileSync(
      path.join(testEnvDir, '.env'),
      'ANYSEARCH_API_KEY=any-dotenv-key\nANYSEARCH_SEARCH_URL_API=https://api.anysearch.test/v1/search\n',
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      message: 'success',
      data: {
        results: [
          { title: 'Dotenv result', url: 'https://example.com/dotenv', snippet: 'Dotenv snippet' },
        ],
        metadata: { total_results: 1, search_time_ms: 1 },
      },
    }))

    const output = await webSearchTool({ query: 'AnySearch dotenv', limit: 2 }, { toolId: 'web_search' })

    expect(fetchMock).toHaveBeenCalledWith('https://api.anysearch.test/v1/search', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer any-dotenv-key' }),
    }))
    expect(output.provider).toBe('anysearch')
  })

  it('passes a combined timeout signal and does not fall back after upstream cancellation', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    const controller = new AbortController()
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))

    const pending = webSearchTool(
      { query: 'cancelled', limit: 3 },
      { toolId: 'web_search', signal: controller.signal },
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    const requestSignal = fetchMock.mock.calls[0][1].signal as AbortSignal
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal).not.toBe(controller.signal)
    expect(requestSignal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
