import { describe, expect, it } from 'vitest'
import { extractMainContent } from './source-content'

describe('extractMainContent', () => {
  it('keeps article paragraphs and stable UTF-16 offsets while removing navigation, recommendations, and footers', () => {
    const result = extractMainContent({
      finalUrl: 'https://news.example/articles/market',
      title: 'CRM market update',
      byline: 'Ada Analyst',
      publishedAt: '2026-07-18T08:30:00Z',
      canonicalUrl: 'https://news.example/articles/market',
      text: `
        <html><head><title>Ignored page title</title></head><body>
          <header>Home | Markets | Search | Subscribe</header>
          <nav>Menu Privacy Policy Terms Contact</nav>
          <article>
            <p>Enterprise CRM vendors are embedding lead-intelligence workflows that connect account data, buying signals, and sales outreach in one operational system.</p>
            <p>Analysts report that teams adopt these capabilities when representatives can verify the source of each signal and tailor follow-up actions to a named account.</p>
            <ul><li>Data enrichment</li><li>Account prioritization</li></ul>
          </article>
          <aside>Recommended articles and newsletter signup</aside>
          <footer>Privacy Policy Cookie Settings Contact</footer>
        </body></html>`,
    })

    expect(result.rejectionReasons).toEqual([])
    expect(result.content).toContain('Enterprise CRM vendors')
    expect(result.content).not.toContain('Privacy Policy')
    expect(result.metadata).toMatchObject({ title: 'CRM market update', byline: 'Ada Analyst', canonicalUrl: 'https://news.example/articles/market' })
    const paragraphs = result.metadata.paragraphs as Array<{ startOffset: number; endOffset: number }>
    expect(paragraphs).toHaveLength(5)
    for (const paragraph of paragraphs) {
      expect(result.content.slice(paragraph.startOffset, paragraph.endOffset)).not.toHaveLength(0)
    }
    expect(result.diagnostics).toMatchObject({ language: 'en', navigationRatio: expect.any(Number), contentDensity: expect.any(Number) })
  })

  it.each([
    ['captcha', 'Please complete the CAPTCHA security check to continue.'],
    ['login_required', 'Sign in to continue reading this report.'],
    ['paywall', 'Subscription required. Subscribe to continue reading this analysis.'],
    ['robots_denied', 'Automated access blocked by robots.txt for this crawler.'],
    ['error_page', '404 page not found'],
    ['needs_rendering', 'Enable JavaScript to continue loading this application.'],
  ] as const)('rejects %s pages with an explicit diagnostic', (expected, text) => {
    const result = extractMainContent({ finalUrl: 'https://fixture.example/article', text, rendered: false })
    expect(result.rejectionReasons).toContain(expected)
    expect(result.diagnostics.rejectionReasons).toContain(expected)
  })

  it('rejects short, navigation-heavy content instead of treating it as a usable snapshot', () => {
    const short = extractMainContent({ finalUrl: 'https://fixture.example/short', text: 'Small but otherwise ordinary source text.' })
    expect(short.rejectionReasons).toContain('too_short')

    const navigation = extractMainContent({
      finalUrl: 'https://fixture.example/navigation',
      text: `<header>${'Navigation menu Search Subscribe Privacy Policy '.repeat(100)}</header><article><p>${'A concise article sentence. '.repeat(12)}</p></article>`,
    })
    expect(navigation.rejectionReasons).toContain('navigation_heavy')

    const repeated = extractMainContent({
      finalUrl: 'https://fixture.example/repeated',
      text: Array.from({ length: 5 }, () => 'Repeated navigation-like boilerplate should not become independent evidence for a research report.').join('\n\n'),
    })
    expect(repeated.diagnostics.duplicateTextRatio).toBeGreaterThan(0.5)
    expect(repeated.rejectionReasons).toContain('navigation_heavy')
  })
})