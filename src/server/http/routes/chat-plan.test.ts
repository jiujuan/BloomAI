import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

const streamChat = vi.hoisted(() => vi.fn())
const proposePlan = vi.hoisted(() => vi.fn())
const persistAssistantMessage = vi.hoisted(() => vi.fn())
const normalizeChatInput = vi.hoisted(() => vi.fn(({ body, headers }) => ({
  body,
  sessionId: (headers.sessionId || body?.sessionId || body?.id || '').trim(),
  mode: headers.mode || 'chat',
  model: headers.model || 'agnes-2.0-flash',
  messages: Array.isArray(body?.messages) ? body.messages : [],
  planTasks: [],
  attachments: [],
})))
const normalizePlanInput = vi.hoisted(() => vi.fn(({ body, headers }) => ({
  sessionId: (headers.sessionId || body?.sessionId || '').trim(),
  model: headers.model || 'agnes-2.0-flash',
  query: body?.query,
  avoid: body?.avoid,
})))

vi.mock('../../services/chat.service', () => ({
  chatService: { streamChat, proposePlan, persistAssistantMessage },
  normalizeChatInput,
  normalizePlanInput,
}))

async function loadApp() {
  vi.resetModules()
  const { chatRoutes } = await import('./chat')
  return new Hono().route('/chat', chatRoutes)
}

describe('chat route HTTP adapter contract', () => {
  afterEach(() => {
    streamChat.mockReset()
    proposePlan.mockReset()
    persistAssistantMessage.mockReset()
    normalizeChatInput.mockClear()
    normalizePlanInput.mockClear()
  })

  it('rejects chat requests without a session before service invocation', async () => {
    const app = await loadApp()
    const response = await app.request('/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [] }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'SESSION_REQUIRED', message: 'A chat session is required.' },
    })
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('passes normalized HTTP input and abort signal to the chat service while retaining the UI stream response', async () => {
    streamChat.mockResolvedValue(new ReadableStream({ start: (controller) => controller.close() }))
    const app = await loadApp()
    const response = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bloom-session': 'chat-session-1', 'x-bloom-model': 'custom' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    })

    expect(response.status).toBe(200)
    expect(normalizeChatInput).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ sessionId: 'chat-session-1', model: 'custom' }),
    }))
    expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'chat-session-1' }), expect.any(AbortSignal))
  })

  it('rejects plan proposals without a session before service invocation', async () => {
    const app = await loadApp()
    const response = await app.request('/chat/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'Make a plan' }),
    })

    expect(response.status).toBe(400)
    expect(proposePlan).not.toHaveBeenCalled()
  })

  it('keeps the plan proposal envelope and model/session forwarding stable', async () => {
    proposePlan.mockResolvedValue({ tasks: ['Inspect request', 'Answer question'] })
    const app = await loadApp()
    const response = await app.request('/chat/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bloom-session': 'plan-session-1', 'x-bloom-model': 'planner' },
      body: JSON.stringify({ query: 'Prepare for an interview' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { tasks: ['Inspect request', 'Answer question'] } })
    expect(proposePlan).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'plan-session-1', model: 'planner', query: 'Prepare for an interview',
    }))
  })

  it.each([
    ['session-required', 400, { error: 'sessionId required' }],
    ['empty', 200, { data: null }],
    ['saved', 200, { data: { ok: true } }],
    ['failed', 500, { error: 'persist failed' }],
  ] as const)('preserves /assistant response for %s result', async (kind, status, payload) => {
    persistAssistantMessage.mockReturnValue({ kind })
    const app = await loadApp()
    const response = await app.request('/chat/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 's', content: 'Answer' }),
    })

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(payload)
    expect(persistAssistantMessage).toHaveBeenCalledWith({ sessionId: 's', content: 'Answer' })
  })
})
