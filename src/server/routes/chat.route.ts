import fs from 'node:fs'
import path from 'node:path'
import { Router, Request, Response } from 'express'
import { RESPONSE_SCHEMA_VERSION, type ResponseStreamEvent, type TokenUsage } from '@shared/schemas/response'
import { sessionRepo } from '../db/repositories/session.repo'
import { messageRepo } from '../db/repositories/message.repo'
import { settingsRepo } from '../db/repositories/settings.repo'
import { readConfigValue } from '../config/config'
import { logError, sanitizeErrorMessage } from '../logger/logger'
import { selectRuntimeModel } from '../llm/model-selection'
import { streamChatAgentRoute } from '../agent/runtime/chat-agent-router'
import { createAgentResponseEventMapper } from '../agent/mastra/response-event-mapper'
import { setupSSE, sendSSE, endSSE } from '../middleware/index'
import { buildChatContext, organizeChatPrompt } from '../prompts'
import { createChatResponseStreamWriter, type ChatResponseStreamState } from './chat-response-stream'

export const chatRouter = Router()

console.log('[Chat route] module loaded', {
  cwd: process.cwd(),
  dotenvPath: path.join(process.cwd(), '.env'),
  dotenvExists: fs.existsSync(path.join(process.cwd(), '.env')),
})

type ChatResponseStreamWriter = ReturnType<typeof createChatResponseStreamWriter>

type RuntimeSettingSource = 'process.env' | '.env' | 'settings' | 'default'

type RuntimeSetting = { value: string; source: RuntimeSettingSource; key?: string }

function getSettingsModel(): string {
  return settingsRepo.getValue('model') || ''
}

function getRuntimeSetting(envKey: string, settingsKey: string): RuntimeSetting {
  const processEnvValue = process.env[envKey]?.trim()
  if (processEnvValue) return { value: processEnvValue, source: 'process.env', key: envKey }

  const processEnvSettingsValue = process.env[settingsKey]?.trim()
  if (processEnvSettingsValue) return { value: processEnvSettingsValue, source: 'process.env', key: settingsKey }

  const dotEnvValue = readConfigValue(envKey)
  if (dotEnvValue.value) return { value: dotEnvValue.value, source: dotEnvValue.source, key: envKey }

  const dotEnvSettingsValue = readConfigValue(settingsKey)
  if (dotEnvSettingsValue.value) return { value: dotEnvSettingsValue.value, source: dotEnvSettingsValue.source, key: settingsKey }

  const settingsValue = settingsRepo.getValue(settingsKey) || ''
  if (settingsValue) return { value: settingsValue, source: 'settings', key: settingsKey }

  return { value: '', source: 'default' }
}

function getEnvSettingValue(envKey: string, settingsKey: string): string {
  return getRuntimeSetting(envKey, settingsKey).value
}

function getAgentRuntimeMaxSteps(): number {
  const rawValue = getEnvSettingValue('AGENT_RUNTIME_MAX_STEPS', 'agent_runtime_max_steps')
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 10
  return Math.min(parsed, 10)
}

function getAgentRuntimeDebugConfig() {
  const maxSteps = getRuntimeSetting('AGENT_RUNTIME_MAX_STEPS', 'agent_runtime_max_steps')
  return { maxSteps, parsedMaxSteps: getAgentRuntimeMaxSteps() }
}

function logAgentRuntimeConfig(input: {
  sessionId: string
  model: string
  content: string
  debugConfig: ReturnType<typeof getAgentRuntimeDebugConfig>
}): void {
  const { maxSteps, parsedMaxSteps } = input.debugConfig
  console.log('[AgentRuntime config]', {
    sessionId: input.sessionId,
    model: input.model,
    contentPreview: input.content.slice(0, 120),
    maxSteps: maskRuntimeSetting(maxSteps),
    parsedMaxSteps,
    runtime: 'mastra-chat-agent-v1',
    cwd: process.cwd(),
    dotenvPath: path.join(process.cwd(), '.env'),
    dotenvExists: fs.existsSync(path.join(process.cwd(), '.env')),
  })
}

function maskRuntimeSetting(setting: RuntimeSetting) {
  return {
    value: setting.value,
    source: setting.source,
    key: setting.key,
  }
}

chatRouter.post('/stream', async (req: Request, res: Response) => {
  console.log('[Chat route] POST /stream received', {
    hasSessionId: Boolean(req.body?.sessionId),
    contentPreview: typeof req.body?.content === 'string' ? req.body.content.slice(0, 120) : undefined,
  })
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

  const agentRuntimeDebugConfig = getAgentRuntimeDebugConfig()
  logAgentRuntimeConfig({ sessionId, content, model, debugConfig: agentRuntimeDebugConfig })

  try {
    // Chat streaming is agent-only now; agent failures are emitted as v1 failure events instead of direct LLM fallback.
    console.log('[AgentRuntime mastra] starting', { sessionId, model, maxSteps: agentRuntimeDebugConfig.parsedMaxSteps })
    await streamMastraChat({
      sessionId,
      content,
      model,
      maxSteps: agentRuntimeDebugConfig.parsedMaxSteps,
      prompt,
      res,
    })
    console.log('[AgentRuntime mastra] completed', { sessionId, model })
  } catch (err: any) {
    const message = sanitizeErrorMessage(err, 'AI request failed')
    console.error('[Chat stream]', message)
    logError('chat.stream', { code: 'UNKNOWN_ERROR', message }, { sessionId, model, rawError: err })
    sendSSE(res, { type: 'error', error: message })
  }

  endSSE(res)
})

