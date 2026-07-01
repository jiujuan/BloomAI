import { Hono } from 'hono'
import { RequestContext } from '@mastra/core/request-context'
import { handleChatStream, toAISdkStream } from '@mastra/ai-sdk'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '../../mastra'
import { TEAM_AGENT_BY_TAB } from '../../mastra/agents/team'
import { normalizeWriting } from '../../mastra/agents/writer-prompt'
import { messageRepo } from '../../db/repositories/message.repo'
import { sessionRepo } from '../../db/repositories/session.repo'
import { logError, sanitizeErrorMessage } from '../../logger/logger'
import { streamOnError } from '../stream-error'
import { readJson } from '../util'

/** Default chat model: Agnes (openai-compatible relay reachable from this network). */
const DEFAULT_CHAT_MODEL = 'agnes-2.0-flash'
const MAX_STEPS = 10
/** Plan mode: proposal task-count bounds (ideal 3-5, hard cap 10). */
const MAX_PLAN_TASKS = 10

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

  // Plan mode (confirmed): the client sends the user-approved task list in `body.plan`
  // (in the body, not a header, since tasks may contain non-ASCII text). When present,
  // the chat agent executes those numbered tasks (see chat-agent instructions). The
  // interactive/persisted plan card is handled client-side (a `data-plan` UI part).
  const planTasks = normalizeTasks(body?.plan)
  if (planTasks.length) requestContext.set('planTasks', planTasks)

  // AI Writer tab: typed parameters (type + platform/style/word-count) chosen in the UI.
  // Sent in the body (Chinese values can't ride in headers) and whitelist-validated before
  // they shape the writer agent's system instructions (see writer-prompt.ts).
  const writing = normalizeWriting(body?.writing)
  if (writing) requestContext.set('writing', writing)

  persistUserMessage(sessionId, body.messages)

  // P6d: a selected team tab (研究/写作/编码) routes to that specialist agent and takes
  // precedence over deep mode. No tab → general chat agent (deep mode runs the workflow).
  const teamAgentId = TEAM_AGENT_BY_TAB[c.req.header('x-bloom-agent') || '']

  try {
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
          onError: streamOnError('chat.deep', { sessionId }),
        })
        return createUIMessageStreamResponse({ stream: uiStream })
      }
    }

    const stream = await handleChatStream({
      mastra,
      agentId: teamAgentId || 'chat',
      version: 'v6',
      sendReasoning: true,
      onError: streamOnError('chat.stream', { sessionId, agentId: teamAgentId || 'chat' }),
      params: {
        ...body,
        // Plan execution: feed the agent a user message that embeds the confirmed plan, so the
        // plan anchors the actual prompt (not just the system instructions) and the model can't
        // drift off-topic. The clean original query was already persisted above for the UI.
        messages: planTasks.length ? augmentLastUserMessage(body.messages, planTasks) : body.messages,
        requestContext,
        abortSignal: c.req.raw.signal,
        maxSteps: MAX_STEPS,
      } as any,
    })

    // Plan execution: inject the confirmed task list as a real `data-plan` stream part
    // (right after the stream's start) so it renders at the top of the answer and is owned
    // by useChat — surviving tool-call stream churn and persisting via the normal parts path.
    if (planTasks.length) {
      const withPlan = createUIMessageStream({
        execute: async ({ writer }) => {
          let injected = false
          for await (const chunk of stream as any) {
            await writer.write(chunk)
            if (!injected && (chunk?.type === 'start' || chunk?.type === 'start-step')) {
              await writer.write({ type: 'data-plan', data: { tasks: planTasks } } as any)
              injected = true
            }
          }
          if (!injected) await writer.write({ type: 'data-plan', data: { tasks: planTasks } } as any)
        },
        onError: streamOnError('chat.plan-exec', { sessionId }),
      })
      return createUIMessageStreamResponse({ stream: withPlan })
    }

    return createUIMessageStreamResponse({ stream })
  } catch (error) {
    // Pre-stream failure (agent build, model resolution, workflow start). Surface it through an
    // error-only message stream: createUIMessageStream routes the throw to onError, which logs
    // with stack and returns the friendly one-liner the UI shows.
    const errStream = createUIMessageStream({
      execute: async () => {
        throw error
      },
      onError: streamOnError('chat.route', { sessionId, mode }),
    })
    return createUIMessageStreamResponse({ stream: errStream })
  }
})

