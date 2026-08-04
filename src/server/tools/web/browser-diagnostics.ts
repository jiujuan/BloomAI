import type { WebAttemptDiagnostic, WebExecutionDiagnostics } from './contracts'
import { WebBrowserError } from './browser-errors'

export function createDiagnostics(): WebExecutionDiagnostics {
  return { attempts: [] }
}

export function recordAttempt(
  diagnostics: WebExecutionDiagnostics,
  attempt: WebAttemptDiagnostic,
): WebExecutionDiagnostics {
  return {
    ...diagnostics,
    attempts: [...diagnostics.attempts, attempt],
  }
}

export function reasonFromError(error: unknown): string {
  return redactBrowserError(error)
}

/**
 * Diagnostics are intentionally classified, not copied from browser errors.
 * Browser messages can contain URLs, file paths, response snippets, or headers.
 */
export function redactBrowserError(error: unknown): string {
  if (error instanceof WebBrowserError) return error.code
  if (error instanceof Error && error.name === 'TimeoutError') return 'WEB_BROWSER_TIMEOUT'
  if (error instanceof Error && /navigation|net::err_/i.test(error.message)) {
    return 'WEB_BROWSER_NAVIGATION_FAILED'
  }
  return 'WEB_BROWSER_FAILED'
}
