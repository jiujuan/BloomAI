export type WebProviderId = 'static_http' | 'playwright_legacy' | 'agent_browser'

export type WebRoutingPreference = 'auto' | 'static' | 'browser'

export type WebRoutingPolicy = {
  preference: WebRoutingPreference
  browserEnabled: boolean
  allowSearchFallback: boolean
  allowedSearchHosts?: readonly string[]
  searchBrowserConcurrency?: 1
  maxSearchResults?: number
  searchLocale?: string
}

export type WebPageLoadRequest = {
  url: string
  render?: boolean
  timeoutMs?: number
  maxBytes?: number
  signal?: AbortSignal
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
  waitSelector?: string
}

export type WebAttemptDiagnostic = {
  provider: WebProviderId
  outcome: 'success' | 'failed' | 'skipped'
  reason?: string
  durationMs?: number
}

export type WebExecutionDiagnostics = {
  attempts: WebAttemptDiagnostic[]
  blockedRequests?: number
  browserSession?: string
}

export type WebLoadedPage = {
  html: string
  finalUrl: string
  status: number
  charset: string
  contentType?: string
  truncated?: boolean
  rendered: boolean
  provider: WebProviderId
  diagnostics: WebExecutionDiagnostics
}

export type WebProviderAvailability = {
  available: boolean
  reason?: string
}

export interface WebPageProvider {
  readonly id: WebProviderId
  load(request: WebPageLoadRequest): Promise<WebLoadedPage>
  checkAvailability?(): Promise<WebProviderAvailability>
}

export type WebScreenshotRequest = {
  url: string
  fullPage: boolean
  viewport: { width: number; height: number }
  format: 'png' | 'jpeg'
  quality?: number
  timeoutMs: number
  signal?: AbortSignal
}

export type WebScreenshotResult = {
  bytes: Buffer
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  finalUrl: string
  provider: 'agent_browser' | 'playwright_legacy'
  diagnostics: WebExecutionDiagnostics
}

export interface WebScreenshotProvider {
  screenshot(request: WebScreenshotRequest): Promise<WebScreenshotResult>
  checkAvailability?(): Promise<WebProviderAvailability>
}

export type WebSearchProviderId = 'tavily' | 'duckduckgo' | 'agent_browser_serp'

export type WebSearchResult = {
  title: string
  url: string
  snippet: string
}

export type WebSearchRequest = {
  query: string
  limit: number
  signal?: AbortSignal
  fallbackFrom?: Exclude<WebSearchProviderId, 'agent_browser_serp'>
  fallbackReason?: string
}

export type WebSearchOutput = {
  query: string
  total: number
  results: WebSearchResult[]
  provider?: WebSearchProviderId
  fallbackFrom?: Exclude<WebSearchProviderId, 'agent_browser_serp'>
  fallbackReason?: string
  error?: string
  errorCode?: 'WEB_SEARCH_SERP_BLOCKED'
  diagnostics?: WebExecutionDiagnostics
}

export interface WebSearchProvider {
  readonly id: WebSearchProviderId
  search(request: WebSearchRequest): Promise<WebSearchOutput>
}
