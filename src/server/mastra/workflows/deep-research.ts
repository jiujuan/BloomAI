import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { executeTool } from '../../tools/execute-tool'
import { researchWriterAgent } from '../agents/research-writer-agent'

/**
 * Deep-research workflow (P6c): a richer, deterministic research pipeline behind
 * chat "deep" mode.
 *
 *   plan-questions (LLM decompose)
 *     → search-web (parallel web_search per sub-question, dedup)
 *     → fetch-content (web_fetch top results for full text)
 *     → map to prompt
 *     → research-writer (streams a cited report)
 *
 * The control flow is fixed in the workflow; only the planning/writing use an LLM.
 * Agent steps inherit the request's RequestContext, so model selection matches chat.
 */

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  subQuestion: z.string(),
})

const planQuestions = createStep({
  id: 'plan-questions',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ query: z.string(), subQuestions: z.array(z.string()) }),
  execute: async ({ inputData, mastra, requestContext }) => {
    let subQuestions: string[] = []
    try {
      const planner = mastra.getAgent('research-planner')
      const res = await planner.generate(
        `Research question: ${inputData.query}\n\nReturn a JSON array of 2-3 focused sub-questions.`,
        { requestContext },
      )
      subQuestions = parseSubQuestions(res.text)
    } catch {
      // fall back to the original query below
    }
    if (subQuestions.length === 0) subQuestions = [inputData.query]
    return { query: inputData.query, subQuestions }
  },
})

const searchWeb = createStep({
  id: 'search-web',
  inputSchema: z.object({ query: z.string(), subQuestions: z.array(z.string()) }),
  outputSchema: z.object({
    query: z.string(),
    subQuestions: z.array(z.string()),
    results: z.array(SearchResultSchema),
  }),
  execute: async ({ inputData }) => {
    // Search every sub-question in parallel, then dedup by URL and cap the set.
    const perQuestion = await Promise.all(
      inputData.subQuestions.map(async (subQuestion) => {
        const out = await executeTool('web_search', { query: subQuestion, limit: 4 }, 'deep-research')
          .catch(() => ({ results: [] }))
        const results = Array.isArray((out as any)?.results) ? (out as any).results : []
        return results.map((r: any) => ({
          title: String(r.title ?? r.url ?? ''),
          url: String(r.url ?? ''),
          snippet: String(r.snippet ?? ''),
          subQuestion,
        }))
      }),
    )

    const seen = new Set<string>()
    const results = perQuestion
      .flat()
      .filter((r) => r.url && !seen.has(r.url) && seen.add(r.url))
      .slice(0, 8)

    return { query: inputData.query, subQuestions: inputData.subQuestions, results }
  },
})

const fetchContent = createStep({
  id: 'fetch-content',
  inputSchema: z.object({
    query: z.string(),
    subQuestions: z.array(z.string()),
    results: z.array(SearchResultSchema),
  }),
  outputSchema: z.object({ query: z.string(), sources: z.string() }),
  execute: async ({ inputData }) => {
    // Fetch full text for the top few results to give the writer real content, not just snippets.
    const topToFetch = inputData.results.slice(0, 3)
    const fetched = await Promise.all(
      topToFetch.map(async (r) => {
        const out = await executeTool('web_fetch', { url: r.url }, 'deep-research').catch(() => null)
        const content = out && typeof (out as any).content === 'string' ? (out as any).content.slice(0, 800) : ''
        return [r.url, content] as const
      }),
    )
    const contentByUrl = new Map(fetched)

    const sources = inputData.results.length
      ? inputData.results
          .map((r, i) => {
            const excerpt = contentByUrl.get(r.url)
            return `[${i + 1}] (${r.subQuestion})\n${r.title}\n${r.url}\n${r.snippet}${excerpt ? `\n正文摘录: ${excerpt}` : ''}`
          })
          .join('\n\n')
      : 'No web results available.'

    return { query: inputData.query, sources }
  },
})

export const deepResearchWorkflow = createWorkflow({
  id: 'deep-research',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(planQuestions)
  .then(searchWeb)
  .then(fetchContent)
  .map(async ({ inputData }: { inputData: { query: string; sources: string } }) => ({
    prompt: [
      `Research question:`,
      inputData.query,
      ``,
      `Sources (with excerpts):`,
      inputData.sources,
      ``,
      `Write a thorough, well-structured answer with inline source links. Synthesize across sources; do not just list them.`,
    ].join('\n'),
  }))
  .then(createStep(researchWriterAgent))
  .commit()

function parseSubQuestions(text: string): string[] {
  try {
    const match = text.match(/\[[\s\S]*\]/)
    const parsed = JSON.parse(match ? match[0] : text)
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 3)
    }
  } catch {
    // ignore — caller falls back to the original query
  }
  return []
}
