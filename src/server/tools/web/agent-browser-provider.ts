import type { Browser, BrowserContext, Page, Route } from 'playwright-core'
import { chromium } from 'playwright-core'
import { getProxyUrl } from '../utils/html'
import { createBrowserRequestGuard, validateInitialUrl } from './url-policy'
import { WebBrowserError, mapBrowserError } from './browser-errors'
import { BrowserSessionPool } from './browser-session-pool'
import { getWebBrowserConfig, type WebBrowserConfig } from './config'
import type {
  WebLoadedPage,
  WebPageLoadRequest,
  WebPageProvider,
  WebProviderAvailability,
  WebScreenshotProvider,
  WebScreenshotRequest,
  WebScreenshotResult,
} from './contracts'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

type BrowserLauncher = (channels: readonly string[]) => Promise<Browser>
type UrlValidator = (url: string) => Promise<URL>

export type AgentBrowserProviderOptions = {
  config?: WebBrowserConfig
  launchBrowser?: BrowserLauncher
  validateUrl?: UrlValidator
}

export class AgentBrowserProvider implements WebPageProvider, WebScreenshotProvider {
  readonly id = 'agent_browser' as const
  private readonly config: WebBrowserConfig
  private readonly launch: BrowserLauncher
  private readonly validateUrl: UrlValidator
  private browserPromise: Promise<Browser> | undefined
  private readonly pool: BrowserSessionPool<BrowserContext>
  private idleClosePromise: Promise<void> | undefined

  constructor(options: AgentBrowserProviderOptions = {}) {
    this.config = options.config ?? getWebBrowserConfig()
    this.launch = options.launchBrowser ?? launchSystemBrowser
    this.validateUrl = options.validateUrl ?? ((url) => validateInitialUrl(url))
    this.pool = new BrowserSessionPool(
      async () => {
        const browser = await this.getBrowser()
        return browser.newContext({
          userAgent: DEFAULT_USER_AGENT,
          locale: 'zh-CN',
          ...(getProxyUrl() ? { proxy: { server: getProxyUrl() } } : {}),
        })
      },
      {
        maxConcurrency: this.config.maxConcurrency,
        queueTimeoutMs: this.config.queueTimeoutMs,
        idleTimeoutMs: this.config.idleTimeoutMs,
        onIdle: () => this.closeIdleBrowser(),
      },
    )
  }

  async checkAvailability(): Promise<WebProviderAvailability> {
    if (!this.config.enabled) return { available: false, reason: 'WEB_BROWSER_ENABLED is false' }
    try {
      const browser = await this.getBrowser()
      return { available: browser.isConnected(), reason: browser.isConnected() ? undefined : 'browser disconnected' }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { available: false, reason: reason.replace(/^WEB_BROWSER_[A-Z_]+:\s*/, '') }
    }
  }

  async load(request: WebPageLoadRequest): Promise<WebLoadedPage> {
    if (!this.config.enabled) {
      throw new WebBrowserError('WEB_BROWSER_DISABLED', 'browser provider is disabled by configuration')
    }
    const startedAt = Date.now()
    const session = await this.pool.acquire(request.signal)
    let page: Page | undefined
    let blockedRequests = 0
    try {
      page = await session.context.newPage()
      throwIfAborted(request.signal)
      const detachAbort = closePageOnAbort(page, request.signal)
      try {
        const navigation = await this.navigate(page, request, (count) => { blockedRequests += count })
        const html = await page.content()
        return {
          html,
          finalUrl: navigation.finalUrl,
          status: navigation.status,
          charset: 'utf-8',
          contentType: 'text/html; charset=utf-8',
          truncated: false,
          rendered: true,
          provider: 'agent_browser',
          diagnostics: {
            attempts: [{
              provider: 'agent_browser',
              outcome: 'success',
              durationMs: Date.now() - startedAt,
            }],
            blockedRequests,
          },
        }
      } finally {
        detachAbort()
      }
    } catch (error) {
      if (error instanceof WebBrowserError) throw error
      throw mapBrowserError(error, request.signal)
    } finally {
      await page?.close().catch(() => {})
      await session.release()
    }
  }

  async screenshot(request: WebScreenshotRequest): Promise<WebScreenshotResult> {
    if (!this.config.enabled) {
      throw new WebBrowserError('WEB_BROWSER_DISABLED', 'browser provider is disabled by configuration')
    }
    assertViewport(request.viewport.width, request.viewport.height, this.config)
    const startedAt = Date.now()
    const session = await this.pool.acquire(request.signal)
    let page: Page | undefined
    let blockedRequests = 0
    try {
      page = await session.context.newPage()
      throwIfAborted(request.signal)
      await page.setViewportSize(request.viewport)
      const detachAbort = closePageOnAbort(page, request.signal)
      try {
        const navigation = await this.navigate(page, {
          url: request.url,
          timeoutMs: request.timeoutMs,
          signal: request.signal,
        }, (count) => { blockedRequests += count })
        const documentHeight = await page.evaluate(() => Math.max(
          document.body?.scrollHeight ?? 0,
          document.documentElement?.scrollHeight ?? 0,
          window.innerHeight,
        )) as number
        const height = request.fullPage ? documentHeight : request.viewport.height
        if (height > this.config.maxPageHeight || request.viewport.width * height > this.config.maxPixels) {
          throw new WebBrowserError('WEB_SCREENSHOT_LIMIT_EXCEEDED', 'screenshot dimensions exceed the configured limit')
        }
        const bytes = await page.screenshot({
          fullPage: request.fullPage,
          type: request.format,
          ...(request.format === 'jpeg' && request.quality !== undefined ? { quality: request.quality } : {}),
        })
        if (bytes.byteLength > this.config.maxArtifactBytes) {
          throw new WebBrowserError('WEB_SCREENSHOT_LIMIT_EXCEEDED', 'screenshot artifact exceeds the configured limit')
        }
        return {
          bytes,
          mimeType: request.format === 'jpeg' ? 'image/jpeg' : 'image/png',
          width: request.viewport.width,
          height,
          finalUrl: navigation.finalUrl,
          provider: 'agent_browser',
          diagnostics: {
            attempts: [{
              provider: 'agent_browser',
              outcome: 'success',
              durationMs: Date.now() - startedAt,
            }],
            blockedRequests,
          },
        }
      } finally {
        detachAbort()
      }
    } catch (error) {
      if (error instanceof WebBrowserError) throw error
      throw mapBrowserError(error, request.signal)
    } finally {
      await page?.close().catch(() => {})
      await session.release()
    }
  }

