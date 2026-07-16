import { Hono } from 'hono'
import { createUIMessageStreamResponse } from 'ai'
import {
  chatService,
  normalizeChatInput,
  normalizePlanInput,
} from '../../services/chat.service'
import { readJson } from '../util'

export const chatRoutes = new Hono()

// The route is intentionally an HTTP adapter only. Chat orchestration, persistence, plan
// generation and attachment processing live in ChatService so the same use cases can be reused
// outside Hono without changing the AI SDK UI stream contract.
chatRoutes.post('/', async (c) => {
  const body = await readJson<any>(c)
  const input = normalizeChatInput({
    body,
    headers: {
      mode: c.req.header('x-bloom-mode'),
      model: c.req.header('x-bloom-model'),
      sessionId: c.req.header('x-bloom-session'),
      agentTab: c.req.header('x-bloom-agent'),
    },
  })
  if (!input.sessionId) {
    return c.json({ error: { code: 'SESSION_REQUIRED', message: 'A chat session is required.' } }, 400)
  }

  const stream = await chatService.streamChat(input, c.req.raw.signal)
  return createUIMessageStreamResponse({ stream })
})

chatRoutes.post('/plan', async (c) => {
  const body = await readJson<any>(c)
  const input = normalizePlanInput({
    body,
    headers: {
      model: c.req.header('x-bloom-model'),
      sessionId: c.req.header('x-bloom-session'),
    },
  })
  if (!input.sessionId) {
    return c.json({ error: { code: 'SESSION_REQUIRED', message: 'A chat session is required.' } }, 400)
  }

  return c.json({ data: await chatService.proposePlan(input) })
})

chatRoutes.post('/assistant', async (c) => {
  const body = await readJson<any>(c)
  const result = chatService.persistAssistantMessage(body)
  if (result.kind === 'session-required') return c.json({ error: 'sessionId required' }, 400)
  if (result.kind === 'empty') return c.json({ data: null })
  if (result.kind === 'failed') return c.json({ error: 'persist failed' }, 500)
  return c.json({ data: { ok: true } })
})
