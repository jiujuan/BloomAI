/**
 * Compatibility facade for the historical render helper.
 *
 * Provider selection belongs to the Web Provider Router. Existing callers can
 * keep importing this module while new code uses the router directly.
 */
import { loadPageWithProviders } from '../web/provider-router'

export interface RenderedPage {
  html: string
  finalUrl: string
  status: number
}

export interface RenderOptions {
  timeoutMs?: number
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
  waitSelector?: string
  signal?: AbortSignal
}

export async function renderPage(url: string, opts: RenderOptions = {}): Promise<RenderedPage> {
  const result = await loadPageWithProviders(url, { ...opts, render: true })
  return { html: result.html, finalUrl: result.finalUrl, status: result.status }
}

export interface LoadOptions {
  render?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

export interface LoadedPage {
  html: string
  finalUrl: string
  status: number
  charset: string
  rendered: boolean
  provider?: string
  diagnostics?: unknown
}

export function loadPage(url: string, opts: LoadOptions = {}): Promise<LoadedPage> {
  return loadPageWithProviders(url, opts)
}
