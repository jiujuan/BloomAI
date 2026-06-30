import { Hono } from 'hono'
import { RequestContext } from '@mastra/core/request-context'
import { handleChatStream, toAISdkStream } from '@mastra/ai-sdk'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '../../mastra'
import { TEAM_AGENT_BY_TAB } from '../../mastra/agents/team'
import { messageRepo } from '../../db/repositories/message.repo'
import { sessionRepo } from '../../db/repositories/session.repo'
import { logError, sanitizeErrorMessage } from '../../logger/logger'
import { readJson } from '../util'

/** Default chat model: Agnes (openai-compatible relay reachable from this network). */
const DEFAULT_CHAT_MODEL = 'agnes-2.0-flash'
const MAX_STEPS = 10

export const chatRoutes = new Hono()

// POST /api/v1/chat — AI SDK v6 UI message stream, consumed by the renderer's useChat().
// Persistence (P4): the user message is saved before streaming. The assistant message is
// persisted by the client from useChat's onFinish (POST /chat/assistant) so the full UI
// parts — tool cards, reasoning, workflow steps — survive reloads, not just the final text.
chatRoutes.post('/', async (c) => {
  const body = await readJson<any>(c)
  const mode = c.req.header('x-bloom-mode') || 'chat'
  const model = c.req.header('x-bloom-model') || DEFAULT_CHAT_MODEL
  const sessionId = c.req.header('x-bloom-session') || body.sessionId || body.id || ''

  const requestContext = new RequestContext()
  requestContext.set('mode', mode)
  requestContext.set('model', model)
  requestContext.set('sessionId', sessionId)

  persistUserMessage(sessionId, body.messages)

  // P6d: a selected team tab (研究/写作/编码) routes to that specialist agent and takes
  // precedence over deep mode. No tab → general chat agent (deep mode runs the workflow).
  const teamAgentId = TEAM_AGENT_BY_TAB[c.req.header('x-bloom-agent') || '']

  // Deep mode (P6a): run the deterministic deep-research workflow instead of the
  // single agent. The workflow gathers web sources, then a writer agent synthesizes
  // a cited report — streamed to the same useChat UI as an AI SDK message stream.
  if (!teamAgentId && mode === 'deep') {
    const query = lastUserText(body.messages)
    if (query) {
      const run = await mastra.getWorkflow('deep-research').createRun()
      const workflowStream = await run.stream({ inputData: { query }, requestContext })
      const uiStream = createUIMessageStream({
        execute: async ({ writer }) => {
          for await (const part of toAISdkStream(workflowStream as any, { from: 'workflow' }) as any) {
            await writer.write(part)
          }
        },
      })
      return createUIMessageStreamResponse({ stream: uiStream })
    }
  }

  const stream = await handleChatStream({
    mastra,
    agentId: teamAgentId || 'chat',
    version: 'v6',
    sendReasoning: true,
    params: {
      ...body,
      requestContext,
      abortSignal: c.req.raw.signal,
      maxSteps: MAX_STEPS,
    } as any,
  })

  return createUIMessageStreamResponse({ stream })
})

// POST /api/v1/chat/assistant — persist a finished assistant message with its full UI parts.
// Called by the renderer from useChat's onFinish; `parts` is the slimmed UIMessage parts JSON
// so tool/reasoning/workflow cards can be rebuilt on reload.
chatRoutes.post('/assistant', async (c) => {
  const body = await readJson<any>(c)
  const sessionId = String(body?.sessionId || '')
  if (!sessionId) return c.json({ error: 'sessionId required' }, 400)

  const content = typeof body?.content === 'string' ? body.content : ''
  const parts = Array.isArray(body?.parts) ? body.parts : null
  if (!content && !parts) return c.json({ data: null })

  try {
    messageRepo.save({
      session_id: sessionId,
      role: 'assistant',
      content,
      parts: parts ? JSON.stringify(parts) : null,
      tool_calls: JSON.stringify({ runtime: 'mastra-chat-agent-v1', model: String(body?.model || '') }),
      tokens: typeof body?.tokens === 'number' ? body.tokens : tokenCount(body?.usage),
    })
    sessionRepo.touch(sessionId)
    return c.json({ data: { ok: true } })
  } catch (error) {
    logError('chat.persistAssistant', { code: 'PERSISTENCE_ERROR', message: sanitizeErrorMessage(error, 'persist assistant failed') }, { sessionId })
    return c.json({ error: 'persist failed' }, 500)
  }
})

function persistUserMessage(sessionId: string, messages: unknown): void {
  if (!sessionId) return
  const text = lastUserText(messages)
  if (!text) return
  try {
    const isFirst = messageRepo.count(sessionId) === 0
    messageRepo.save({ session_id: sessionId, role: 'user', content: text })
    sessionRepo.touch(sessionId)
    if (isFirst) sessionRepo.update(sessionId, { title: text.slice(0, 60).trim() })
  } catch (error) {
    logError('chat.persistUser', { code: 'PERSISTENCE_ERROR', message: sanitizeErrorMessage(error, 'persist user failed') }, { sessionId })
  }
}

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.parts)) {
      return message.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('').trim()
    }
  }
  return ''
}

function tokenCount(usage: any): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  if (typeof usage.totalTokens === 'number') return usage.totalTokens
  const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0
  const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0
  return input || output ? input + output : undefined
}
