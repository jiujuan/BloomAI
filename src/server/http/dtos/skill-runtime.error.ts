import type { Context } from 'hono'
import { z } from 'zod'
import { mapErrorToHttpResponse } from '../error-mapper'
import { ServiceError } from '../../services/errors'
import { getRequestId } from '../request-context'

export function validationError(message: string) {
  return new ServiceError('VALIDATION_ERROR', message)
}

export function errorResponse(c: Context, error: unknown) {
  const requestId = getRequestId(c)
  const normalized = error instanceof z.ZodError
    ? validationError(error.issues[0]?.message ?? 'Invalid request')
    : error
  const response = mapErrorToHttpResponse(normalized, requestId)
  return c.json(response.body, response.status)
}
