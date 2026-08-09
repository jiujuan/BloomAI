import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { ServiceError } from '../services/errors'
import { requestIdMiddleware } from './request-context'
import { errorResponse } from './dtos/skill-runtime.error'
import { pageSuccess, successResponse } from './dtos/skill-runtime.response'

describe('Skills Admin P0 HTTP contract', () => {
  it('returns requestId and nested plus compatibility pagination metadata', async () => {
    const app = new Hono()
    app.use('*', requestIdMiddleware)
    app.get('/skills', (c) => pageSuccess(c, ['skill'], { limit: 50, offset: 0 }, 1))
    const response = await app.request('/skills', { headers: { 'x-request-id': 'req-contract-1' } })
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('req-contract-1')
    expect(body).toEqual({
      data: ['skill'],
      meta: {
        requestId: 'req-contract-1',
        page: { limit: 50, offset: 0, total: 1 },
        limit: 50,
        offset: 0,
        total: 1,
        hasMore: false,
        nextOffset: null,
      },
    })
  })

  it('returns retryable and revision errors in the stable error envelope', async () => {
    const app = new Hono()
    app.use('*', requestIdMiddleware)
    app.get('/retryable', (c) => errorResponse(c, new ServiceError('EXTERNAL_SERVICE_ERROR', 'Upstream unavailable')))
    app.get('/conflict', (c) => errorResponse(c, new ServiceError('REVISION_CONFLICT', 'Revision is stale', { expectedRevision: 1, actualRevision: 2 })))

    const retryable = await app.request('/retryable')
    expect(await retryable.json()).toMatchObject({ error: { code: 'EXTERNAL_SERVICE_ERROR', retryable: true, requestId: expect.any(String), details: {} } })
    const conflict = await app.request('/conflict')
    expect(await conflict.json()).toMatchObject({ error: { code: 'REVISION_CONFLICT', retryable: false, requestId: expect.any(String), details: { expectedRevision: 1, actualRevision: 2 } } })
  })

  it('can create a success response with a generated request id when used without app middleware', async () => {
    const app = new Hono()
    app.get('/success', (c) => successResponse(c, { ok: true }))
    const response = await app.request('/success')
    const body = await response.json() as any
    expect(body.meta.requestId).toEqual(expect.any(String))
    expect(response.headers.get('x-request-id')).toBe(body.meta.requestId)
  })
})
