import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { imageStudioRoutes } from './images'

function createApp() {
  return new Hono().route('/api/v1', imageStudioRoutes)
}

describe('Image Studio route baseline contract', () => {
  it('filters shared image templates by category', async () => {
    const response = await createApp().request('/api/v1/image-templates?category=国风')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [expect.objectContaining({ id: 'ink-landscape', category: '国风' })],
    })
  })

  it('rejects image generation before calling the service when required fields are absent', async () => {
    const response = await createApp().request('/api/v1/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a flower', model: 'agnes-image-2.1-flash' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'sessionId, prompt and model are required' },
    })
  })
})
