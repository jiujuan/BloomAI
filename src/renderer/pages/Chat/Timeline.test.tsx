import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline, shouldShowStreamingBubble } from './Timeline'

describe('Timeline', () => {
  it('shows streaming bubble when text exists', () => {
    expect(shouldShowStreamingBubble(false, 'hello')).toBe(true)
  })

  it('renders streaming response blocks in their contract order', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming
        streamingText="legacy fallback text"
        streamError={null}
        toolCalls={[{ callId: 'legacy', toolId: 'legacy_tool', category: 'web', status: 'running', input: {} }] as any}
        streamingResponse={{
          responseId: 'r1',
          sessionId: 's1',
          isComplete: false,
          blocks: [
            {
              id: 'md-1',
              type: 'markdown',
              status: 'streaming',
              role: 'answer',
              markdown: 'First block',
              createdAt: 1,
            },
            {
              id: 'tool-1',
              type: 'tool_call',
              callId: 'c1',
              toolId: 'web_search',
              category: 'web',
              status: 'running',
              input: { query: 'bloomai' },
              createdAt: 2,
            },
            {
              id: 'md-2',
              type: 'markdown',
              status: 'streaming',
              role: 'answer',
              markdown: 'Second block',
              createdAt: 3,
            },
          ],
        } as any}
      />
    )

    expect(html).toContain('First block')
    expect(html).toContain('data-call-id="c1"')
    expect(html).toContain('Second block')
    expect(html.indexOf('First block')).toBeLessThan(html.indexOf('data-call-id="c1"'))
    expect(html.indexOf('data-call-id="c1"')).toBeLessThan(html.indexOf('Second block'))
    expect(html).not.toContain('legacy fallback text')
    expect(html).not.toContain('data-call-id="legacy"')
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
