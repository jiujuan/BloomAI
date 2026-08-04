import { describe, expect, it, vi } from 'vitest'
import { createAnySearchSearchProvider } from './anysearch-search-provider'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('AnySearch search provider', () => {
  it('sends the documented request fields and normalizes the response envelope', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      message: 'success',
      request_id: 'request-1',
      data: {
        results: [
          {
            title: 'Go 1.26 Release Notes',
            url: 'https://go.dev/doc/go1.26',
            snippet: 'Go 1.26 is a major release.',
            content: 'Detailed content.',
          },
        ],
        metadata: { total_results: 1, search_time_ms: 42 },
      },
    }))

    const provider = createAnySearchSearchProvider({
      endpoint: 'https://api.anysearch.test/v1/search',
      apiKey: 'any-test-key',
      fetchImpl: fetchMock,
    })
    const output = await provider.search({
      query: 'Go 1.26 release notes',
      limit: 50,
      tag: 'code.doc',
      zone: 'intl',
      language: 'en',
      params: { library: 'golang' },
      format: 'json',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anysearch.test/v1/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer any-test-key',
          'Content-Type': 'application/json',
        },
      }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      query: 'Go 1.26 release notes',
      max_results: 20,
      tag: 'code.doc',
      zone: 'intl',
      language: 'en',
      params: { library: 'golang' },
      format: 'json',
    })
    expect(output).toEqual({
      query: 'Go 1.26 release notes',
      total: 1,
      provider: 'anysearch',
      results: [
        {
          title: 'Go 1.26 Release Notes',
          url: 'https://go.dev/doc/go1.26',
          snippet: 'Go 1.26 is a major release.',
        },
      ],
    })
  })

  it('raises an API error for a non-zero AnySearch response code', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: -1,
      message: "Missing required params for tag 'code.doc': library.",
      request_id: 'request-2',
    }))

    const provider = createAnySearchSearchProvider({
      endpoint: 'https://api.anysearch.test/v1/search',
      fetchImpl: fetchMock,
    })

    await expect(provider.search({ query: 'Go docs', limit: 3 })).rejects.toMatchObject({
      name: 'AnySearchApiError',
      apiCode: -1,
      requestId: 'request-2',
      message: "AnySearch API error (-1): Missing required params for tag 'code.doc': library. (request_id=request-2)",
    })
  })

  it('includes HTTP status and API details for HTTP failures', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: -1,
      message: 'Too many requests',
      request_id: 'request-3',
    }, { status: 429, ok: false }))

    const provider = createAnySearchSearchProvider({
      endpoint: 'https://api.anysearch.test/v1/search',
      fetchImpl: fetchMock,
    })

    await expect(provider.search({ query: 'rate limit', limit: 3 })).rejects.toMatchObject({
      name: 'AnySearchApiError',
      status: 429,
      apiCode: -1,
      requestId: 'request-3',
      message: 'AnySearch API request failed with HTTP 429 (-1): Too many requests (request_id=request-3)',
    })
  })

  it('preserves a non-JSON HTTP error body', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: async () => 'service temporarily unavailable',
    } as unknown as Response)

    const provider = createAnySearchSearchProvider({
      endpoint: 'https://api.anysearch.test/v1/search',
      fetchImpl: fetchMock,
    })

    await expect(provider.search({ query: 'service status', limit: 1 })).rejects.toMatchObject({
      name: 'AnySearchApiError',
      status: 503,
      message: 'AnySearch API request failed with HTTP 503: service temporarily unavailable',
    })
  })
})
