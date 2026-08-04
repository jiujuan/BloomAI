import type { ToolExecutor } from './types'
import { extractMainHtml, extractMetaDescription, extractTitle, htmlToText } from './utils/html'
import { loadPageWithProviders } from './web/provider-router'
import type { WebLoadedPage, WebPageLoadRequest } from './web/contracts'

export type WebFetchInput = {
  url: string
  /** 'text' (default) = readable article text, 'html' = raw html, 'full' = full-page text. */
  mode?: 'text' | 'html' | 'full'
  /** Max characters to return (default 20000). */
  maxChars?: number
  /** true = force JS rendering, false = static only, omitted = auto (render if thin). */
  render?: boolean
  /** Network timeout per attempt in ms (default 20000). */
  timeoutMs?: number
}

export type WebFetchOutput = {
  title: string
  content: string
  url: string
  finalUrl: string
  status: number
  charset: string
  description?: string
  truncated: boolean
  rendered: boolean
  provider: 'static_http' | 'playwright_legacy' | 'agent_browser'
  diagnostics: {
    attempts: Array<{ provider: string; outcome: string; reason?: string; durationMs?: number }>
    blockedRequests?: number
  }
}

const DEFAULT_MAX_CHARS = 20000
const DEFAULT_TIMEOUT_MS = 20000

export type WebPageLoader = (
  url: string,
  request?: Omit<WebPageLoadRequest, 'url'>,
) => Promise<WebLoadedPage>

export function createWebFetchTool(loadPage: WebPageLoader = loadPageWithProviders): ToolExecutor<WebFetchInput, WebFetchOutput> {
  return async (input, context) => {
    const { url, mode = 'text', maxChars = DEFAULT_MAX_CHARS, render, timeoutMs = DEFAULT_TIMEOUT_MS } = input

    const page = await loadPage(url, { render, timeoutMs, signal: context.signal })
    const title = extractTitle(page.html) || page.finalUrl
    const description = extractMetaDescription(page.html)

    let content: string
    if (mode === 'html') {
      content = page.html
    } else if (mode === 'full') {
      content = htmlToText(page.html)
    } else {
      // Readable-article mode: isolate main content, fall back to full text if thin.
      const main = htmlToText(extractMainHtml(page.html))
      const full = htmlToText(page.html)
      content = main.length >= 200 ? main : full
    }

    const contentTruncated = content.length > maxChars
    if (contentTruncated) content = content.slice(0, maxChars)

    return {
      title,
      content,
      url,
      finalUrl: page.finalUrl,
      status: page.status,
      charset: page.charset,
      description: description || undefined,
      truncated: contentTruncated || page.truncated === true,
      rendered: page.rendered,
      provider: page.provider,
      diagnostics: page.diagnostics,
    }
  }
}

export const webFetchTool = createWebFetchTool()
