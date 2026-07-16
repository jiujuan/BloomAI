import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { ServiceError } from '../services/errors'
import { createHttpErrorHandler } from './error-mapper'

function createTestApp(): Hono {
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  return app
}

describe('Hono error handling', () => {
  it('maps a service error through Hono using the stable API error envelope', async () => {
    const app = createTestApp()
    app.get('/__test/service-error', () => {
      throw new ServiceError('CONFLICT', 'Provider already exists')
    })

    const response = await app.request('/__test/service-error')

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'CONFLICT', message: 'Provider already exists' },
    })
  })

  it('does not expose unexpected error details through Hono', async () => {
    const app = createTestApp()
    app.get('/__test/unexpected-error', () => {
      throw new Error('provider key=super-secret failed')
    })

    const response = await app.request('/__test/unexpected-error')

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
