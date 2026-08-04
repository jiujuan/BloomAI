import { describe, expect, it, vi } from 'vitest'
import { createSearchProviderRouter, getActiveBrowserSearches } from './search-provider-router'
import type { WebSearchOutput, WebSearchProvider } from './contracts'

function output(provider: WebSearchOutput['provider'], results: WebSearchOutput['results'] = []): WebSearchOutput {
  return {
    query: 'agent browser',
    total: results.length,
    results,
    provider,
  }
}

function result(index: number) {
  return {
    title: `Result ${index}`,
    url: `https://example.com/${index}`,
    snippet: `Snippet ${index}`,
  }
}

function browserProvider(search: WebSearchProvider['search']): WebSearchProvider {
  return { id: 'agent_browser_serp', search }
}

describe('SearchProviderRouter browser fallback', () => {
  it('tries AnySearch before Tavily and DuckDuckGo', async () => {
    const anysearch = vi.fn(async () => output('anysearch', [result(1)]))
    const tavily = vi.fn(async () => output('tavily', [result(2)]))
    const duckduckgo = vi.fn(async () => output('duckduckgo', [result(3)]))

    const actual = await createSearchProviderRouter({
      anysearch,
      tavily,
      duckduckgo,
      routingPolicy: { preference: 'auto', browserEnabled: false, allowSearchFallback: false },
    }).search({ query: 'provider order', limit: 8 })

    expect(actual.provider).toBe('anysearch')
    expect(anysearch).toHaveBeenCalledTimes(1)
    expect(tavily).not.toHaveBeenCalled()
    expect(duckduckgo).not.toHaveBeenCalled()
  })

  it('passes AnySearch failure metadata through Tavily to DuckDuckGo', async () => {
    const anysearch = vi.fn(async () => { throw new Error('AnySearch unavailable') })
    const tavily = vi.fn(async (request) => {
      expect(request).toMatchObject({ fallbackFrom: 'anysearch', fallbackReason: 'AnySearch unavailable' })
      return output('tavily')
    })
    const duckduckgo = vi.fn(async (request) => {
      expect(request).toMatchObject({ fallbackFrom: 'tavily', fallbackReason: 'Tavily returned no usable results' })
      return output('duckduckgo', [result(1)])
    })

    const actual = await createSearchProviderRouter({
      anysearch,
      tavily,
      duckduckgo,
      routingPolicy: { preference: 'auto', browserEnabled: false, allowSearchFallback: false },
    }).search({ query: 'provider fallback', limit: 8 })

    expect(actual).toMatchObject({
      provider: 'duckduckgo',
      fallbackFrom: 'tavily',
      fallbackReason: 'Tavily returned no usable results',
    })
    expect(anysearch).toHaveBeenCalledTimes(1)
    expect(tavily).toHaveBeenCalledTimes(1)
    expect(duckduckgo).toHaveBeenCalledTimes(1)
  })

  it('reports the last failed provider when an earlier provider returned no results', async () => {
    const anysearch = vi.fn(async () => output('anysearch'))
    const tavily = vi.fn(async () => output('tavily'))
    const duckduckgo = vi.fn(async () => { throw new Error('DuckDuckGo unavailable') })

    const actual = await createSearchProviderRouter({
      anysearch,
      tavily,
      duckduckgo,
      routingPolicy: { preference: 'auto', browserEnabled: false, allowSearchFallback: false },
    }).search({ query: 'last failure', limit: 8 })

    expect(actual).toMatchObject({
      provider: 'duckduckgo',
      total: 0,
      error: 'DuckDuckGo unavailable',
      fallbackFrom: 'tavily',
      fallbackReason: 'Tavily returned no usable results',
    })
  })

  it('keeps Tavily as the first provider and never constructs a browser search', async () => {
    const tavily = vi.fn(async () => output('tavily', [result(1)]))
    const duckduckgo = vi.fn(async () => output('duckduckgo', [result(2)]))
    const browser = vi.fn(async () => output('agent_browser_serp', [result(3)]))
    const browserFactory = vi.fn(() => browserProvider(browser))

    const actual = await createSearchProviderRouter({
      tavily,
      duckduckgo,
      agentBrowser: browserFactory,
      routingPolicy: { preference: 'auto', browserEnabled: true, allowSearchFallback: true },
    }).search({ query: 'agent browser', limit: 8 })

    expect(actual.provider).toBe('tavily')
    expect(tavily).toHaveBeenCalledTimes(1)
    expect(duckduckgo).not.toHaveBeenCalled()
    expect(browser).not.toHaveBeenCalled()
    expect(browserFactory).not.toHaveBeenCalled()
  })

  it('keeps DuckDuckGo ahead of the browser fallback when Tavily has no result', async () => {
    const tavily = vi.fn(async () => output('tavily'))
    const duckduckgo = vi.fn(async (request) => {
      expect(request).toMatchObject({ fallbackFrom: 'tavily' })
      return output('duckduckgo', [result(1)])
    })
    const browser = vi.fn(async () => output('agent_browser_serp', [result(2)]))
    const browserFactory = vi.fn(() => browserProvider(browser))

    const actual = await createSearchProviderRouter({
      tavily,
      duckduckgo,
      agentBrowser: browserFactory,
      routingPolicy: { preference: 'auto', browserEnabled: true, allowSearchFallback: true },
    }).search({ query: 'agent browser', limit: 8 })

    expect(actual.provider).toBe('duckduckgo')
    expect(actual.fallbackFrom).toBe('tavily')
    expect(duckduckgo).toHaveBeenCalledTimes(1)
    expect(browser).not.toHaveBeenCalled()
    expect(browserFactory).not.toHaveBeenCalled()
  })

  it('does not call the browser when the browser provider is disabled', async () => {
    const tavily = vi.fn(async () => { throw new Error('Tavily unavailable') })
    const duckduckgo = vi.fn(async () => { throw new Error('DuckDuckGo unavailable') })
    const browser = vi.fn(async () => output('agent_browser_serp', [result(1)]))

    const actual = await createSearchProviderRouter({
      tavily,
      duckduckgo,
      agentBrowser: browserProvider(browser),
      routingPolicy: { preference: 'auto', browserEnabled: false, allowSearchFallback: true },
    }).search({ query: 'agent browser', limit: 8 })

    expect(actual.total).toBe(0)
    expect(browser).not.toHaveBeenCalled()
  })

  it('does not call the browser when the SERP fallback flag is disabled', async () => {
    const tavily = vi.fn(async () => { throw new Error('Tavily unavailable') })
    const duckduckgo = vi.fn(async () => { throw new Error('DuckDuckGo unavailable') })
    const browser = vi.fn(async () => output('agent_browser_serp', [result(1)]))

    const actual = await createSearchProviderRouter({
      tavily,
      duckduckgo,
      agentBrowser: browserProvider(browser),
      routingPolicy: { preference: 'auto', browserEnabled: true, allowSearchFallback: false },
    }).search({ query: 'agent browser', limit: 8 })

    expect(actual.total).toBe(0)
    expect(actual.provider).toBe('duckduckgo')
    expect(browser).not.toHaveBeenCalled()
  })

  it('calls the browser once as the final fallback and applies the result cap', async () => {
    const tavily = vi.fn(async () => { throw new Error('Tavily unavailable') })
    const duckduckgo = vi.fn(async () => { throw new Error('DuckDuckGo unavailable') })
    const browser = vi.fn(async (request) => output(
      'agent_browser_serp',
      Array.from({ length: 8 }, (_, index) => result(index + 1)),
    ))

    const actual = await createSearchProviderRouter({
      tavily,
      duckduckgo,
      agentBrowser: browserProvider(browser),
      routingPolicy: {
        preference: 'auto',
        browserEnabled: true,
        allowSearchFallback: true,
        maxSearchResults: 5,
      },
    }).search({ query: 'agent browser', limit: 20 })

    expect(browser).toHaveBeenCalledTimes(1)
    expect(browser.mock.calls[0][0]).toMatchObject({
      query: 'agent browser',
      limit: 5,
      fallbackFrom: 'duckduckgo',
    })
    expect(actual.results).toHaveLength(5)
    expect(actual.provider).toBe('agent_browser_serp')
  })

  it('maps a blocked browser SERP to a stable empty result', async () => {
    const tavily = vi.fn(async () => output('tavily'))
    const duckduckgo = vi.fn(async () => output('duckduckgo'))
    const browser = vi.fn(async () => {
      const error = Object.assign(new Error('CAPTCHA'), { code: 'WEB_SEARCH_SERP_BLOCKED' })
      throw error
    })

    const actual = await createSearchProviderRouter({
      tavily,
      duckduckgo,
      agentBrowser: browserProvider(browser),
      routingPolicy: { preference: 'auto', browserEnabled: true, allowSearchFallback: true },
    }).search({ query: 'agent browser', limit: 8 })

    expect(actual).toMatchObject({
      provider: 'agent_browser_serp',
      total: 0,
      results: [],
      errorCode: 'WEB_SEARCH_SERP_BLOCKED',
    })
  })

  it('serializes concurrent browser searches', async () => {
    let active = 0
    let peak = 0
    const browser = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return output('agent_browser_serp', [result(1)])
    })
    const router = createSearchProviderRouter({
      duckduckgo: vi.fn(async () => output('duckduckgo')),
      agentBrowser: browserProvider(browser),
      routingPolicy: { preference: 'auto', browserEnabled: true, allowSearchFallback: true },
    })

    const results = await Promise.all([
      router.search({ query: 'one', limit: 5 }),
      router.search({ query: 'two', limit: 5 }),
    ])

    expect(results).toHaveLength(2)
    expect(browser).toHaveBeenCalledTimes(2)
    expect(peak).toBe(1)
    expect(getActiveBrowserSearches()).toBe(0)
  })
})
