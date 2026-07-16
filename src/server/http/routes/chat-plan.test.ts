import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

const generatePlan = vi.hoisted(() => vi.fn())
const handleChatStream = vi.hoisted(() => vi.fn())
const getAgent = vi.hoisted(() => vi.fn(() => ({ generate: generatePlan })))

vi.mock('../../mastra', () => ({ mastra: { getAgent } }))
vi.mock('@mastra/ai-sdk', () => ({ handleChatStream, toAISdkStream: vi.fn() }))
vi.mock('../../db/repositories/message.repo', () => ({
  messageRepo: { count: vi.fn(() => 1), save: vi.fn() },
}))
vi.mock('../../db/repositories/session.repo', () => ({
  sessionRepo: { touch: vi.fn(), update: vi.fn() },
}))
vi.mock('../../logger/logger', () => ({
  logError: vi.fn(),
  sanitizeErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}))

async function loadApp() {
  vi.resetModules()
  const { chatRoutes } = await import('./chat')
  return new Hono().route('/chat', chatRoutes)
}

describe('chat routes requiring Memory context', () => {
  afterEach(() => {
    generatePlan.mockReset()
    handleChatStream.mockReset()
    getAgent.mockClear()
  })

  it('rejects chat requests without a session before Memory is invoked', async () => {
    const app = await loadApp()

    const response = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'SESSION_REQUIRED', message: 'A chat session is required.' },
    })
  })

  it('rejects plan proposals without a session before Memory is invoked', async () => {
    const app = await loadApp()

    const response = await app.request('/chat/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Make a plan' }),
    })

    expect(response.status).toBe(400)
    expect(generatePlan).not.toHaveBeenCalled()
  })

  it('maps the chat session to Mastra memory threadId/resourceId', async () => {
    handleChatStream.mockResolvedValue(new ReadableStream({ start: (controller) => controller.close() }))
    const app = await loadApp()

    const response = await app.request('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bloom-session': 'chat-session-1',
      },
      body: JSON.stringify({
        messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      }),
    })

    expect(response.status).toBe(200)
    expect(handleChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          memory: { threadId: 'chat-session-1', resourceId: 'bloomai-local-user' },
        }),
      }),
    )
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
