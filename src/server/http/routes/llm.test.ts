import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { llmRoutes } from './llm'

function createApp() {
  return new Hono().route('/llm', llmRoutes)
}

describe('LLM route baseline contract', () => {
  it('rejects an unsupported model modality before reaching persistence', async () => {
    const response = await createApp().request('/llm/models?modality=audio')

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid modality' },
    })
  })

  it('requires the minimum provider fields before reaching persistence', async () => {
    const response = await createApp().request('/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'missing-fields' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'id, name, and kind are required' },
    })
  })
})
