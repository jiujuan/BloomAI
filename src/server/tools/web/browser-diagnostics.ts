import type { WebAttemptDiagnostic, WebExecutionDiagnostics } from './contracts'

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
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
}
