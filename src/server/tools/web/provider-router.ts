import { extractMainHtml, htmlToText, fetchPage } from '../utils/html'
import { AgentBrowserProvider } from './agent-browser-provider'
import { createDiagnostics, reasonFromError, recordAttempt } from './browser-diagnostics'
import { WebBrowserError } from './browser-errors'
import { getWebRoutingPolicy } from './config'
import type { WebLoadedPage, WebPageLoadRequest, WebPageProvider, WebRoutingPolicy } from './contracts'
import { UrlPolicyError } from './url-policy'

const MIN_MAIN_TEXT = 200

export class WebPageProviderRouter {
  constructor(
    private readonly staticProvider: WebPageProvider,
    private readonly browserProvider: WebPageProvider,
    private readonly routingPolicy: WebRoutingPolicy = getWebRoutingPolicy(),
  ) {}

  async loadPage(request: WebPageLoadRequest): Promise<WebLoadedPage> {
    const preference = request.render === false
      ? 'static'
      : request.render === true
        ? 'browser'
        : this.routingPolicy.preference

    if (preference === 'static') {
      const staticPage = await this.loadStatic(request)
      return withAttempt(staticPage, {
        provider: 'agent_browser',
        outcome: 'skipped',
        reason: 'routing_preference_static',
      })
    }
    if (preference === 'browser') {
      await this.assertBrowserAvailable()
      return this.loadBrowser(request)
    }

    let staticPage: WebLoadedPage
    try {
      staticPage = await this.loadStatic(request)
    } catch (staticError) {
      if (isNonRetryableStaticError(staticError, request.signal)) throw staticError
      await this.assertBrowserAvailable()
      const browserPage = await this.loadBrowser(request)
      return browserPage
    }

    const mainTextLength = htmlToText(extractMainHtml(staticPage.html)).length
    if (mainTextLength >= MIN_MAIN_TEXT) return withAttempt(staticPage, {
      provider: 'agent_browser',
      outcome: 'skipped',
      reason: 'static_content_sufficient',
    })

    try {
      await this.assertBrowserAvailable()
      const browserPage = await this.loadBrowser(request)
      const browserTextLength = htmlToText(extractMainHtml(browserPage.html)).length
      if (browserTextLength > mainTextLength) return mergePages(staticPage, browserPage)
      return withBrowserAttempts(staticPage, browserPage, 'rendered page did not contain more readable text')
    } catch (browserError) {
      if (isBrowserUnavailable(browserError)) {
        return withAttempt(staticPage, {
          provider: 'agent_browser',
          outcome: 'skipped',
        reason: `unavailable: ${browserError.message.replace(/^WEB_BROWSER_(?:UNAVAILABLE|DISABLED):\s*/, '')}`,
        })
      }
      return withAttempt(staticPage, {
        provider: 'agent_browser',
        outcome: 'failed',
        reason: reasonFromError(browserError),
      })
    }
  }

  async close(): Promise<void> {
    const provider = this.browserProvider as WebPageProvider & { close?: () => Promise<void> }
    await provider.close?.()
  }

  private async loadStatic(request: WebPageLoadRequest): Promise<WebLoadedPage> {
    return this.loadProvider(this.staticProvider, request)
  }

  private async loadBrowser(request: WebPageLoadRequest): Promise<WebLoadedPage> {
    return this.loadProvider(this.browserProvider, request)
  }

  private async assertBrowserAvailable(): Promise<void> {
    if (!this.routingPolicy.browserEnabled) {
      throw new WebBrowserError('WEB_BROWSER_DISABLED', 'browser provider is disabled by configuration')
    }
    const availability = await this.browserProvider.checkAvailability?.()
    if (availability && !availability.available) {
      const disabled = /disabled/i.test(availability.reason ?? '')
      throw new WebBrowserError(
        disabled ? 'WEB_BROWSER_DISABLED' : 'WEB_BROWSER_UNAVAILABLE',
        availability.reason ?? 'browser provider is unavailable',
      )
    }
  }