  async close(): Promise<void> {
    await this.idleClosePromise?.catch(() => {})
    await this.pool.close()
    const browser = await this.browserPromise?.catch(() => undefined)
    this.idleClosePromise = undefined
    this.browserPromise = undefined
    await browser?.close().catch(() => {})
  }

  get activeContextCount(): number {
    return this.pool.activeCount
  }

  get peakActiveContextCount(): number {
    return this.pool.peakActiveCount
  }

  get maxContextConcurrency(): number {
    return this.config.maxConcurrency
  }

  private async getBrowser(): Promise<Browser> {
    await this.idleClosePromise?.catch(() => {})
    if (!this.config.enabled) {
      throw new WebBrowserError('WEB_BROWSER_DISABLED', 'browser provider is disabled by configuration')
    }
    if (!this.browserPromise) this.browserPromise = this.launch(this.config.channels)
    try {
      const browser = await this.browserPromise
      if (!browser.isConnected()) {
        this.browserPromise = this.launch(this.config.channels)
        return await this.browserPromise
      }
      return browser
    } catch (error) {
      this.browserPromise = undefined
      throw new WebBrowserError('WEB_BROWSER_UNAVAILABLE', 'no configured system browser could be launched', error)
    }
  }

  private async navigate(
    page: Page,
    request: Pick<WebPageLoadRequest, 'url' | 'timeoutMs' | 'signal' | 'waitUntil' | 'waitSelector'>,
    onBlocked?: (count: number) => void,
  ): Promise<{ finalUrl: string; status: number }> {
    const timeoutMs = Math.min(request.timeoutMs ?? this.config.timeoutMs, this.config.timeoutMs)
    throwIfAborted(request.signal)
    try {
      await this.validateUrl(request.url)
      let blocked = 0
      const guard = createBrowserRequestGuard(this.validateUrl)
      await page.route('**/*', async (route) => {
        const allowed = await guard(route, request.signal)
        if (!allowed) blocked += 1
      })
      const response = await page.goto(request.url, {
        waitUntil: request.waitUntil ?? 'domcontentloaded',
        timeout: timeoutMs,
      })
      throwIfAborted(request.signal)
      if (request.waitSelector) await page.waitForSelector(request.waitSelector, { timeout: Math.min(timeoutMs, 5_000) }).catch(() => {})
      await page.waitForTimeout(250)
      throwIfAborted(request.signal)
      const finalUrl = (await this.validateUrl(page.url())).toString()
      onBlocked?.(blocked)
      return {
        finalUrl: finalUrl || response?.url() || request.url,
        status: response?.status() ?? 200,
      }
    } catch (error) {
      if (error instanceof WebBrowserError) throw error
      if (error instanceof Error && error.message.toLowerCase().includes('unsafe external url')) {
        throw new WebBrowserError('WEB_URL_UNSAFE', error.message, error)
      }
      throw mapBrowserError(error, request.signal)
    }
  }

  private closeIdleBrowser(): Promise<void> {
    if (this.idleClosePromise) return this.idleClosePromise
    this.idleClosePromise = (async () => {
      if (this.pool.activeCount !== 0) return
      const browser = await this.browserPromise?.catch(() => undefined)
      if (!browser || this.pool.activeCount !== 0) return
      this.browserPromise = undefined
      await browser.close().catch(() => {})
    })().finally(() => {
      this.idleClosePromise = undefined
    })
    return this.idleClosePromise
  }
}

async function launchSystemBrowser(channels: readonly string[]): Promise<Browser> {
  let lastError: unknown
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('system browser launch failed')
}

export async function allowBrowserRequest(
  route: Route,
  signal: AbortSignal | undefined,
  validateUrl: UrlValidator,
): Promise<boolean> {
  return createBrowserRequestGuard(validateUrl)(route, signal)
}

function closePageOnAbort(page: Page, signal: AbortSignal | undefined): () => void {
  if (!signal) return () => {}
  const onAbort = () => { void page.close().catch(() => {}) }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new WebBrowserError('WEB_BROWSER_ABORTED', 'browser operation was cancelled', signal.reason)
}

function assertViewport(width: number, height: number, config: WebBrowserConfig): void {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 320
    || height < 240
    || width > config.maxViewportWidth
    || height > config.maxViewportHeight
  ) {
    throw new WebBrowserError('WEB_SCREENSHOT_LIMIT_EXCEEDED', 'viewport exceeds the configured limit')
  }
}
