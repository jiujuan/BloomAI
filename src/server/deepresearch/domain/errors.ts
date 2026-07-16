export const RESEARCH_DOMAIN_ERROR_CODES = [
  'RESEARCH_INVALID_TRANSITION',
  'RESEARCH_BUDGET_EXHAUSTED',
  'RESEARCH_INVALID_PROFILE',
  'RESEARCH_INVALID_DEPTH',
  'RESEARCH_VALIDATION_ERROR',
  'RESEARCH_CLARIFICATION_REQUIRED',
  'RESEARCH_NOT_RUNNABLE',
] as const

export type ResearchDomainErrorCode = (typeof RESEARCH_DOMAIN_ERROR_CODES)[number]

export type ResearchDomainErrorDetails = Readonly<Record<string, string | number | boolean | null>>

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
