import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { executeTool } from '../../tools/execute-tool'
import { researchWriterAgent } from '../agents/research-writer-agent'

/**
 * Minimal deep-research workflow (P6a): a deterministic two-step pipeline that
 * powers the chat "deep" mode.
 *
 *   gatherSources (web_search)  →  map to a prompt  →  researchWriterAgent (streams report)
 *
 * The control flow lives in the workflow (not the model). The writer agent's
 * model/instructions resolve from the request's RequestContext, so it uses the
 * same selected model as chat.
 */

const gatherSources = createStep({
  id: 'gather-sources',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ query: z.string(), sources: z.string() }),
  execute: async ({ inputData }) => {
    const output = await executeTool('web_search', { query: inputData.query, limit: 6 }, 'deep-research')
      .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error), results: [] }))

    const results = Array.isArray((output as any)?.results) ? (output as any).results : []
    const sources = results.length
      ? results
          .map((r: any, i: number) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
          .join('\n\n')
      : `No web results available${(output as any)?.error ? ` (${(output as any).error})` : ''}.`

    return { query: inputData.query, sources }
  },
})

export const deepResearchWorkflow = createWorkflow({
  id: 'deep-research',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(gatherSources)
  .map(async ({ inputData }: { inputData: { query: string; sources: string } }) => ({
    prompt: [
      `Research question:`,
      inputData.query,
      ``,
      `Web search results:`,
      inputData.sources,
      ``,
      `Write a thorough, well-structured answer with inline source links.`,
    ].join('\n'),
  }))
  .then(createStep(researchWriterAgent))
  .commit()
