import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserSearchProvider } from './agent-browser-search-provider'

function page(html: string, finalUrl = 'https://www.google.com/search?q=fixture'): any {
  return {
    html,
    finalUrl,
    status: 200,
    charset: 'utf-8',
    rendered: true,
    provider: 'agent_browser',
    diagnostics: { attempts: [{ provider: 'agent_browser', outcome: 'success' }] },
  }
}

describe('AgentBrowserSearchProvider', () => {
  it('uses the configured SERP host and extracts only bounded public HTTP links', async () => {
    const load = vi.fn(async (request) => page(`
      <html><body>
        <a href="https://search.example.test/search?q=internal"><h3>Internal</h3>Internal</a>
        <a href="https://example.com/one"><h3>One</h3>One result snippet</a>
        <a href="javascript:alert(1)"><h3>Script</h3>Script result</a>
        <a href="mailto:test@example.com"><h3>Mail</h3>Mail result</a>
        <a href="http://example.org/two"><h3>Two</h3>Two result snippet</a>
        <a href="https://example.com/one"><h3>Duplicate</h3>Duplicate result</a>
      </body></html>
    `, 'https://search.example.test/search?q=fixture'))
    const provider = new AgentBrowserSearchProvider({
      browserProvider: { load, close: vi.fn() },
      allowedSearchHosts: ['search.example.test'],
      locale: 'zh-CN',
      maxResults: 5,
    })

    const actual = await provider.search({ query: 'fixture query', limit: 8 })

    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringMatching(/^https:\/\/search\.example\.test\/search\?/),
      render: true,
      signal: undefined,
    }))
    const searchUrl = new URL(load.mock.calls[0][0].url)
    expect(searchUrl.searchParams.get('q')).toBe('fixture query')
    expect(searchUrl.searchParams.get('hl')).toBe('zh-CN')
    expect(actual).toMatchObject({
      provider: 'agent_browser_serp',
      total: 2,
      results: [
        { title: 'One', url: 'https://example.com/one', snippet: 'One result snippet' },
        { title: 'Two', url: 'http://example.org/two', snippet: 'Two result snippet' },
      ],
    })
  })

  it('maps CAPTCHA and login walls to WEB_SEARCH_SERP_BLOCKED without retrying', async () => {
    const load = vi.fn(async () => page(`
      <html><body>
        <div>Our systems detected unusual traffic. Verify you are human.</div>
      </body></html>
    `))
    const provider = new AgentBrowserSearchProvider({
      browserProvider: { load, close: vi.fn() },
    })

    await expect(provider.search({ query: 'blocked', limit: 5 })).rejects.toMatchObject({
      code: 'WEB_SEARCH_SERP_BLOCKED',
    })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('maps a DOM change with no usable links to WEB_SEARCH_SERP_BLOCKED', async () => {
    const load = vi.fn(async () => page('<html><body><div>Search results</div></body></html>'))
    const provider = new AgentBrowserSearchProvider({
      browserProvider: { load, close: vi.fn() },
    })

    await expect(provider.search({ query: 'empty', limit: 5 })).rejects.toMatchObject({
      code: 'WEB_SEARCH_SERP_BLOCKED',
    })
  })

  it('rejects navigation that leaves the configured SERP host', async () => {
    const load = vi.fn(async () => page(
      '<html><body><a href="https://example.com"><h3>Example</h3>Example</a></body></html>',
      'https://evil.example/search?q=fixture',
    ))
    const provider = new AgentBrowserSearchProvider({
      browserProvider: { load, close: vi.fn() },
      allowedSearchHosts: ['www.google.com'],
    })

    await expect(provider.search({ query: 'unsafe', limit: 5 })).rejects.toMatchObject({
      code: 'WEB_SEARCH_SERP_BLOCKED',
    })
  })
})
