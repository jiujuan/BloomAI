import type { ToolExecutor } from './types'

export const webSearchTool: ToolExecutor<{ query: string; limit?: number }> = async (input) => {
  const { query, limit = 8 } = input
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json() as any
    const results: any[] = []
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, limit)) {
        if (topic.Text && topic.FirstURL) results.push({ title: topic.Text.split(' - ')[0] || topic.Text, url: topic.FirstURL, snippet: topic.Text })
      }
    }
    if (data.Abstract && data.AbstractURL) results.unshift({ title: data.Heading || query, url: data.AbstractURL, snippet: data.Abstract })
    return { results: results.slice(0, limit), query, total: results.length }
  } catch (err: any) {
    return { results: [], query, error: err.message }
  }
}
