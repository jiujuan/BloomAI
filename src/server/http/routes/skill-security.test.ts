import { describe, expect, it } from 'vitest'
import { createHonoApp } from '../app'

async function jsonRequest(app: ReturnType<typeof createHonoApp>, origin: string | undefined, role?: string) {
  const headers: Record<string, string> = {}
  if (origin) headers.Origin = origin
  if (role) headers['x-bloom-role'] = role
  const response = await app.request(new Request('http://localhost/api/v1/skill-security/status', { headers }))
  return { response, body: await response.json() as any }
}

describe('skill security status route', () => {
  it('is administrator-only and does not disclose details to non-admin callers', async () => {
    const app = createHonoApp()
    const denied = await jsonRequest(app, undefined)
    expect(denied.response.status).toBe(403)
    expect(denied.body.error).toMatchObject({ code: 'FORBIDDEN' })

    const allowed = await jsonRequest(app, undefined, 'admin')
    expect(allowed.response.status).toBe(200)
    expect(allowed.body.data).toMatchObject({ policyVersion: expect.any(String) })
    expect(JSON.stringify(allowed.body)).not.toMatch(/secret|token|password|absolute|workspace/i)
  })

  it('allows configured local origins but rejects unknown browser origins', async () => {
    const app = createHonoApp()
    const allowed = await jsonRequest(app, 'http://localhost', 'admin')
    expect(allowed.response.status).toBe(200)
    expect(allowed.response.headers.get('access-control-allow-origin')).toBe('http://localhost')

    const denied = await jsonRequest(app, 'https://evil.example', 'admin')
    expect(denied.response.status).toBe(403)
    expect(denied.response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
