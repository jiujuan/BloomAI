import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolCallCard } from './ToolCallCard'
import type { ToolCallBlock } from '@shared/schemas'

function toolBlock(overrides: Partial<ToolCallBlock> = {}): ToolCallBlock {
  return {
    id: overrides.id ?? 'tool-block-1',
    type: 'tool_call',
    callId: overrides.callId ?? 'c1',
    toolId: overrides.toolId ?? 'web_search',
    category: overrides.category ?? 'web',
    status: overrides.status ?? 'running',
    input: overrides.input ?? { query: 'bloomai' },
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  }
}

describe('ToolCallCard', () => {
  it('renders a call id and category label for a v1 web search block', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard data={toolBlock()} />
    )

    expect(html).toContain('data-call-id="c1"')
    expect(html).toContain('web_search')
  })

  it('shows only the top three search results from v1 success output', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        data={toolBlock({
          callId: 'c2',
          status: 'success',
          output: {
            results: [
              { title: 'R1', url: 'https://e/1', snippet: 'S1' },
              { title: 'R2', url: 'https://e/2', snippet: 'S2' },
              { title: 'R3', url: 'https://e/3', snippet: 'S3' },
              { title: 'R4', url: 'https://e/4', snippet: 'S4' },
            ],
          },
          completedAt: 2,
        })}
      />
    )

    expect((html.match(/tcc-result-item/g) || []).length).toBe(3)
  })

  it('renders v1 response error state text', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        data={toolBlock({
          callId: 'c3',
          status: 'error',
          input: { query: 'oops' },
          error: { code: 'TOOL_CALL_ERROR', message: 'provider failed' },
          completedAt: 2,
        })}
      />
    )

    expect(html).toContain('provider failed')
    expect(html).toContain('Failed')
  })

  it('falls back to a readable category label for v1 categories without custom icons', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        data={toolBlock({
          callId: 'c5',
          toolId: 'render_video',
          category: 'video',
          input: { prompt: 'bloom' },
        })}
      />
    )

    expect(html).toContain('data-call-id="c5"')
    expect(html).toContain('video')
    expect(html).toContain('render_video')
  })

  it('uses the error timeline registry label for known v1 response errors', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        data={toolBlock({
          callId: 'c6',
          status: 'error',
          input: { query: 'oops' },
          error: { code: 'STREAM_ABORTED', message: 'user cancelled' },
          completedAt: 2,
        })}
      />
    )

    expect(html).toContain('user cancelled')
    expect(html).toContain('STREAM_ABORTED')
  })
})