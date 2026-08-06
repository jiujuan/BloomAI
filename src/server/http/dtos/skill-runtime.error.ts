import type { Context } from 'hono'
import { z } from 'zod'
import { mapErrorToHttpResponse } from '../error-mapper'
import { ServiceError } from '../../services/errors'

export function validationError(message: string) {
  return new ServiceError('VALIDATION_ERROR', message)
}

export function errorResponse(c: Context, error: unknown) {
  if (error instanceof z.ZodError) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request' } }, 400)
  }
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}
