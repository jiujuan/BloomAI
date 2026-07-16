import { describe, expect, it } from 'vitest'
import { ServiceError, isServiceError, type ServiceErrorCode } from './errors'

describe('ServiceError', () => {
  it('preserves a stable business code and safe message without HTTP details', () => {
    const error = new ServiceError('NOT_FOUND', 'Persona not found')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ServiceError')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.message).toBe('Persona not found')
    expect('status' in error).toBe(false)
    expect('statusCode' in error).toBe(false)
  })

  it.each<ServiceErrorCode>([
    'VALIDATION_ERROR',
    'NOT_FOUND',
    'CONFLICT',
    'FORBIDDEN',
    'UNSUPPORTED_MODEL',
    'EXTERNAL_SERVICE_ERROR',
    'INTERNAL_ERROR',
  ])('identifies %s as a service error', (code) => {
    expect(isServiceError(new ServiceError(code, 'message'))).toBe(true)
  })

  it('does not classify arbitrary errors as service errors', () => {
    expect(isServiceError(new Error('message'))).toBe(false)
    expect(isServiceError({ code: 'NOT_FOUND', message: 'spoofed' })).toBe(false)
  })
})
