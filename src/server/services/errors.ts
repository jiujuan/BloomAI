export const SERVICE_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'UNSUPPORTED_MODEL',
  'EXTERNAL_SERVICE_ERROR',
  'CAPABILITY_DENIED',
  'CAPABILITY_APPROVAL_REQUIRED',
  'CAPABILITY_DISABLED',
  'CAPABILITY_NOT_SUPPORTED',
  'TOOL_ERROR',
  'SKILL_ERROR',
  'PACKAGE_SKILL_ASYNC_ONLY',
  'PACKAGE_INSTALL_ERROR',
  'SKILL_VERSION_INCOMPATIBLE',
  'REVISION_CONFLICT',
  'INVALID_RUN_TRANSITION',
  'ARTIFACT_ERROR',
  'ARTICLE_TEXT_TOO_LONG',
  'URL_CONSENT_REQUIRED',
  'URL_NOT_ALLOWED',
  'ARTICLE_FETCH_FAILED',
  'UNSUPPORTED_ARTICLE_FILE',
  'ARTICLE_FILE_UNREADABLE',
  'ARTICLE_FILE_TOO_LARGE',
  'ELIGIBLE_SKILL_REQUIRED',
  'EMPTY_ILLUSTRATION_PLAN',
  'SKILL_RUN_MISSING',
  'SKILL_RUN_NOT_WAITING_APPROVAL',
  'ILLUSTRATION_NOT_STARTED',
  'ARTICLE_ILLUSTRATION_ERROR',
  'UPLOAD_ERROR',
  'INTERNAL_ERROR',
] as const

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number]
export type ServiceErrorDetails = Readonly<Record<string, string | number | boolean | null>>

/**
 * A business-level failure that can be translated by any transport adapter.
 * It deliberately does not expose HTTP status details.
 */
export class ServiceError extends Error {
  readonly name = 'ServiceError'

  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: ServiceErrorDetails,
  ) {
    super(message)
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError
}
