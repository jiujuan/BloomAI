import { Hono } from 'hono'
import { RequestContext } from '@mastra/core/request-context'
import { handleChatStream } from '@mastra/ai-sdk'
import { createUIMessageStreamResponse } from 'ai'
import { mastra } from '../../mastra'
import { readJson } from '../util'

/** Default chat model: Agnes (openai-compatible relay reachable from this network). */
const DEFAULT_CHAT_MODEL = 'agnes-2.0-flash'

export const chatRoutes = new Hono()

// POST /api/v1/chat — AI SDK v6 UI message stream, consumed by the renderer's useChat().
// mode/model arrive as headers (set by useChat's prepareSendMessagesRequest) and are
// injected into RequestContext so the agent resolves dynamic instructions + model per turn.
chatRoutes.post('/', async (c) => {
  const body = await readJson<any>(c)
  const mode = c.req.header('x-bloom-mode') || 'chat'
  const model = c.req.header('x-bloom-model') || DEFAULT_CHAT_MODEL
  const sessionId = c.req.header('x-bloom-session') || body.sessionId || body.id || ''

  const requestContext = new RequestContext()
  requestContext.set('mode', mode)
  requestContext.set('model', model)
  requestContext.set('sessionId', sessionId)

  const stream = await handleChatStream({
    mastra,
    agentId: 'chat',
    version: 'v6',
    sendReasoning: true,
    params: {
      ...body,
      requestContext,
      abortSignal: c.req.raw.signal,
    } as any,
  })

  return createUIMessageStreamResponse({ stream })
})
