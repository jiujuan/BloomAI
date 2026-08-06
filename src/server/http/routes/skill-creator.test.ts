import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('skill creator HTTP contract', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.SKILL_CREATOR_ENABLED
    delete process.env.SKILL_CREATOR_PUBLISH_ENABLED
  })

  it('returns a stable feature-disabled error instead of hiding creator routes', async () => {
    const { createHonoApp } = await import('../app')
    const response = await createHonoApp().request('/api/v1/skill-drafts', { method: 'POST', body: JSON.stringify({ content: {} }), headers: { 'content-type': 'application/json' } })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: { code: 'FEATURE_DISABLED', message: expect.stringContaining('creatorEnabled') } })
  })
})
