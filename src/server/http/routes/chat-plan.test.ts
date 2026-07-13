import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

const generatePlan = vi.hoisted(() => vi.fn())
const getAgent = vi.hoisted(() => vi.fn(() => ({ generate: generatePlan })))

vi.mock('../../mastra', () => ({ mastra: { getAgent } }))

async function loadApp() {
  vi.resetModules()
  const { chatRoutes } = await import('./chat')
  return new Hono().route('/chat', chatRoutes)
}

describe('POST /chat/plan', () => {
  afterEach(() => {
    generatePlan.mockReset()
    getAgent.mockClear()
  })

  it('provides the chat session as the Memory thread for the planner', async () => {
    generatePlan.mockResolvedValue({ text: '["Inspect the request", "Answer the question"]' })
    const app = await loadApp()

    const response = await app.request('/chat/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bloom-session': 'plan-session-1',
      },
      body: JSON.stringify({ query: 'How should I prepare for an interview?' }),
    })

    expect(response.status).toBe(200)
    expect(generatePlan).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        memory: { thread: 'plan-session-1', resource: 'bloomai-local-user' },
      }),
    )
  })
})
