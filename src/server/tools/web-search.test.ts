import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webSearchTool } from './web-search'

const fetchMock = vi.fn()
const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
    globalThis.fetch = originalFetch
  })

  it('uses Tavily first when TAVILY_API_KEY is configured', async () => {
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
      results: [{ title: 'NBA trade news', url: 'https://example.com/ddg', snippet: 'NBA trade news - Latest movement' }],
    })
  })

  it('reads TAVILY_API_KEY from .env when process.env is not set', async () => {
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-web-search-env-'))
    fs.writeFileSync(path.join(envDir, '.env'), 'TAVILY_API_KEY=tvly-dotenv-key\n')
    vi.spyOn(process, 'cwd').mockReturnValue(envDir)

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
})