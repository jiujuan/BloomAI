import { Router, Request, Response } from 'express'
import { RESPONSE_SCHEMA_VERSION, type ResponseStreamEvent, type TokenUsage } from '@shared/schemas/response'
import { sessionRepo } from '../db/repositories/session.repo'
import { messageRepo } from '../db/repositories/message.repo'
import { settingsRepo } from '../db/repositories/settings.repo'
import { streamChatCompletion } from '../llm'
import { mapLlmStreamToResponseEvents } from '../llm/response-event-mapper'
import { selectRuntimeModel } from '../llm/model-selection'
import { runChatAgentV1 } from '../agent/mastra/chat-agent-runtime-adapter'
import { createAgentResponseEventMapper } from '../agent/mastra/response-event-mapper'
import { setupSSE, sendSSE, endSSE } from '../middleware/index'
import { buildChatContext, organizeChatPrompt } from '../prompts'
import { createChatResponseStreamWriter, type ChatResponseStreamState } from './chat-response-stream'

export const chatRouter = Router()

type ChatResponseStreamWriter = ReturnType<typeof createChatResponseStreamWriter>

function getSettingsModel(): string {
  return settingsRepo.getValue('model') || ''
}

function getAgentRuntimeEnabled(): boolean {
  const value = settingsRepo.getValue('agent_runtime_enabled') || ''
  return value === 'true' || value === '1'
}

function getAgentRuntimeProvider(): string {
  return settingsRepo.getValue('agent_runtime_provider') || ''
}

function getAgentRuntimeMaxSteps(): number {
  const rawValue = settingsRepo.getValue('agent_runtime_max_steps') || ''
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 10
  return Math.min(parsed, 10)
}

function shouldUseAgentRuntime(): boolean {
  return getAgentRuntimeEnabled() && getAgentRuntimeProvider() === 'mastra'
}

chatRouter.post('/stream', async (req: Request, res: Response) => {
  setupSSE(res)
  const { sessionId, content, contextOverride } = req.body
  if (!sessionId || !content) {
    sendSSE(res, { type: 'error', error: 'sessionId and content required' })
    return endSSE(res)
  }

  const promptContext = buildChatContext({ sessionId, userContent: content, contextOverride })
  if (!promptContext) {
    sendSSE(res, { type: 'error', error: 'Session not found' })
    return endSSE(res)
  }

  messageRepo.save({ session_id: sessionId, role: 'user', content })
  sessionRepo.touch(sessionId)

  if (promptContext.history.length === 0) {
    sessionRepo.update(sessionId, { title: content.slice(0, 60).trim() })
  }

  const prompt = organizeChatPrompt(promptContext, { maxTokens: 4096 })
  const { selectedModelId: model } = selectRuntimeModel({
    consumer: 'chat',
    modality: 'text',
    persona: promptContext.persona,
    sessionModel: promptContext.session.model,
    settingsModel: getSettingsModel(),
  })

  try {
    if (shouldUseAgentRuntime()) {
      const agentHandled = await streamMastraChat({
        sessionId,
        content,
        model,
        maxSteps: getAgentRuntimeMaxSteps(),
        res,
      })
      if (!agentHandled) {
        await streamLegacyChat({ sessionId, prompt, model, res })
      }
    } else {
      await streamLegacyChat({ sessionId, prompt, model, res })
    }
  } catch (err: any) {
    console.error('[Chat stream]', err?.message || err)
    sendSSE(res, { type: 'error', error: err?.message || 'AI request failed' })
  }

  endSSE(res)
})

type LegacyChatInput = {
  sessionId: string
  prompt: ReturnType<typeof organizeChatPrompt>
  model: string
  res: Response
}

type AgentChatInput = {
  sessionId: string
  content: string
  model: string
  maxSteps: number
  res: Response
}

async function* createLegacyChatSource(input: LegacyChatInput) {
  yield* streamChatCompletion({
    model: input.model,
    maxTokens: input.prompt.maxTokens,
    system: input.prompt.system,
    messages: input.prompt.messages,
  })
}

async function streamLegacyChat(input: LegacyChatInput): Promise<void> {
  const writer = createChatResponseStreamWriter({
    res: input.res,
    sessionId: input.sessionId,
    sendSSE,
  })
  let shouldPersist = false

  const responseEvents = mapLlmStreamToResponseEvents(createLegacyChatSource(input), {
    sessionId: input.sessionId,
    model: input.model,
  })

  for await (const event of responseEvents) {
    writer.send(event)
    if (event.type === 'response_completed' || (event.type === 'response_failed' && writer.state().text)) {
      shouldPersist = true
    }
  }

  if (shouldPersist) {
    persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true })
  }
}

async function* createAgentChatSource(input: AgentChatInput) {
  yield* runChatAgentV1({
    sessionId: input.sessionId,
    content: input.content,
    model: input.model,
    maxSteps: input.maxSteps,
  })
}

async function streamMastraChat(input: AgentChatInput): Promise<boolean> {
  const writer = createChatResponseStreamWriter({
    res: input.res,
    sessionId: input.sessionId,
    sendSSE,
  })
  const mapper = createAgentResponseEventMapper({
    sessionId: input.sessionId,
    model: input.model,
    maxSteps: input.maxSteps,
  })
  let seenEvent = false
  let seenNonErrorEvent = false

  try {
    for await (const event of createAgentChatSource(input)) {
      seenEvent = true

      if (event.type === 'error') {
        if (!seenNonErrorEvent) return false
        sendMappedEvents(writer, mapper.map(event))
        persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true })
        return true
      }

      seenNonErrorEvent = true
      sendMappedEvents(writer, mapper.map(event))

      if (event.type === 'done') {
        persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true })
        return true
      }
    }

    if (!seenEvent) return false

    sendMappedEvents(writer, mapper.completeWithoutDone())
    persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true })
    return true
  } catch (err) {
    if (!seenNonErrorEvent) return false
    sendMappedEvents(writer, mapper.fail(err))
    persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true })
    return true
  }
}

function sendMappedEvents(writer: ChatResponseStreamWriter, events: ResponseStreamEvent[]): void {
  for (const event of events) {
    writer.send(event)
  }
}

function persistAssistantFromWriter(
  sessionId: string,
  state: ChatResponseStreamState,
  options: { persistEmpty?: boolean } = {},
): void {
  if (!options.persistEmpty && !state.text && state.toolCalls.length === 0) return

  const trace = state.trace
    ? {
        schemaVersion: RESPONSE_SCHEMA_VERSION,
        ...state.trace,
        toolCalls: state.trace.toolCalls ?? state.toolCalls,
      }
    : null

  messageRepo.save({
    session_id: sessionId,
    role: 'assistant',
    content: state.text,
    tool_calls: trace ? JSON.stringify(trace) : null,
    tokens: getTokenCount(state.usage),
  })
}

function getTokenCount(usage?: TokenUsage): number | undefined {
  if (!usage) return undefined
  const total = typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined
  const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined
  const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined
  if (typeof total === 'number') return total
  if (typeof input === 'number' || typeof output === 'number') return (input || 0) + (output || 0)
  return undefined
}