import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeToolMock = vi.hoisted(() => vi.fn())

vi.mock('../../tools/execute-tool', () => ({
  executeTool: executeToolMock,
}))

import { createWebSearchAdapterTool, webSearchInputSchema, webSearchOutputSchema } from './web-search-adapter.tool'

describe('web_search Mastra adapter tool', () => {
  beforeEach(() => {
    executeToolMock.mockReset()
  })

  it('defines the Mastra web_search tool contract', () => {
    const tool = createWebSearchAdapterTool({ sessionId: 'session-1' })

    expect(tool.id).toBe('web_search')
    expect(tool.description).toContain('Search the web')
    expect(webSearchInputSchema.safeParse({ query: 'mastra', limit: 3 }).success).toBe(true)
    expect(webSearchOutputSchema.safeParse({ query: 'mastra', total: 0, results: [] }).success).toBe(true)
    expect(webSearchOutputSchema.parse({ query: 'mastra', total: 0, provider: 'duckduckgo', fallbackFrom: 'tavily', fallbackReason: 'Tavily failed', results: [] })).toMatchObject({
      provider: 'duckduckgo',
      fallbackFrom: 'tavily',
      fallbackReason: 'Tavily failed',
    })
  })

  it('executes through BloomAI executeTool with the injected session id', async () => {
    executeToolMock.mockResolvedValue({
      query: 'mastra',
      total: 1,
      provider: 'duckduckgo',
      fallbackFrom: 'tavily',
      fallbackReason: 'Tavily search failed with HTTP 429',
      results: [{ title: 'Mastra', url: 'https://mastra.ai', snippet: 'Agent framework' }],
    })

    const tool = createWebSearchAdapterTool({ sessionId: 'session-1' })
    const result = await tool.execute?.({ query: 'mastra', limit: 3 }, {} as never)

    expect(executeToolMock).toHaveBeenCalledWith('web_search', { query: 'mastra', limit: 3 }, 'session-1')
    expect(result).toEqual({
      query: 'mastra',
      total: 1,
      provider: 'duckduckgo',
      fallbackFrom: 'tavily',
      fallbackReason: 'Tavily search failed with HTTP 429',
      results: [{ title: 'Mastra', url: 'https://mastra.ai', snippet: 'Agent framework' }],
    })
  })

  it('rejects an empty query through the input schema', () => {
    expect(webSearchInputSchema.safeParse({ query: '' }).success).toBe(false)
  })
})
