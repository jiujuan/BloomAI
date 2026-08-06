import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createSkillRuntimeObservabilityRoutes } from './skill-runtime-observability'

describe('Skill Runtime observability API', () => {
  it('serves liveness/readiness health and protects diagnostics with admin authorization', async () => {
    const app = new Hono()
    app.route('/api/v1', createSkillRuntimeObservabilityRoutes({
      isAdmin: () => false,
      health: () => ({ liveness: true, readiness: true, status: 'ready', checks: [] }),
      diagnostics: () => ({ health: { liveness: true, readiness: true, status: 'ready', checks: [] }, recentFailures: [] }),
    }))

    const health = await app.request('/api/v1/skill-runtime/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ data: { liveness: true, readiness: true } })

    const denied = await app.request('/api/v1/skill-runtime/diagnostics')
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })

    const allowedApp = new Hono()
    allowedApp.route('/api/v1', createSkillRuntimeObservabilityRoutes({
      isAdmin: () => true,
      health: () => ({ liveness: true, readiness: true, status: 'ready', checks: [] }),
      diagnostics: () => ({ health: { liveness: true, readiness: true, status: 'ready', checks: [] }, recentFailures: [] }),
    }))
    const allowed = await allowedApp.request('/api/v1/skill-runtime/diagnostics')
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toMatchObject({ data: { health: { readiness: true } } })
  })
})
