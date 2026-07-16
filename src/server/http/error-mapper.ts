import type { Context } from 'hono'
import { isServiceError, type ServiceErrorCode } from '../services/errors'

export type HttpErrorStatus = 400 | 403 | 404 | 409 | 500 | 502

export type HttpErrorResponse = {
  status: HttpErrorStatus
  body: { error: { code: ServiceErrorCode; message: string } }
}

type HttpErrorLogger = (
  scope: string,
  error: unknown,
  details?: Record<string, unknown>,
) => unknown

const STATUS_BY_SERVICE_ERROR: Record<ServiceErrorCode, HttpErrorStatus> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  UNSUPPORTED_MODEL: 400,
  EXTERNAL_SERVICE_ERROR: 502,
  INTERNAL_ERROR: 500,
}

/**
 * Converts application failures into the stable HTTP error envelope without
 * coupling services to Hono or HTTP status codes.
 */
export function mapErrorToHttpResponse(error: unknown): HttpErrorResponse {
  if (isServiceError(error)) {
    return {
      status: STATUS_BY_SERVICE_ERROR[error.code],
      body: { error: { code: error.code, message: error.message } },
    }
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
  }
}

/**
 * Produces the Hono global error handler used by the HTTP app. Logging keeps
 * the original failure for diagnostics; the response remains sanitized.
 */
export function createHttpErrorHandler(logError: HttpErrorLogger) {
  return (error: Error, context: Context) => {
    logError('http.error', error, { method: context.req.method, path: context.req.path })
    const response = mapErrorToHttpResponse(error)
    return context.json(response.body, response.status)
  }
}