type AgentChatInput = {
  sessionId: string
  content: string
  model: string
  maxSteps: number
  prompt: ReturnType<typeof organizeChatPrompt>
  res: Response
}

async function* createAgentChatSource(input: AgentChatInput) {
  yield* streamChatAgentRoute({
    sessionId: input.sessionId,
    content: input.content,
    model: input.model,
    maxSteps: input.maxSteps,
    prompt: input.prompt,
  })
}

async function streamMastraChat(input: AgentChatInput): Promise<void> {
  console.log('[AgentRuntime mastra] stream begin', {
    sessionId: input.sessionId,
    model: input.model,
    maxSteps: input.maxSteps,
  })
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
  let deltaEventCount = 0
  let deltaCharCount = 0
  let failureMessage = ''

  try {
    for await (const event of createAgentChatSource(input)) {
      seenEvent = true
      logAgentRuntimeEvent(input, event, deltaEventCount, deltaCharCount)

      if (event.type === 'delta') {
        deltaEventCount += 1
        deltaCharCount += event.text.length
      }

      if (event.type === 'error') {
        console.error('[AgentRuntime mastra] runtime error event', { sessionId: input.sessionId, model: input.model, error: event.error })
        const message = sanitizeErrorMessage(event.error, 'Agent request failed')
        logError('agent.runtime', { code: 'AGENT_RUNTIME_ERROR', message }, { sessionId: input.sessionId, model: input.model })
        sendMappedEvents(writer, mapper.map(event))
        if (!writer.state().text) failureMessage = 'AI request failed: ' + message
        persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true, fallbackContent: failureMessage })
        return
      }

      sendMappedEvents(writer, mapper.map(event))

      if (event.type === 'done') {
        console.log('[AgentRuntime mastra] done', { sessionId: input.sessionId, model: input.model })
        persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true, fallbackContent: failureMessage })
        return
      }
    }

    if (!seenEvent) {
      // Empty agent streams still produce a completed v1 response; the route no longer falls back to direct LLM.
      console.warn('[AgentRuntime mastra] no events emitted; completing without direct LLM fallback', { sessionId: input.sessionId, model: input.model })
      sendMappedEvents(writer, mapper.completeWithoutDone())
      persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true, fallbackContent: failureMessage })
      return
    }

    console.warn('[AgentRuntime mastra] completed without done event', { sessionId: input.sessionId, model: input.model })
    sendMappedEvents(writer, mapper.completeWithoutDone())
    persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true, fallbackContent: failureMessage })
  } catch (err) {
    console.error('[AgentRuntime mastra] exception', {
      sessionId: input.sessionId,
      model: input.model,
      error: err instanceof Error ? err.message : err,
    })
    const message = sanitizeErrorMessage(err, 'Agent request failed')
    logError('agent.runtime', { code: 'AGENT_RUNTIME_ERROR', message }, { sessionId: input.sessionId, model: input.model, rawError: err })
    sendMappedEvents(writer, mapper.fail(err))
    if (!writer.state().text) failureMessage = 'AI request failed: ' + message
    persistAssistantFromWriter(input.sessionId, writer.state(), { persistEmpty: true, fallbackContent: failureMessage })
  }
}

function logAgentRuntimeEvent(input: AgentChatInput, event: Awaited<ReturnType<typeof createAgentChatSource> extends AsyncGenerator<infer T> ? T : never>, deltaEventCount: number, deltaCharCount: number): void {
  if (event.type === 'delta') {
    if (deltaEventCount === 0 || (deltaEventCount + 1) % 20 === 0) {
      console.log('[AgentRuntime mastra] delta progress', {
        sessionId: input.sessionId,
        model: input.model,
        deltaEvents: deltaEventCount + 1,
        deltaChars: deltaCharCount + event.text.length,
      })
    }
    return
  }

  console.log('[AgentRuntime mastra] event', {
    sessionId: input.sessionId,
    model: input.model,
    type: event.type,
    toolId: event.type === 'tool_call_start' ? event.call.toolId : undefined,
    error: event.type === 'error' ? event.error : undefined,
    deltaEvents: deltaEventCount || undefined,
    deltaChars: deltaCharCount || undefined,
  })
}

function sendMappedEvents(writer: ChatResponseStreamWriter, events: ResponseStreamEvent[]): void {
  for (const event of events) {
    writer.send(event)
  }
}

function persistAssistantFromWriter(
  sessionId: string,
  state: ChatResponseStreamState,
  options: { persistEmpty?: boolean; fallbackContent?: string } = {},
): void {
  const content = state.text || options.fallbackContent || ''
  if (!options.persistEmpty && !content && state.toolCalls.length === 0) return

  const trace = state.trace
    ? {
        schemaVersion: RESPONSE_SCHEMA_VERSION,
        ...state.trace,
        toolCalls: state.trace.toolCalls ?? state.toolCalls,
      }
    : null

  try {
    messageRepo.save({
      session_id: sessionId,
      role: 'assistant',
      content,
      tool_calls: trace ? JSON.stringify(trace) : null,
      tokens: getTokenCount(state.usage),
    })
  } catch (error) {
    const message = sanitizeErrorMessage(error, 'Assistant persistence failed')
    console.error('[Chat persistence]', message)
    logError('chat.persistence', { code: 'PERSISTENCE_ERROR', message }, {
      sessionId,
      responseId: state.responseId,
      textLength: content.length,
      toolCallCount: state.toolCalls.length,
      rawError: error,
    })
  }
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