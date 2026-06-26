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

  it('groups adjacent streaming tool calls with the same tool into one card', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming
        streamingText=""
        streamError={null}
        streamingResponse={{
          responseId: 'r1',
          sessionId: 's1',
          isComplete: false,
          blocks: [
            { id: 'tool-1', type: 'tool_call', callId: 'c1', toolId: 'web_search', category: 'web', status: 'success', input: { query: 'one' }, createdAt: 1, completedAt: 2 },
            { id: 'tool-2', type: 'tool_call', callId: 'c2', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'two' }, createdAt: 3 },
            { id: 'tool-3', type: 'tool_call', callId: 'c3', toolId: 'web_search', category: 'web', status: 'error', input: { query: 'three' }, error: { code: 'ERR', message: 'failed' }, createdAt: 4, completedAt: 5 },
          ],
        } as any}
      />
    )

    expect((html.match(/tool-call-group-card/g) || []).length).toBe(1)
    expect(html).toContain('data-tool-group-key="web:web_search"')
    expect(html).toContain('3 calls')
    expect(html).toContain('Done 1')
    expect(html).toContain('Running 1')
    expect(html).toContain('Failed 1')
    expect(html).toContain('data-call-id="c1"')
    expect(html).toContain('data-call-id="c2"')
    expect(html).toContain('data-call-id="c3"')
  })

  it('does not group tool calls across markdown blocks or different tools', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming
        streamingText=""
        streamError={null}
        streamingResponse={{
          responseId: 'r1',
          sessionId: 's1',
          isComplete: false,
          blocks: [
            { id: 'tool-1', type: 'tool_call', callId: 'c1', toolId: 'web_search', category: 'web', status: 'success', input: { query: 'one' }, createdAt: 1, completedAt: 2 },
            { id: 'md-1', type: 'markdown', status: 'streaming', role: 'answer', markdown: 'Answer text', createdAt: 3 },
            { id: 'tool-2', type: 'tool_call', callId: 'c2', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'two' }, createdAt: 4 },
            { id: 'tool-3', type: 'tool_call', callId: 'c3', toolId: 'read_file', category: 'file', status: 'running', input: { path: 'a.ts' }, createdAt: 5 },
          ],
        } as any}
      />
    )

    expect((html.match(/tool-call-group-card/g) || []).length).toBe(3)
    expect(html.indexOf('data-call-id="c1"')).toBeLessThan(html.indexOf('Answer text'))
    expect(html.indexOf('Answer text')).toBeLessThan(html.indexOf('data-call-id="c2"'))
    expect(html.indexOf('data-call-id="c2"')).toBeLessThan(html.indexOf('data-call-id="c3"'))
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
