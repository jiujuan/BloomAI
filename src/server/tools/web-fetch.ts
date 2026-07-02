import type { ToolExecutor } from './types'
import { extractMainHtml, extractMetaDescription, extractTitle, htmlToText } from './utils/html'
import { loadPage } from './utils/render'

type WebFetchInput = {
  url: string
  /** 'text' (default) = readable article text, 'html' = raw html, 'full' = full-page text. */
  mode?: 'text' | 'html' | 'full'
  /** Max characters to return (default 20000). */
  maxChars?: number
  /** true = force JS rendering, false = static only, omitted = auto (render if thin). */
  render?: boolean
}

type WebFetchOutput = {
  title: string
  content: string
  url: string
  finalUrl: string
  status: number
  charset: string
  description?: string
  truncated: boolean
  rendered: boolean
}

const DEFAULT_MAX_CHARS = 20000

export const webFetchTool: ToolExecutor<WebFetchInput, WebFetchOutput> = async (input) => {
  const { url, mode = 'text', maxChars = DEFAULT_MAX_CHARS, render } = input

  const page = await loadPage(url, { render })
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

  const truncated = content.length > maxChars
  if (truncated) content = content.slice(0, maxChars)

  return {
    title,
    content,
    url: url,
    finalUrl: page.finalUrl,
    status: page.status,
    charset: page.charset,
    description: description || undefined,
    truncated,
    rendered: page.rendered,
  }
}
