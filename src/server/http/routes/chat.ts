import { Hono } from 'hono'
import { RequestContext } from '@mastra/core/request-context'
import { handleChatStream, toAISdkStream } from '@mastra/ai-sdk'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '../../mastra'
import { messageRepo } from '../../db/repositories/message.repo'
import { sessionRepo } from '../../db/repositories/session.repo'
import { logError, sanitizeErrorMessage } from '../../logger/logger'
import { readJson } from '../util'

/** Default chat model: Agnes (openai-compatible relay reachable from this network). */
const DEFAULT_CHAT_MODEL = 'agnes-2.0-flash'
const MAX_STEPS = 10

export const chatRoutes = new Hono()

// POST /api/v1/chat — AI SDK v6 UI message stream, consumed by the renderer's useChat().
// Persistence (P4): the user message is saved before streaming; the assistant message is
// saved in onFinish (final text + usage + tool trace) so history survives reloads.
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

  // Deep mode (P6a): run the deterministic deep-research workflow instead of the
  // single agent. The workflow gathers web sources, then a writer agent synthesizes
  // a cited report — streamed to the same useChat UI as an AI SDK message stream.
  if (mode === 'deep') {
    const query = lastUserText(body.messages)
    if (query) {
      const run = await mastra.getWorkflow('deep-research').createRun()
      const workflowStream = await run.stream({ inputData: { query }, requestContext })
      const uiStream = createUIMessageStream({
        execute: async ({ writer }) => {
          let text = ''
          for await (const part of toAISdkStream(workflowStream as any, { from: 'workflow' }) as any) {
            if (part?.type === 'text-delta' && typeof part.delta === 'string') text += part.delta
            await writer.write(part)
          }
          persistAssistantMessage(sessionId, model, { text })
        },
      })
      return createUIMessageStreamResponse({ stream: uiStream })
    }
  }

  const stream = await handleChatStream({
    mastra,
    agentId: 'chat',
    version: 'v6',
    sendReasoning: true,
    params: {
      ...body,
      requestContext,
      abortSignal: c.req.raw.signal,
      maxSteps: MAX_STEPS,
      onFinish: (event: any) => persistAssistantMessage(sessionId, model, event),
    } as any,
  })

  return createUIMessageStreamResponse({ stream })
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

function persistAssistantMessage(sessionId: string, model: string, event: any): void {
  if (!sessionId) return
  const content = typeof event?.text === 'string' ? event.text : ''
  if (!content) return
  try {
    messageRepo.save({
      session_id: sessionId,
      role: 'assistant',
      content,
      tool_calls: buildTrace(model, event),
      tokens: tokenCount(event?.usage),
    })
    sessionRepo.touch(sessionId)
  } catch (error) {
    logError('chat.persistAssistant', { code: 'PERSISTENCE_ERROR', message: sanitizeErrorMessage(error, 'persist assistant failed') }, { sessionId })
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

function buildTrace(model: string, event: any): string | null {
  const toolCalls = Array.isArray(event?.toolCalls)
    ? event.toolCalls.map((tc: any) => ({ toolId: tc?.toolName ?? tc?.toolId ?? 'tool' })).filter((tc: any) => tc.toolId)
    : []
  if (!toolCalls.length) return JSON.stringify({ runtime: 'mastra-chat-agent-v1', model })
  return JSON.stringify({ runtime: 'mastra-chat-agent-v1', model, toolCalls })
}

function tokenCount(usage: any): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  if (typeof usage.totalTokens === 'number') return usage.totalTokens
  const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0
  const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0
  return input || output ? input + output : undefined
}
