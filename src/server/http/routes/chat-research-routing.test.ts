import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

const streamChat = vi.hoisted(() => vi.fn())
const isDeepResearchV2Enabled = vi.hoisted(() => vi.fn())
const normalizeChatInput = vi.hoisted(() => vi.fn(({ body, headers }) => ({
  sessionId: (headers.sessionId || body?.sessionId || body?.id || '').trim(),
  mode: headers.mode || 'chat',
  model: headers.model || 'agnes-2.0-flash',
  teamAgentId: headers.agentTab || undefined,
  messages: Array.isArray(body?.messages) ? body.messages : [],
  planTasks: [],
  attachments: [],
})))

vi.mock('../../services/chat.service', () => ({
  chatService: { streamChat, proposePlan: vi.fn(), persistAssistantMessage: vi.fn() },
  normalizeChatInput,
  normalizePlanInput: vi.fn(),
}))

vi.mock('@server/config/config', () => ({ isDeepResearchV2Enabled }))

async function loadApp() {
  vi.resetModules()
  const { chatRoutes } = await import('./chat')
  return new Hono().route('/chat', chatRoutes)
}

describe('legacy Research Agent compatibility routing', () => {
  afterEach(() => {
    streamChat.mockReset()
    normalizeChatInput.mockClear()
    isDeepResearchV2Enabled.mockReset()
  })

  it('rejects stale legacy research chat requests when Deep Research V2 is enabled', async () => {
    isDeepResearchV2Enabled.mockReturnValue(true)
    const app = await loadApp()
    const response = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bloom-session': 'session-1', 'x-bloom-agent': 'research' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Research AI markets' }] }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'RESEARCH_USE_DEEP_RESEARCH_API', message: 'Use the Deep Research Runs API for research requests.' },
    })
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('continues to resolve the legacy Research Agent while V2 is disabled', async () => {
    isDeepResearchV2Enabled.mockReturnValue(false)
    streamChat.mockResolvedValue(new ReadableStream({ start: (controller) => controller.close() }))
    const app = await loadApp()
    const response = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bloom-session': 'session-1', 'x-bloom-agent': 'research' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Research AI markets' }] }),
    })

    expect(response.status).toBe(200)
    expect(normalizeChatInput).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ agentTab: 'research' }),
    }))
    expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({ teamAgentId: 'research' }), expect.any(AbortSignal))
  })
})
