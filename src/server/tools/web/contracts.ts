export type WebProviderId = 'static_http' | 'playwright_legacy' | 'agent_browser'

export type WebRoutingPreference = 'auto' | 'static' | 'browser'

export type WebRoutingPolicy = {
  preference: WebRoutingPreference
  browserEnabled: boolean
  allowSearchFallback: boolean
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
