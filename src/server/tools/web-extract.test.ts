import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./web/provider-router', () => ({ loadPageWithProviders: vi.fn() }))

import { loadPageWithProviders } from './web/provider-router'
import { webExtractTool } from './web-extract'

const fixture = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/tools/web/__fixtures__/spa-page.html'),
  'utf8',
)
const hydratedFixture = fixture.replace(
  '<main id="app"><p>Loading application...</p></main>',
  '<main id="app"><h1>Hydrated SPA article</h1><p>This paragraph is injected after JavaScript runs. '
    + 'x '.repeat(80)
    + '</p><a href="/docs/getting-started">Getting started</a></main>',
)

describe('webExtractTool', () => {
  beforeEach(() => {
    vi.mocked(loadPageWithProviders).mockReset()
  })

  it('returns provenance metadata alongside main text and excludes boilerplate from the body', async () => {
    vi.mocked(loadPageWithProviders).mockResolvedValue({
      finalUrl: 'https://news.example/article?ref=source',
      status: 200,
      charset: 'utf-8',
      rendered: false,
      provider: 'static_http',
      diagnostics: { attempts: [] },
      html: `<!doctype html><html><head>
        <title>CRM intelligence report</title>
        <meta name="author" content="Ada Analyst">
        <meta property="article:published_time" content="2026-07-17T10:00:00Z">
        <link rel="canonical" href="/articles/crm-intelligence">
      </head><body><nav>Home Search Subscribe</nav><article>
        <h1>CRM intelligence report</h1><p>${'A traceable account signal improves sales prioritization and review quality. '.repeat(5)}</p>
      </article><footer>Privacy Policy</footer></body></html>`,
    })

    const output = await webExtractTool({ url: 'https://news.example/article' }, { toolId: 'web_extract' })

    expect(output).toMatchObject({
      title: 'CRM intelligence report',
      byline: 'Ada Analyst',
      publishedAt: '2026-07-17T10:00:00Z',
      canonicalUrl: 'https://news.example/articles/crm-intelligence',
    })
    expect(output.text).toContain('traceable account signal')
    expect(output.text).not.toContain('Privacy Policy')
    expect(output.provider).toBe('static_http')
    expect(output.diagnostics).toEqual({ attempts: [] })
  })

  it('extracts hydrated SPA structure and resolves relative links from the browser final URL', async () => {
    vi.mocked(loadPageWithProviders).mockResolvedValue({
      finalUrl: 'https://example.com/app/index.html',
      status: 200,
      charset: 'utf-8',
      rendered: true,
      provider: 'agent_browser',
      diagnostics: {
        attempts: [
          { provider: 'static_http', outcome: 'success', durationMs: 2 },
          { provider: 'agent_browser', outcome: 'success', durationMs: 11 },
        ],
      },
      html: hydratedFixture,
    })

    const output = await webExtractTool(
      { url: 'https://example.com/app', render: true, maxLinks: 1 },
      { toolId: 'web_extract', signal: new AbortController().signal },
    )

    expect(loadPageWithProviders).toHaveBeenCalledWith(
      'https://example.com/app',
      expect.objectContaining({ render: true }),
    )
    expect(output).toMatchObject({
      title: 'SPA fixture',
      finalUrl: 'https://example.com/app/index.html',
      rendered: true,
      provider: 'agent_browser',
      headings: ['Hydrated SPA article'],
      links: [{ url: 'https://example.com/docs/getting-started', text: 'Getting started' }],
    })
    expect(output.text).toContain('This paragraph is injected after JavaScript runs.')
    expect(output.diagnostics.attempts).toHaveLength(2)
  })

  it('keeps static-only semantics and applies extraction limits', async () => {
    vi.mocked(loadPageWithProviders).mockResolvedValue({
      finalUrl: 'https://example.com/article',
      status: 200,
      charset: 'utf-8',
      rendered: false,
      provider: 'static_http',
      diagnostics: { attempts: [{ provider: 'static_http', outcome: 'success' }] },
      html: '<html><head><title>Static article</title><meta name="description" content="Fixture description"><link rel="canonical" href="/canonical"></head><body><article><h1>Static article</h1><h2>Details</h2><p>Readable article text.</p><a href="/one">One</a><a href="/two">Two</a></article></body></html>',
    })

    const output = await webExtractTool(
      { url: 'https://example.com/article', render: false, maxChars: 20, maxLinks: 1 },
      { toolId: 'web_extract' },
    )

    expect(loadPageWithProviders).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.objectContaining({ render: false }),
    )
    expect(output).toMatchObject({
      provider: 'static_http',
      rendered: false,
      description: 'Fixture description',
      canonicalUrl: 'https://example.com/canonical',
      links: [{ url: 'https://example.com/one', text: 'One' }],
      truncated: true,
    })
    expect(output.text.length).toBe(20)
  })
})
