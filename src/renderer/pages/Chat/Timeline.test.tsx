import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline, shouldShowStreamingBubble } from './Timeline'

describe('Timeline', () => {
  it('shows streaming bubble when text exists', () => {
    expect(shouldShowStreamingBubble(false, 'hello')).toBe(true)
  })

  it('renders tool call cards before the streaming bubble', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming
        streamingText="typing"
        streamError={null}
        toolCalls={[{ callId: 'c1', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'bloomai' } }] as any}
      />
    )

    expect(html).toContain('tool-call-card')
    expect(html).toContain('data-call-id="c1"')
    expect(html.indexOf('tool-call-card')).toBeLessThan(html.indexOf('typing'))
  })
})
