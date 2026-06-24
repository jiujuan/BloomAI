import { Router, Request, Response } from 'express'
import { sessionRepo } from '../db/repositories/session.repo'
import { messageRepo } from '../db/repositories/message.repo'
import { settingsRepo } from '../db/repositories/settings.repo'
import { streamChatCompletion } from '../llm'
import { selectRuntimeModel } from '../llm/model-selection'
import { runChatAgentV1 } from '../agent/mastra/chat-agent-runtime-adapter'
import { setupSSE, sendSSE, endSSE } from '../middleware/index'
import { buildChatContext, organizeChatPrompt } from '../prompts'
import type { ChatAgentRuntimeEvent, ChatAgentTokenUsage, ChatToolCallTrace } from '../agent/mastra/types'

export const chatRouter = Router()

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

type MastraDoneTrace = {
  runtime: 'mastra-chat-agent-v1'
  maxSteps: number
  toolCalls: ChatToolCallTrace[]
  tokens?: ChatAgentTokenUsage
}

type ToolTraceDraft = {
  callId: string
  toolId: string
  status?: 'success' | 'error'
  input?: unknown
  outputSummary?: string
  durationMs?: number
}

async function streamLegacyChat(input: LegacyChatInput): Promise<void> {
  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0

  try {
    for await (const event of streamChatCompletion({
      model: input.model,
      maxTokens: input.prompt.maxTokens,
      system: input.prompt.system,
      messages: input.prompt.messages,
    })) {
      if (event.type === 'delta') {
        fullText += event.text
        sendSSE(input.res, { type: 'delta', text: event.text })
      }
      if (event.type === 'usage') {
        inputTokens = event.input
        outputTokens = event.output
      }
    }

    messageRepo.save({
      session_id: input.sessionId,
      role: 'assistant',
      content: fullText,
      tokens: inputTokens + outputTokens,
    })
    sendSSE(input.res, { type: 'done', tokens: { input: inputTokens, output: outputTokens } })
  } catch (err: any) {
    if (fullText) {
      messageRepo.save({
        session_id: input.sessionId,
        role: 'assistant',
        content: fullText,
        tokens: inputTokens + outputTokens,
      })
    }
    throw err
  }
}

async function streamMastraChat(input: AgentChatInput): Promise<boolean> {
  let fullText = ''
  let seenEvent = false
  let seenNonErrorEvent = false
  let lastDoneTrace: { runtime: 'mastra-chat-agent-v1'; maxSteps: number; toolCalls: ChatToolCallTrace[]; tokens?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } } | null = null
  const toolTraceDrafts = new Map<string, ToolTraceDraft>()

  try {
    for await (const event of runChatAgentV1({
      sessionId: input.sessionId,
      content: input.content,
      model: input.model,
      maxSteps: input.maxSteps,
    })) {
      seenEvent = true
      if (event.type === 'error') {
        if (!seenNonErrorEvent) return false
        sendSSE(input.res, event)
        const toolCalls = buildAssistantToolCalls(lastDoneTrace, toolTraceDrafts)
        const tokens = getDoneTraceTokens(lastDoneTrace)
        persistAssistantMessage(input.sessionId, fullText, toolCalls, tokens)
        return true
      }

      seenNonErrorEvent = true
      if (event.type === 'delta') {
        fullText += event.text
        sendSSE(input.res, event)
        continue
      }

      if (event.type === 'tool_call_start') {
        trackToolCallDraft(event.call, toolTraceDrafts)
        sendSSE(input.res, event)
        continue
      }

      if (event.type === 'tool_call_result') {
        trackToolCallResult(event.callId, event.output, event.durationMs, toolTraceDrafts)
        sendSSE(input.res, event)
        continue
      }

      if (event.type === 'tool_call_error') {
        trackToolCallError(event.callId, event.error, toolTraceDrafts)
        sendSSE(input.res, event)
        continue
      }

      lastDoneTrace = {
        runtime: event.trace.runtime,
        maxSteps: event.trace.maxSteps,
        toolCalls: event.trace.toolCalls.length ? event.trace.toolCalls : finalizeToolCallTraces(toolTraceDrafts),
        tokens: event.trace.tokens,
      }
      sendSSE(input.res, { type: 'done', trace: lastDoneTrace })
      const toolCalls = buildAssistantToolCalls(lastDoneTrace, toolTraceDrafts)
      persistAssistantMessage(input.sessionId, fullText, toolCalls, getDoneTraceTokens(lastDoneTrace))
      return true
    }

    if (!seenEvent) return false

    const fallbackTrace = finalizeToolCallTraces(toolTraceDrafts)
    const doneEvent = {
      type: 'done' as const,
      trace: {
        runtime: 'mastra-chat-agent-v1' as const,
        maxSteps: input.maxSteps,
        toolCalls: fallbackTrace,
      },
    }
    sendSSE(input.res, doneEvent)
    persistAssistantMessage(input.sessionId, fullText, fallbackTrace)
    return true
  } catch (err: any) {
    if (!seenNonErrorEvent) return false
    sendSSE(input.res, { type: 'error', error: err?.message || 'AI request failed' })
    const toolCalls = buildAssistantToolCalls(lastDoneTrace, toolTraceDrafts)
    persistAssistantMessage(input.sessionId, fullText, toolCalls, getDoneTraceTokens(lastDoneTrace))
    return true
  }
}

