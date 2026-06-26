import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolCallGroupCard, getOverallStatus, groupCallsByStatus } from './ToolCallGroupCard'

const group = {
  key: 'web:web_search',
  toolId: 'web_search',
  category: 'web' as const,
  calls: [
    { id: 'tool-1', type: 'tool_call' as const, callId: 'c1', toolId: 'web_search', category: 'web' as const, status: 'success' as const, input: { query: 'one' }, outputSummary: '2 results', createdAt: 1, completedAt: 2 },
    { id: 'tool-2', type: 'tool_call' as const, callId: 'c2', toolId: 'web_search', category: 'web' as const, status: 'running' as const, input: { query: 'two' }, createdAt: 3 },
    { id: 'tool-3', type: 'tool_call' as const, callId: 'c3', toolId: 'web_search', category: 'web' as const, status: 'error' as const, input: { query: 'three' }, error: { code: 'ERR', message: 'failed' }, createdAt: 4, completedAt: 5 },
  ],
}

describe('ToolCallGroupCard', () => {
  it('renders one grouped card with status sections and child calls', () => {
    const html = renderToStaticMarkup(<ToolCallGroupCard group={group} />)

    expect(html).toContain('tool-call-group-card')
    expect(html).toContain('data-tool-group-key="web:web_search"')
    expect(html).toContain('web_search')
    expect(html).toContain('3 calls')
    expect(html).toContain('Running 1')
    expect(html).toContain('Done 1')
    expect(html).toContain('Failed 1')
    expect(html).toContain('data-call-id="c1"')
    expect(html).toContain('data-call-id="c2"')
    expect(html).toContain('data-call-id="c3"')
  })

  it('reports partial_error when a completed group has both success and failed calls', () => {
    const completedMixedGroup = {
      ...group,
      calls: [group.calls[0], group.calls[2]],
    }

    expect(getOverallStatus(completedMixedGroup.calls)).toBe('partial_error')

    const html = renderToStaticMarkup(<ToolCallGroupCard group={completedMixedGroup} />)

    expect(html).toContain('Partial failed')
    expect(html).toContain('partial_error')
  })

  it('reports interrupted when any call was interrupted by a response failure', () => {
    const interruptedGroup = {
      ...group,
      calls: [
        { ...group.calls[0] },
        {
          ...group.calls[1],
          status: 'error' as const,
          error: { code: 'STREAM_ABORTED', message: 'aborted' },
          metadata: { interrupted: true },
          completedAt: 6,
        },
      ],
    }

    expect(getOverallStatus(interruptedGroup.calls)).toBe('interrupted')
    expect(groupCallsByStatus(interruptedGroup.calls).interrupted.map((call) => call.callId)).toEqual(['c2'])

    const html = renderToStaticMarkup(<ToolCallGroupCard group={interruptedGroup} />)

    expect(html).toContain('Interrupted')
    expect(html).toContain('data-tool-group-status="interrupted"')
  })
})
