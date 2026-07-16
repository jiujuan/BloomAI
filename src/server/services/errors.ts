export const SERVICE_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'UNSUPPORTED_MODEL',
  'EXTERNAL_SERVICE_ERROR',
  'INTERNAL_ERROR',
] as const

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number]

/**
 * A business-level failure that can be translated by any transport adapter.
 * It deliberately does not expose HTTP status details.
 */
export class ServiceError extends Error {
  readonly name = 'ServiceError'

  constructor(readonly code: ServiceErrorCode, message: string) {
    super(message)
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError
}
