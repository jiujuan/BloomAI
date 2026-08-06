import { Hono } from 'hono'
import type { Context } from 'hono'
import { createUIMessageStreamResponse } from 'ai'
import {
  chatService,
  normalizeChatInput,
  normalizePlanInput,
} from '../../services/chat.service'
import { readJson } from '../util'
import { z } from 'zod'
import { sessionRepo } from '../../db/repositories/session.repo'
import { messageRepo } from '../../db/repositories/message.repo'
import { createSqlitePackageRepository } from '../../db/repositories/skill-package.repo'
import { skillPackageRuntimeService } from '../../services/skill-package-runtime.service'
import { createChatSkillLauncher } from '../../skills/application/chat-skill-launcher'
import { mapErrorToHttpResponse } from '../error-mapper'

export const chatRoutes = new Hono()

const chatSkillRunSchema = z.object({
  skillVersionId: z.string().trim().min(1).max(200),
  input: z.record(z.unknown()),
  idempotencyKey: z.string().trim().min(1).max(200),
  userMessage: z.object({
    content: z.string().max(20_000),
    parts: z.array(z.unknown()).max(100).optional(),
  }).strict().optional(),
}).strict()

const chatSkillLauncher = createChatSkillLauncher({
  packages: createSqlitePackageRepository(),
  sessions: sessionRepo,
  messages: messageRepo,
  runtime: {
    startRun: (input) => skillPackageRuntimeService.startRun(input),
    findChatRunByIdempotency: (sessionId, idempotencyKey) =>
      skillPackageRuntimeService.findChatRunByIdempotency(sessionId, idempotencyKey),
  },
})

function chatSkillErrorResponse(c: Context, error: unknown) {
  if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request' } }, 400)
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}

chatRoutes.get('/sessions/:id/skills', (c) => {
  try {
    const sessionId = c.req.param('id')
    if (!sessionRepo.get(sessionId)) return c.json({ error: { code: 'NOT_FOUND', message: 'Chat session not found' } }, 404)
    return c.json({ data: chatSkillLauncher.listChatEligibleSkills() })
  } catch (error) {
    return chatSkillErrorResponse(c, error)
  }
})

chatRoutes.post('/sessions/:id/skill-runs', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const parsed = chatSkillRunSchema.parse(await readJson<unknown>(c))
    const result = await chatSkillLauncher.startRunFromChat({ ...parsed, sessionId })
    return c.json({ data: result }, result.created ? 201 : 200)
  } catch (error) {
    return chatSkillErrorResponse(c, error)
  }
})


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

  // Stale clients must use the durable Runs API; the shallow Research Agent is retired.
  if (input.teamAgentId === 'research') {
    return c.json({
      error: {
        code: 'RESEARCH_USE_DEEP_RESEARCH_API',
        message: 'Use the Deep Research Runs API for research requests.',
      },
    }, 409)
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
