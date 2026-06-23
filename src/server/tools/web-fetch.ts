import type { ToolExecutor } from './types'

export const webFetchTool: ToolExecutor<{ url: string; mode?: string }> = async (input) => {
  const { url, mode = 'text' } = input
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BloomAI/0.2)' }, signal: AbortSignal.timeout(10000) })
  const html = await res.text()
  const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return { title: titleMatch ? titleMatch[1].trim() : url, content: mode === 'html' ? html.slice(0, 8000) : text, url }
}