function persistAssistantMessage(
  sessionId: string,
  content: string,
  toolCalls: ChatToolCallTrace[] = [],
  tokens?: ChatAgentTokenUsage,
): void {
  messageRepo.save({
    session_id: sessionId,
    role: 'assistant',
    content,
    tool_calls: JSON.stringify(toolCalls),
    tokens: getTokenCount(tokens),
  })
}

function getTokenCount(tokens?: ChatAgentTokenUsage): number | undefined {
  if (!tokens) return undefined
  const total = typeof tokens.totalTokens === 'number' ? tokens.totalTokens : undefined
  const input = typeof tokens.inputTokens === 'number' ? tokens.inputTokens : undefined
  const output = typeof tokens.outputTokens === 'number' ? tokens.outputTokens : undefined
  if (typeof total === 'number') return total
  if (typeof input === 'number' || typeof output === 'number') return (input || 0) + (output || 0)
  return undefined
}

function trackToolCallDraft(call: { callId: string; toolId: string; input: Record<string, unknown> }, drafts: Map<string, ToolTraceDraft>): void {
  const existing = drafts.get(call.callId)
  drafts.set(call.callId, {
    callId: call.callId,
    toolId: call.toolId,
    input: call.input,
    status: existing?.status,
    outputSummary: existing?.outputSummary,
    durationMs: existing?.durationMs,
  })
}

function trackToolCallResult(
  callId: string,
  output: unknown,
  durationMs: number | undefined,
  drafts: Map<string, ToolTraceDraft>,
): void {
  const existing = drafts.get(callId)
  if (!existing) return
  existing.status = 'success'
  existing.outputSummary = summarizeToolOutput(output)
  existing.durationMs = durationMs ?? existing.durationMs
}

function trackToolCallError(callId: string, error: string, drafts: Map<string, ToolTraceDraft>): void {
  const existing = drafts.get(callId)
  if (!existing) return
  existing.status = 'error'
  existing.outputSummary = error
}

function finalizeToolCallTraces(drafts: Map<string, ToolTraceDraft>): ChatToolCallTrace[] {
  const traces: ChatToolCallTrace[] = []
  for (const draft of drafts.values()) {
    if (!draft.status) continue
    traces.push({
      callId: draft.callId,
      toolId: draft.toolId,
      status: draft.status,
      input: draft.input,
      outputSummary: draft.outputSummary,
      durationMs: draft.durationMs,
    })
  }
  return traces
}

function summarizeToolOutput(output: unknown): string | undefined {
  if (output === null || output === undefined) return undefined
  if (typeof output === 'string') return output.slice(0, 160)
  if (Array.isArray(output)) return `${output.length} items`
  if (typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (Array.isArray(record.results)) return `${record.results.length} results`
    if (typeof record.summary === 'string') return record.summary
    if (typeof record.text === 'string') return record.text.slice(0, 160)
  }
  return undefined
}
function buildAssistantToolCalls(
  doneTrace: { toolCalls: ChatToolCallTrace[] } | null,
  drafts: Map<string, ToolTraceDraft>,
): ChatToolCallTrace[] {
  return doneTrace?.toolCalls ?? finalizeToolCallTraces(drafts)
}
function getDoneTraceTokens(doneTrace: MastraDoneTrace | null): ChatAgentTokenUsage | undefined {
  return doneTrace ? doneTrace.tokens : undefined
}