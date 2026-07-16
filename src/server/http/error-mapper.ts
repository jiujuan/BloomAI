import type { Context } from 'hono'
import { isServiceError, type ServiceErrorCode, type ServiceErrorDetails } from '../services/errors'

export type HttpErrorStatus = 400 | 403 | 404 | 409 | 500 | 502

export type HttpErrorResponse = {
  status: HttpErrorStatus
  body: { error: { code: ServiceErrorCode; message: string } & ServiceErrorDetails }
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
  CAPABILITY_DENIED: 403,
  CAPABILITY_APPROVAL_REQUIRED: 403,
  CAPABILITY_DISABLED: 403,
  CAPABILITY_NOT_SUPPORTED: 403,
  TOOL_ERROR: 500,
  SKILL_ERROR: 500,
  PACKAGE_SKILL_ASYNC_ONLY: 409,
  PACKAGE_INSTALL_ERROR: 400,
  SKILL_VERSION_INCOMPATIBLE: 409,
  REVISION_CONFLICT: 409,
  INVALID_RUN_TRANSITION: 409,
  ARTIFACT_ERROR: 400,
  ARTICLE_TEXT_TOO_LONG: 400,
  URL_CONSENT_REQUIRED: 400,
  URL_NOT_ALLOWED: 400,
  ARTICLE_FETCH_FAILED: 400,
  UNSUPPORTED_ARTICLE_FILE: 400,
  ARTICLE_FILE_UNREADABLE: 400,
  ARTICLE_FILE_TOO_LARGE: 400,
  ELIGIBLE_SKILL_REQUIRED: 400,
  EMPTY_ILLUSTRATION_PLAN: 400,
  SKILL_RUN_MISSING: 400,
  SKILL_RUN_NOT_WAITING_APPROVAL: 400,
  ILLUSTRATION_NOT_STARTED: 400,
  ARTICLE_ILLUSTRATION_ERROR: 400,
  UPLOAD_ERROR: 500,
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
      body: { error: { code: error.code, message: error.message, ...error.details } },
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
