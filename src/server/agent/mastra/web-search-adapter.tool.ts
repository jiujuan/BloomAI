import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { executeTool } from '../../tools/execute-tool'

export const webSearchInputSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().positive().optional(),
})

export const webSearchOutputSchema = z.object({
  query: z.string(),
  total: z.number().optional(),
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      }),
    )
    .default([]),
  error: z.string().optional(),
})

export type WebSearchAdapterToolOptions = {
  sessionId?: string
}

export function createWebSearchAdapterTool(options: WebSearchAdapterToolOptions = {}) {
  return createTool({
    id: 'web_search',
    description: 'Search the web and return relevant results with titles, URLs, and snippets.',
    inputSchema: webSearchInputSchema,
    outputSchema: webSearchOutputSchema,
    execute: async (input) => webSearchOutputSchema.parse(await executeTool('web_search', input, options.sessionId)),
  })
}
