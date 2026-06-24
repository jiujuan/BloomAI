import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolCallCard } from './ToolCallCard'

describe('ToolCallCard', () => {
  it('renders a call id and category label for web search', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard data={{ callId: 'c1', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'bloomai' } }} />
    )

    expect(html).toContain('data-call-id="c1"')
    expect(html).toContain('web_search')
  })

  it('shows only the top three search results in success output', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        data={{
          callId: 'c2',
          toolId: 'web_search',
          category: 'web',
          status: 'success',
          input: { query: 'bloomai' },
          output: {
            results: [
              { title: 'R1', url: 'https://e/1', snippet: 'S1' },
              { title: 'R2', url: 'https://e/2', snippet: 'S2' },
              { title: 'R3', url: 'https://e/3', snippet: 'S3' },
              { title: 'R4', url: 'https://e/4', snippet: 'S4' },
            ],
          },
        }}
      />
    )

    expect((html.match(/tcc-result-item/g) || []).length).toBe(3)
  })

  it('renders error state text', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard data={{ callId: 'c3', toolId: 'web_search', category: 'web', status: 'error', input: { query: 'oops' }, error: 'boom' }} />
    )

    expect(html).toContain('boom')
    expect(html).toContain('Failed')
  })
})
