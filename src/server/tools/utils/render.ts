/**
 * Optional JS rendering via playwright-core, driving the user's system browser
 * (Edge/Chrome). No browser binaries are bundled or downloaded — playwright-core
 * only ships the automation client. If no system browser is found, rendering
 * throws and callers fall back to a plain static fetch.
 *
 * The browser is launched once and reused across calls, then auto-closed after a
 * period of inactivity (cold launch is ~several seconds; reuse is fast).
 */
import type { Browser } from 'playwright-core'
import { extractMainHtml, htmlToText, fetchPage, getProxyUrl } from './html'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const RENDER_TIMEOUT_MS = 20000
const BROWSER_IDLE_MS = 60000
/** Below this many chars of main text, an auto-load retries with JS rendering. */
const MIN_MAIN_TEXT = 200

let browserPromise: Promise<Browser> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = launchBrowser()
  try {
    const browser = await browserPromise
    if (!browser.isConnected()) {
      browserPromise = launchBrowser()
      return browserPromise
    }
    return browser
  } catch (err) {
    browserPromise = null
    throw err
  }
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright-core')
  const channels = ['msedge', 'chrome', 'msedge-beta', 'chrome-beta']
  let lastError: unknown
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch (err) {
      lastError = err
    }
  }
  const detail = lastError instanceof Error ? lastError.message.split('\n')[0] : String(lastError)
  throw new Error(`No system browser (Edge/Chrome) available for JS rendering: ${detail}`)
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const pending = browserPromise
    browserPromise = null
    idleTimer = null
    void pending?.then((b) => b.close()).catch(() => {})
  }, BROWSER_IDLE_MS)
  // Do not keep the process alive just for the idle timer.
  if (typeof idleTimer === 'object' && 'unref' in idleTimer) (idleTimer as any).unref()
}

export interface RenderedPage {
  html: string
  finalUrl: string
  status: number
}

export interface RenderOptions {
  timeoutMs?: number
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
  /** Optional CSS selector to wait for before reading the DOM. */
  waitSelector?: string
}

/** Render a page with a real browser and return the post-JS HTML. */
export async function renderPage(url: string, opts: RenderOptions = {}): Promise<RenderedPage> {
  const browser = await getBrowser()
  try {
    return await navigate(browser, url, opts)
  } catch (err) {
    // Direct navigation failed — retry through the local proxy if configured.
    const proxyServer = getProxyUrl()
    if (!proxyServer) throw err
    return await navigate(browser, url, opts, proxyServer)
  }
}

async function navigate(
  browser: Browser,
  url: string,
  opts: RenderOptions,
  proxyServer?: string,
): Promise<RenderedPage> {
  const { timeoutMs = RENDER_TIMEOUT_MS, waitUntil = 'domcontentloaded', waitSelector } = opts
  const context = await browser.newContext({
    userAgent: DEFAULT_UA,
    locale: 'zh-CN',
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
  })
  try {
    const page = await context.newPage()
    const response = await page.goto(url, { waitUntil, timeout: timeoutMs })
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 5000 }).catch(() => {})
    }
    // Give late hydration a brief moment to settle.
    await page.waitForTimeout(600)
    const html = await page.content()
    return { html, finalUrl: page.url(), status: response?.status() ?? 200 }
  } finally {
    await context.close().catch(() => {})
    scheduleIdleClose()
  }
}

export interface LoadOptions {
  /** true = force render, false = static only, undefined = auto (render if thin). */
  render?: boolean
  timeoutMs?: number
}

export interface LoadedPage {
  html: string
  finalUrl: string
  status: number
  charset: string
  rendered: boolean
}

/**
 * Load a page's HTML, transparently choosing static fetch vs JS rendering.
 * Both web_fetch and web_extract go through this so behaviour stays consistent.
 */
export async function loadPage(url: string, opts: LoadOptions = {}): Promise<LoadedPage> {
  const forced = opts.render

  if (forced === true) {
    try {
      const r = await renderPage(url, { timeoutMs: opts.timeoutMs })
      return { html: r.html, finalUrl: r.finalUrl, status: r.status, charset: 'utf-8', rendered: true }
    } catch {
      // Fall back to static fetch below.
    }
  }

  const staticPage = await fetchPage(url, { timeoutMs: opts.timeoutMs })
  if (forced === false) return { ...staticPage, rendered: false }

  // Auto mode: only pay for rendering when the static page looks empty/thin
  // (typical of client-rendered SPAs).
  const mainTextLen = htmlToText(extractMainHtml(staticPage.html)).length
  if (mainTextLen >= MIN_MAIN_TEXT) return { ...staticPage, rendered: false }

  try {
    const r = await renderPage(url, { timeoutMs: opts.timeoutMs })
    // Only prefer the rendered result if it actually produced more content.
    const renderedLen = htmlToText(extractMainHtml(r.html)).length
    if (renderedLen > mainTextLen) {
      return { html: r.html, finalUrl: r.finalUrl, status: r.status, charset: 'utf-8', rendered: true }
    }
  } catch {
    // Rendering unavailable (no browser) — keep the static result.
  }
  return { ...staticPage, rendered: false }
}
