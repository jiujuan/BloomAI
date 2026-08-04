import { extractMainHtml, htmlToText, fetchPage } from '../utils/html'
import { AgentBrowserProvider } from './agent-browser-provider'
import { createDiagnostics, reasonFromError, recordAttempt } from './browser-diagnostics'
import type { WebLoadedPage, WebPageLoadRequest, WebPageProvider } from './contracts'

const MIN_MAIN_TEXT = 200

export class WebPageProviderRouter {
  constructor(
    private readonly staticProvider: WebPageProvider,
    private readonly browserProvider: WebPageProvider,
  ) {}

  async loadPage(request: WebPageLoadRequest): Promise<WebLoadedPage> {
    if (request.render === false) return this.loadStatic(request)
    if (request.render === true) {
      try {
        return await this.loadBrowser(request)
      } catch (browserError) {
        const staticPage = await this.loadStatic(request)
        return withAttempt(staticPage, {
          provider: 'agent_browser',
          outcome: 'failed',
          reason: reasonFromError(browserError),
        })
      }
    }

    let staticPage: WebLoadedPage
    try {
      staticPage = await this.loadStatic(request)
    } catch (staticError) {
      try {
        return await this.loadBrowser(request)
      } catch (browserError) {
        throw new Error(`Web page providers failed: static=${reasonFromError(staticError)}; browser=${reasonFromError(browserError)}`)
      }
    }

    const mainTextLength = htmlToText(extractMainHtml(staticPage.html)).length
    if (mainTextLength >= MIN_MAIN_TEXT) return staticPage

    try {
      const browserPage = await this.loadBrowser(request)
      const browserTextLength = htmlToText(extractMainHtml(browserPage.html)).length
      return browserTextLength > mainTextLength ? browserPage : withAttempt(staticPage, {
        provider: 'agent_browser',
        outcome: 'success',
        reason: 'rendered page did not contain more readable text',
      })
    } catch (browserError) {
      return withAttempt(staticPage, {
        provider: 'agent_browser',
        outcome: 'failed',
        reason: reasonFromError(browserError),
      })
    }
  }

  private async loadStatic(request: WebPageLoadRequest): Promise<WebLoadedPage> {
    return this.loadProvider(this.staticProvider, request)
  }

  private async loadBrowser(request: WebPageLoadRequest): Promise<WebLoadedPage> {
    return this.loadProvider(this.browserProvider, request)
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
} = {}): WebPageProviderRouter {
  const staticProvider = options.staticProvider ?? createStaticHttpProvider()
  const browserProvider = options.browserProvider ?? new AgentBrowserProvider()
  return new WebPageProviderRouter(staticProvider, browserProvider)
}

let defaultRouter: WebPageProviderRouter | undefined

export function getDefaultWebPageProviderRouter(): WebPageProviderRouter {
  defaultRouter ??= createWebPageProviderRouter()
  return defaultRouter
}

export function resetDefaultWebPageProviderRouter(): void {
  defaultRouter = undefined
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
