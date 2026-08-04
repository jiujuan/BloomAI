export type WebBrowserErrorCode =
  | 'WEB_BROWSER_DISABLED'
  | 'WEB_BROWSER_UNAVAILABLE'
  | 'WEB_BROWSER_ABORTED'
  | 'WEB_BROWSER_TIMEOUT'
  | 'WEB_BROWSER_QUEUE_TIMEOUT'
  | 'WEB_BROWSER_NAVIGATION_FAILED'
  | 'WEB_BROWSER_SHUTDOWN'
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
  if (error instanceof Error && error.message.startsWith('WEB_BROWSER_QUEUE_TIMEOUT:')) {
    return new WebBrowserError('WEB_BROWSER_QUEUE_TIMEOUT', 'browser session queue timed out', error)
  }
  if (error instanceof Error && error.message.startsWith('WEB_BROWSER_SHUTDOWN:')) {
    return new WebBrowserError('WEB_BROWSER_SHUTDOWN', 'browser provider is shutting down', error)
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new WebBrowserError('WEB_BROWSER_TIMEOUT', 'browser operation timed out', error)
  }
  if (error instanceof Error && /navigation|net::err_/i.test(error.message)) {
    return new WebBrowserError('WEB_BROWSER_NAVIGATION_FAILED', 'browser navigation failed', error)
  }
  return new WebBrowserError('WEB_BROWSER_UNAVAILABLE', 'browser operation failed', error)
}
