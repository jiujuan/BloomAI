import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createWebFetchTool } from './web-fetch'
import type { WebLoadedPage, WebPageProvider } from './web/contracts'
import { createWebPageProviderRouter } from './web/provider-router'

const fixturePath = path.resolve(process.cwd(), 'src/server/tools/web/__fixtures__/spa-page.html')
const fixture = fs.readFileSync(fixturePath, 'utf8')
const hydratedFixture = fixture.replace(
  '<main id="app"><p>Loading application...</p></main>',
  '<main id="app"><h1>Hydrated SPA article</h1><p>This paragraph is injected after JavaScript runs. '.concat('x '.repeat(80), '</p><a href="/docs/getting-started">Getting started</a></main>'),
)

function loadedPage(
  provider: WebLoadedPage['provider'],
  html: string,
  overrides: Partial<WebLoadedPage> = {},
): WebLoadedPage {
  return {
    html,
    finalUrl: 'https://example.com/app/index.html',
    status: 200,
    charset: 'utf-8',
    contentType: 'text/html; charset=utf-8',
    truncated: false,
    rendered: provider === 'agent_browser',
    provider,
    diagnostics: { attempts: [] },
    ...overrides,
  }
}

describe('web_fetch provider behavior', () => {
  it('keeps a normal static article on the static provider', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => loadedPage('static_http', `<article><h1>Static article</h1><p>${'Stable text '.repeat(40)}</p></article>`)),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      load: vi.fn(async () => loadedPage('agent_browser', '<main>browser should not run</main>')),
    }

    const result = await createWebPageProviderRouter({
      staticProvider,
      browserProvider,
      routingPolicy: { preference: 'auto', browserEnabled: true, allowSearchFallback: false },
    }).loadPage({ url: 'https://example.com/article', render: false })

    expect(result).toMatchObject({ provider: 'static_http', rendered: false, truncated: false })
    expect(browserProvider.load).not.toHaveBeenCalled()
  })

  it('uses hydrated SPA content once static content is too thin', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => loadedPage('static_http', fixture.replace(
        '<h1>Hydrated SPA article</h1><p>',
        '<p>Loading application...</p><!-- hydrated shell omitted -->',
      ))),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      load: vi.fn(async () => loadedPage('agent_browser', hydratedFixture)),
    }

    const result = await createWebPageProviderRouter({
      staticProvider,
      browserProvider,
      routingPolicy: { preference: 'auto', browserEnabled: true, allowSearchFallback: false },
    }).loadPage({ url: 'https://example.com/app' })

    expect(result).toMatchObject({ provider: 'agent_browser', rendered: true })
    expect(result.html).toContain('Hydrated SPA article')
    expect(result.diagnostics.attempts.map((attempt) => attempt.provider)).toEqual(['static_http', 'agent_browser'])
    expect(browserProvider.load).toHaveBeenCalledTimes(1)
  })

  it('does not start a browser for render:false even when the page is an SPA shell', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => loadedPage('static_http', '<main>Loading application...</main>')),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      load: vi.fn(async () => loadedPage('agent_browser', fixture)),
    }

    const result = await createWebPageProviderRouter({
      staticProvider,
      browserProvider,
      routingPolicy: { preference: 'auto', browserEnabled: true, allowSearchFallback: false },
    }).loadPage({ url: 'https://example.com/app', render: false })

    expect(result.provider).toBe('static_http')
    expect(result.html).not.toContain('Hydrated SPA article')
    expect(browserProvider.load).not.toHaveBeenCalled()
  })

  it('preserves finalUrl, charset, byte truncation, and html mode metadata', async () => {
    const staticProvider: WebPageProvider = {
      id: 'static_http',
      load: vi.fn(async () => loadedPage('static_http', '<html><head><title>GBK page</title></head><body>正文</body></html>', {
        finalUrl: 'https://example.com/final',
        charset: 'gb18030',
        contentType: 'text/html; charset=gb18030',
        truncated: true,
      })),
    }
    const browserProvider: WebPageProvider = {
      id: 'agent_browser',
      load: vi.fn(async () => loadedPage('agent_browser', '<main>browser fallback</main>')),
    }

    const result = await createWebPageProviderRouter({
      staticProvider,
      browserProvider,
      routingPolicy: { preference: 'auto', browserEnabled: false, allowSearchFallback: false },
    }).loadPage({ url: 'https://example.com/page', render: false })

    expect(result).toMatchObject({
      finalUrl: 'https://example.com/final',
      charset: 'gb18030',
      contentType: 'text/html; charset=gb18030',
      truncated: true,
    })
  })

  it('returns the unified fetch output with provider diagnostics and maxChars truncation', async () => {
    const loadPage = vi.fn(async () => loadedPage('agent_browser', hydratedFixture, {
      finalUrl: 'https://example.com/app/final',
      diagnostics: {
        attempts: [{ provider: 'agent_browser', outcome: 'success', durationMs: 4 }],
      },
    }))
    const tool = createWebFetchTool(loadPage)

    const result = await tool(
      { url: 'https://example.com/app', mode: 'text', maxChars: 32, render: true },
      { toolId: 'web_fetch', signal: new AbortController().signal },
    )

    expect(loadPage).toHaveBeenCalledWith('https://example.com/app', expect.objectContaining({ render: true }))
    expect(result).toMatchObject({
      title: 'SPA fixture',
      finalUrl: 'https://example.com/app/final',
      rendered: true,
      provider: 'agent_browser',
      truncated: true,
      diagnostics: { attempts: [expect.objectContaining({ provider: 'agent_browser' })] },
    })
    expect(result.content.length).toBe(32)
  })
})
