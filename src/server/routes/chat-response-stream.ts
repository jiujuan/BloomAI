import type { Response } from 'express'
import {
  RESPONSE_SCHEMA_VERSION,
  type ResponseRuntime,
  type ResponseStreamEvent,
  type ResponseError,
  type ResponseTrace,
  type TokenUsage,
  type ToolCallTrace,
} from '@shared/schemas/response'

const DEFAULT_ACTIVE_RESPONSE_RUNTIME: ResponseRuntime = 'mastra-chat-agent-v1'

export type ChatResponseStreamState = {
  responseId: string
  text: string
  usage?: TokenUsage
  error?: ResponseError
  trace?: ResponseTrace
  toolCalls: ToolCallTrace[]
}

type ToolCallDraft = {
  callId: string
  toolId: string
  status: 'success' | 'error' | 'running'
  input?: unknown
  outputSummary?: string
  durationMs?: number
}

export function createChatResponseStreamWriter(input: {
  res: Response
  sessionId: string
  sendSSE: (res: Response, payload: ResponseStreamEvent) => void
}): {
  send(event: ResponseStreamEvent): void
  state(): ChatResponseStreamState
} {
  let responseId = ''
  let runtime: ResponseRuntime | undefined
  let usage: TokenUsage | undefined
  let error: ResponseError | undefined
  let trace: ResponseTrace | undefined
  let text = ''
  const toolCallDrafts = new Map<string, ToolCallDraft>()

  function currentToolCalls(): ToolCallTrace[] {
    return Array.from(toolCallDrafts.values())
      .filter((toolCall): toolCall is ToolCallDraft & { status: ToolCallTrace['status'] } => toolCall.status === 'success' || toolCall.status === 'error')
      .map((toolCall) => ({
        callId: toolCall.callId,
        toolId: toolCall.toolId,
        status: toolCall.status,
        input: toolCall.input,
        outputSummary: toolCall.outputSummary,
        durationMs: toolCall.durationMs,
      }))
  }

  function markRunningToolCallsFailed(message: string): void {
    for (const [callId, toolCall] of toolCallDrafts.entries()) {
      if (toolCall.status !== 'running') continue
      toolCallDrafts.set(callId, {
        ...toolCall,
        status: 'error',
        outputSummary: toolCall.outputSummary ?? message,
      })
    }
  }
  function mergeTrace(nextTrace: ResponseTrace | undefined): void {
    // Persisted assistant messages read this merged trace, so keep live tool drafts folded into runtime metadata.
    const toolCalls = currentToolCalls()
    trace = {
      schemaVersion: RESPONSE_SCHEMA_VERSION,
      ...(trace ?? {}),
      ...(nextTrace ?? {}),
      // New active responses default to the agent runtime; direct-llm is accepted only when replaying explicit legacy traces.
      runtime: nextTrace?.runtime ?? trace?.runtime ?? runtime ?? DEFAULT_ACTIVE_RESPONSE_RUNTIME,
      finishReason: nextTrace?.finishReason ?? trace?.finishReason,
      toolCalls: nextTrace?.toolCalls?.length ? nextTrace.toolCalls : toolCalls,
    }
  }

  return {
    send(event: ResponseStreamEvent): void {
      input.sendSSE(input.res, event)

      if ('responseId' in event && event.responseId) responseId = event.responseId

      if (event.type === 'response_started') {
        runtime = event.runtime
        trace = {
          schemaVersion: RESPONSE_SCHEMA_VERSION,
          runtime: event.runtime,
          providerId: event.providerId,
          model: event.model,
          toolCalls: currentToolCalls(),
        }
        return
      }

      if (event.type === 'content_delta') {
        text += event.delta
        return
      }

      if (event.type === 'usage_updated') {
        usage = event.usage
        return
      }

      if (event.type === 'tool_call_started') {
        toolCallDrafts.set(event.block.callId, {
          callId: event.block.callId,
          toolId: event.block.toolId,
          status: 'running',
          input: event.block.input,
        })
        mergeTrace(trace)
        return
      }

      if (event.type === 'tool_call_delta') {
        const existing = toolCallDrafts.get(event.callId)
        if (existing) {
          toolCallDrafts.set(event.callId, {
            ...existing,
            outputSummary: event.patch.outputSummary ?? existing.outputSummary,
            durationMs: event.patch.durationMs ?? existing.durationMs,
          })
        }
        mergeTrace(trace)
        return
      }

      if (event.type === 'tool_call_completed') {
        const existing = toolCallDrafts.get(event.callId)
        if (existing) {
          toolCallDrafts.set(event.callId, {
            ...existing,
            status: 'success',
            outputSummary: event.outputSummary ?? existing.outputSummary,
            durationMs: event.durationMs ?? existing.durationMs,
          })
        }
        mergeTrace(trace)
        return
      }

      if (event.type === 'tool_call_failed') {
        const existing = toolCallDrafts.get(event.callId)
        if (existing) {
          toolCallDrafts.set(event.callId, {
            ...existing,
            status: 'error',
            outputSummary: event.error.message,
            durationMs: event.durationMs ?? existing.durationMs,
          })
        }
        mergeTrace(trace)
        return
      }

      if (event.type === 'response_completed') {
        usage = event.usage ?? usage
        mergeTrace(event.trace)
        return
      }

      if (event.type === 'response_failed') {
        error = event.error
        markRunningToolCallsFailed(event.error.message)
        mergeTrace({
          schemaVersion: RESPONSE_SCHEMA_VERSION,
          runtime: runtime ?? DEFAULT_ACTIVE_RESPONSE_RUNTIME,
          finishReason: 'error',
          toolCalls: currentToolCalls(),
        })
      }
    },

    state(): ChatResponseStreamState {
      return {
        responseId,
        text,
        usage,
        error,
        trace,
        toolCalls: currentToolCalls(),
      }
    },
  }
}
