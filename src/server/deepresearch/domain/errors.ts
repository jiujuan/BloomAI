export const RESEARCH_DOMAIN_ERROR_CODES = [
  'RESEARCH_INVALID_TRANSITION',
  'RESEARCH_ATTEMPT_INVALID_TRANSITION',
  'RESEARCH_NOT_RESUMABLE',
  'RESEARCH_CANCELLED',
  'RESEARCH_BUDGET_EXHAUSTED',
  'RESEARCH_INVALID_PROFILE',
  'RESEARCH_INVALID_DEPTH',
  'RESEARCH_VALIDATION_ERROR',
  'RESEARCH_CLARIFICATION_REQUIRED',
  'RESEARCH_NOT_RUNNABLE',
  'RESEARCH_CROSS_RUN_CITATION',
] as const

export type ResearchDomainErrorCode = (typeof RESEARCH_DOMAIN_ERROR_CODES)[number]

export type ResearchDomainErrorDetails = Readonly<Record<string, string | number | boolean | null>>
export type ResearchErrorClassification = {
  code: string
  message: string
  retryable: boolean
  category: 'cancelled' | 'validation' | 'budget' | 'provider' | 'network' | 'timeout' | 'rate_limit' | 'concurrency' | 'workflow' | 'internal'
}

export class ResearchDomainError extends Error {
  readonly name = 'ResearchDomainError'

  constructor(
    readonly code: ResearchDomainErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly details?: ResearchDomainErrorDetails,
  ) {
    super(code + ': ' + message)
  }
}

export function isResearchDomainError(error: unknown): error is ResearchDomainError {
  return error instanceof ResearchDomainError
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : String(error)
}

export function classifyResearchError(error: unknown): ResearchErrorClassification {
  if (isResearchDomainError(error)) {
    if (error.code === 'RESEARCH_CANCELLED') return { code: error.code, message: error.message, retryable: false, category: 'cancelled' }
    if (error.code === 'RESEARCH_BUDGET_EXHAUSTED') return { code: error.code, message: error.message, retryable: false, category: 'budget' }
    if (['RESEARCH_INVALID_PROFILE', 'RESEARCH_INVALID_DEPTH', 'RESEARCH_VALIDATION_ERROR'].includes(error.code)) {
      return { code: error.code, message: error.message, retryable: false, category: 'validation' }
    }
    return { code: error.code, message: error.message, retryable: error.retryable, category: 'workflow' }
  }

  const message = errorMessage(error)
  if (hasCode(error, 'ABORT_ERR') || (error instanceof Error && error.name === 'AbortError')) {
    return { code: 'RESEARCH_CANCELLED', message, retryable: false, category: 'cancelled' }
  }
  if (hasCode(error, 'ETIMEDOUT') || /timeout|timed out/i.test(message)) {
    return { code: 'RESEARCH_PROVIDER_TIMEOUT', message, retryable: true, category: 'timeout' }
  }
  if (hasCode(error, '429') || /rate.?limit/i.test(message)) {
    return { code: 'RESEARCH_PROVIDER_RATE_LIMIT', message, retryable: true, category: 'rate_limit' }
  }
  if (typeof error === 'object' && error !== null && 'code' in error && /^(ECONN|ENOTFOUND|EAI_AGAIN|ECONNRESET)/.test(String((error as { code?: unknown }).code))) {
    return { code: 'RESEARCH_PROVIDER_NETWORK', message, retryable: true, category: 'network' }
  }
  return { code: 'RESEARCH_INTERNAL_ERROR', message, retryable: false, category: 'internal' }
}