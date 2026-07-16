import { describe, expect, it } from 'vitest'
import { ServiceError } from '../services/errors'
import { mapErrorToHttpResponse } from './error-mapper'

describe('mapErrorToHttpResponse', () => {
  it('maps a validation service error to the existing error envelope', () => {
    expect(mapErrorToHttpResponse(new ServiceError('VALIDATION_ERROR', 'model is required'))).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'model is required' } },
    })
  })

  it('maps every stable service code to its HTTP status without exposing HTTP concerns in the service', () => {
    expect(mapErrorToHttpResponse(new ServiceError('NOT_FOUND', 'Missing'))).toMatchObject({ status: 404 })
    expect(mapErrorToHttpResponse(new ServiceError('CONFLICT', 'Duplicate'))).toMatchObject({ status: 409 })
    expect(mapErrorToHttpResponse(new ServiceError('FORBIDDEN', 'Denied'))).toMatchObject({ status: 403 })
    expect(mapErrorToHttpResponse(new ServiceError('UNSUPPORTED_MODEL', 'Unsupported'))).toMatchObject({ status: 400 })
    expect(mapErrorToHttpResponse(new ServiceError('EXTERNAL_SERVICE_ERROR', 'Provider failed'))).toMatchObject({ status: 502 })
  })

  it('sanitizes unknown failures instead of exposing internal details', () => {
    expect(mapErrorToHttpResponse(new Error('provider key=super-secret failed'))).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    })
  })
})
