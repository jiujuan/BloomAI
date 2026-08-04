export type WebBrowserErrorCode =
  | 'WEB_BROWSER_DISABLED'
  | 'WEB_BROWSER_UNAVAILABLE'
  | 'WEB_BROWSER_ABORTED'
  | 'WEB_BROWSER_TIMEOUT'
  | 'WEB_BROWSER_LIMIT'
  | 'WEB_URL_UNSAFE'

export class WebBrowserError extends Error {
  constructor(
    readonly code: WebBrowserErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`${code}: ${message}`)
    this.name = 'WebBrowserError'
  }
}

export function isAbortLike(error: unknown): boolean {
  return error instanceof WebBrowserError
    ? error.code === 'WEB_BROWSER_ABORTED'
    : error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

export function mapBrowserError(error: unknown, signal?: AbortSignal): WebBrowserError {
  if (error instanceof WebBrowserError) return error
  if (signal?.aborted) return new WebBrowserError('WEB_BROWSER_ABORTED', 'browser operation was cancelled', error)
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new WebBrowserError('WEB_BROWSER_TIMEOUT', 'browser operation timed out', error)
  }
  return new WebBrowserError('WEB_BROWSER_UNAVAILABLE', error instanceof Error ? error.message : String(error), error)
}