// POST /api/v1/chat/plan — plan mode step 1: propose a short task list for the user to
// confirm. Non-streaming; returns { data: { tasks } }. No message is persisted here — the
// turn is only persisted once the user confirms and the execution request runs through POST /.
chatRoutes.post('/plan', async (c) => {
  const body = await readJson<any>(c)
  const model = c.req.header('x-bloom-model') || DEFAULT_CHAT_MODEL
  const sessionId = c.req.header('x-bloom-session') || body?.sessionId || ''
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (!query) return c.json({ data: { tasks: [] } })

  const avoid = Array.isArray(body?.avoid)
    ? body.avoid.filter((t: unknown): t is string => typeof t === 'string' && !!t.trim())
    : []

  const requestContext = new RequestContext()
  requestContext.set('model', model)
  requestContext.set('sessionId', sessionId)

  const prompt = [
    `User request: ${query}`,
    avoid.length ? `\nPropose a DIFFERENT plan; avoid repeating these tasks:\n- ${avoid.join('\n- ')}` : '',
    `\nReturn a JSON array of 3-5 concrete tasks (at most ${MAX_PLAN_TASKS}).`,
  ].join('')

  let tasks: string[] = []
  try {
    const planner = mastra.getAgent('plan-planner')
    const res = await planner.generate(prompt, { requestContext })
    tasks = parsePlanTasks(res.text)
  } catch (error) {
    logError('chat.proposePlan', { code: 'PLAN_ERROR', message: sanitizeErrorMessage(error, 'propose plan failed') }, { sessionId })
  }
  if (tasks.length === 0) tasks = [query]
  return c.json({ data: { tasks } })
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

// Rewrite the last user message to embed the confirmed plan, so the plan is part of the
// prompt the model actually reads. Returns a NEW array (original body.messages untouched, so
// the clean query is what gets persisted/shown). Both `parts` and `content` are set because
// downstream conversion may read either.
function augmentLastUserMessage(messages: any, planTasks: string[]): any {
  if (!Array.isArray(messages)) return messages
  let idx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { idx = i; break }
  }
  if (idx < 0) return messages
  const original = lastUserText([messages[idx]])
  const list = planTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const wrapped = [
    `请严格按照以下已确认的计划来完成我的请求，逐条执行、不要偏离主题，最后按任务编号分段给出答案。`,
    ``,
    `我的原始请求：${original}`,
    ``,
    `已确认的计划：`,
    list,
  ].join('\n')
  const copy = messages.slice()
  copy[idx] = { ...messages[idx], parts: [{ type: 'text', text: wrapped }], content: wrapped }
  return copy
}

function tokenCount(usage: any): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  if (typeof usage.totalTokens === 'number') return usage.totalTokens
  const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0
  const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0
  return input || output ? input + output : undefined
}

/** Parse a planner LLM response into a task list (JSON array of strings), tolerant of prose/fences. */
function parsePlanTasks(text: string): string[] {
  try {
    const match = text.match(/\[[\s\S]*\]/)
    return normalizeTasks(JSON.parse(match ? match[0] : text))
  } catch {
    return []
  }
}

/** Coerce an unknown value into a clean, deduped, capped task-string array. */
function normalizeTasks(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tasks: string[] = []
  for (const item of value) {
    const t = typeof item === 'string' ? item.trim() : ''
    if (t && !seen.has(t)) {
      seen.add(t)
      tasks.push(t)
      if (tasks.length >= MAX_PLAN_TASKS) break
    }
  }
  return tasks
}
