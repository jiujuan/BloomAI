import type { ToolExecutor } from './types'
import { webFetchTool } from './web-fetch'

export const webExtractTool: ToolExecutor<{ url: string }> = async (input) => {
  const page = await webFetchTool({ url: input.url, mode: 'html' }, { toolId: 'web_fetch' }) as any
  const html = page.content || ''
  const headings: string[] = []
  for (const h of (html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi) || []).slice(0, 10)) {
    const text = h.replace(/<[^>]+>/g, '').trim(); if (text) headings.push(text)
  }
  const links: any[] = []
  for (const a of (html.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi) || []).slice(0, 20)) {
    const m = a.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/i)
    if (m) links.push({ url: m[1], text: m[2].trim() })
  }
  return { headings, links, title: page.title }
}