  private async loadProvider(provider: WebPageProvider, request: WebPageLoadRequest): Promise<WebLoadedPage> {
    const startedAt = Date.now()
    try {
      const result = await provider.load(request)
      return withAttempt(result, {
        provider: provider.id,
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        providerAttempt: {
          provider: provider.id,
          outcome: 'failed' as const,
          reason: reasonFromError(error),
          durationMs: Date.now() - startedAt,
        },
      })
    }
  }
}

export function createWebPageProviderRouter(options: {
  staticProvider?: WebPageProvider
  browserProvider?: WebPageProvider
  routingPolicy?: WebRoutingPolicy
} = {}): WebPageProviderRouter {
  const staticProvider = options.staticProvider ?? createStaticHttpProvider()
  const browserProvider = options.browserProvider ?? new AgentBrowserProvider()
  return new WebPageProviderRouter(staticProvider, browserProvider, options.routingPolicy)
}

let defaultRouter: WebPageProviderRouter | undefined

export function getDefaultWebPageProviderRouter(): WebPageProviderRouter {
  defaultRouter ??= createWebPageProviderRouter()
  return defaultRouter
}

export function resetDefaultWebPageProviderRouter(): void {
  defaultRouter = undefined
}

export async function closeDefaultWebPageProviderRouter(): Promise<void> {
  const router = defaultRouter
  defaultRouter = undefined
  await router?.close()
}

export function loadPageWithProviders(url: string, request: Omit<WebPageLoadRequest, 'url'> = {}): Promise<WebLoadedPage> {
  return getDefaultWebPageProviderRouter().loadPage({ url, ...request })
}

function createStaticHttpProvider(): WebPageProvider {
  return {
    id: 'static_http',
    async load(request) {
      const page = await fetchPage(request.url, {
        timeoutMs: request.timeoutMs,
        maxBytes: request.maxBytes,
        signal: request.signal,
      })
      return {
        html: page.html,
        finalUrl: page.finalUrl,
        status: page.status,
        charset: page.charset,
        contentType: page.contentType,
        truncated: page.truncated,
        rendered: false,
        provider: 'static_http',
        diagnostics: createDiagnostics(),
      }
    },
  }
}

function withAttempt(page: WebLoadedPage, attempt: Parameters<typeof recordAttempt>[1]): WebLoadedPage {
  return { ...page, diagnostics: recordAttempt(page.diagnostics ?? createDiagnostics(), attempt) }
}

function mergePages(staticPage: WebLoadedPage, browserPage: WebLoadedPage): WebLoadedPage {
  return {
    ...browserPage,
    diagnostics: {
      ...browserPage.diagnostics,
      attempts: [...staticPage.diagnostics.attempts, ...browserPage.diagnostics.attempts],
      ...(staticPage.diagnostics.blockedRequests !== undefined || browserPage.diagnostics.blockedRequests !== undefined
        ? { blockedRequests: (staticPage.diagnostics.blockedRequests ?? 0) + (browserPage.diagnostics.blockedRequests ?? 0) }
        : {}),
    },
  }
}

function withBrowserAttempts(
  staticPage: WebLoadedPage,
  browserPage: WebLoadedPage,
  reason: string,
): WebLoadedPage {
  const attempts = browserPage.diagnostics.attempts.map((attempt) => (
    attempt.provider === 'agent_browser' && !attempt.reason ? { ...attempt, reason } : attempt
  ))
  return {
    ...staticPage,
    diagnostics: {
      ...staticPage.diagnostics,
      attempts: [...staticPage.diagnostics.attempts, ...attempts],
      ...(browserPage.diagnostics.blockedRequests !== undefined
        ? { blockedRequests: browserPage.diagnostics.blockedRequests }
        : {}),
    },
  }
}

function isBrowserUnavailable(error: unknown): error is WebBrowserError {
  return error instanceof WebBrowserError
    && (error.code === 'WEB_BROWSER_UNAVAILABLE' || error.code === 'WEB_BROWSER_DISABLED')
}

function isNonRetryableStaticError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true
  if (error instanceof UrlPolicyError) return true
  return error instanceof WebBrowserError
    && (error.code === 'WEB_BROWSER_ABORTED' || error.code === 'WEB_URL_UNSAFE')
}
