import { describe, expect, it, vi } from 'vitest'

vi.mock('./utils/render', () => ({ loadPage: vi.fn() }))

import { loadPage } from './utils/render'
import { webExtractTool } from './web-extract'

describe('webExtractTool', () => {
  it('returns provenance metadata alongside main text and excludes boilerplate from the body', async () => {
    vi.mocked(loadPage).mockResolvedValue({
      finalUrl: 'https://news.example/article?ref=source',
      rendered: false,
      html: `<!doctype html><html><head>
        <title>CRM intelligence report</title>
        <meta name="author" content="Ada Analyst">
        <meta property="article:published_time" content="2026-07-17T10:00:00Z">
        <link rel="canonical" href="/articles/crm-intelligence">
      </head><body><nav>Home Search Subscribe</nav><article>
        <h1>CRM intelligence report</h1><p>${'A traceable account signal improves sales prioritization and review quality. '.repeat(5)}</p>
      </article><footer>Privacy Policy</footer></body></html>`,
    } as any)

    const output = await webExtractTool({ url: 'https://news.example/article' }, { toolId: 'web_extract' })

    expect(output).toMatchObject({
      title: 'CRM intelligence report',
      byline: 'Ada Analyst',
      publishedAt: '2026-07-17T10:00:00Z',
      canonicalUrl: 'https://news.example/articles/crm-intelligence',
    })
    expect(output.text).toContain('traceable account signal')
    expect(output.text).not.toContain('Privacy Policy')
  })
})
