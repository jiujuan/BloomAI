import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline, groupStreamingBlocks, shouldShowStreamingBubble } from './Timeline'

describe('Timeline', () => {
  it('hides fallback streaming bubble when a v1 streaming response exists', () => {
    expect(shouldShowStreamingBubble(false, { responseId: 'r', sessionId: 's1', isComplete: false, blocks: [{ id: 'md', type: 'markdown', status: 'streaming', markdown: 'hello', createdAt: 1 }] } as any)).toBe(false)
  })

  it('renders streaming response blocks in their contract order', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming
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
  it('derives tool call cards from v1 streaming response blocks', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming
        streamingResponse={{
          responseId: 'r-tool',
          sessionId: 's1',
          isComplete: false,
          blocks: [
            { id: 'tool-1', type: 'tool_call', callId: 'c1', toolId: 'web_search', category: 'web', status: 'running', input: { query: 'bloomai' }, createdAt: 1 },
          ],
        } as any}
      />
    )

    expect(html).toContain('tool-call-group-card')
    expect(html).toContain('data-call-id="c1"')
  })

  it('shows a lightweight wait state for response_started_no_block without an empty assistant bubble', () => {
    expect(shouldShowStreamingBubble(true, { responseId: 'r-wait', sessionId: 's1', isComplete: false, blocks: [] } as any)).toBe(false)

    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming
        streamingResponse={{ responseId: 'r-wait', sessionId: 's1', isComplete: false, blocks: [] } as any}
      />
    )

    expect(html).toContain('timeline-wait-state')
    expect(html).not.toContain('message-bubble')
  })

  it('renders response failures before content as registry-mapped errors without empty assistant bubbles', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming={false}
        streamingResponse={{
          responseId: 'r-fail',
          sessionId: 's1',
          isComplete: true,
          error: { code: 'STREAM_ABORTED', message: 'raw aborted' },
          blocks: [
            { id: 'err-1', type: 'error', status: 'failed', error: { code: 'STREAM_ABORTED', message: 'raw aborted' }, createdAt: 1, completedAt: 1 },
          ],
        } as any}
      />
    )

    expect(html).toContain('timeline-error-block')
    expect(html).toContain('raw aborted')
    expect(html).not.toContain('id=&quot;streaming&quot;')
  })

  it('renders partial answer and error when a response fails after content', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming={false}
        streamingResponse={{
          responseId: 'r-partial',
          sessionId: 's1',
          isComplete: true,
          error: { code: 'LLM_PROVIDER_ERROR', message: 'provider failed' },
          blocks: [
            { id: 'md-1', type: 'markdown', status: 'completed', markdown: 'Partial answer', createdAt: 1, completedAt: 2 },
            { id: 'err-1', type: 'error', status: 'failed', error: { code: 'LLM_PROVIDER_ERROR', message: 'provider failed' }, createdAt: 3, completedAt: 3 },
          ],
        } as any}
      />
    )

    expect(html).toContain('Partial answer')
    expect(html).toContain('provider failed')
    expect(html).toContain('provider failed')
    expect(html.indexOf('Partial answer')).toBeLessThan(html.indexOf('provider failed'))
  })

  it('keeps five adjacent web_search calls in a single group and splits across markdown', () => {
    const fiveSearches = Array.from({ length: 5 }, (_, index) => ({
      id: `tool-${index}`,
      type: 'tool_call' as const,
      callId: `c${index}`,
      toolId: 'web_search',
      category: 'web' as const,
      status: 'success' as const,
      input: { query: String(index) },
      createdAt: index,
      completedAt: index + 1,
    }))

    expect(groupStreamingBlocks(fiveSearches)).toHaveLength(1)
    expect(groupStreamingBlocks([
      fiveSearches[0],
      { id: 'md', type: 'markdown' as const, status: 'completed' as const, markdown: 'break', createdAt: 6, completedAt: 7 },
      fiveSearches[1],
    ])).toHaveLength(3)
  })

  it('renders unknown error codes with UNKNOWN_ERROR registry text', () => {
    const html = renderToStaticMarkup(
      <Timeline
        messages={[] as any}
        isStreaming={false}
        streamingResponse={{
          responseId: 'r-unknown',
          sessionId: 's1',
          isComplete: true,
          error: { code: 'ODD_VENDOR_CODE', message: 'safe vendor failure' },
          blocks: [
            { id: 'err-unknown', type: 'error', status: 'failed', error: { code: 'ODD_VENDOR_CODE', message: 'safe vendor failure' }, createdAt: 1, completedAt: 1 },
          ],
        } as any}
      />
    )

    expect(html).toContain('发生未知错误')
    expect(html).toContain('safe vendor failure')
  })
})
