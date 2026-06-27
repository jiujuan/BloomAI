import {
  RESPONSE_SCHEMA_VERSION,
  type ResponseError,
  type ResponseRuntime,
  type ResponseStreamEvent,
  type TokenUsage,
  type ToolCallBlock,
} from '@shared/schemas/response'

const DEFAULT_ACTIVE_RESPONSE_RUNTIME: ResponseRuntime = 'mastra-chat-agent-v1'

export type LegacyChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; call: LegacyToolCallView }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs?: number }
  | { type: 'tool_call_error'; callId: string; error: string }
  | { type: 'done'; tokens?: { input: number; output: number } | null; trace?: unknown }
  | { type: 'error'; error: string }
  | { type: 'abort' | 'disconnect'; error?: unknown; message?: string }

export type LegacyToolCallView = {
  callId: string
  toolId: string
  category: string
  status: 'running'
  input: Record<string, unknown>
}

export function createChatStreamNormalizer(input: {
  sessionId: string
  responseId?: string
  now?: () => number
  idFactory?: () => string
}): {
  normalize(chunk: unknown): ResponseStreamEvent[]
  fail(error: unknown): ResponseStreamEvent[]
  flush(): ResponseStreamEvent[]
} {
  const now = input.now ?? Date.now
  const idFactory = input.idFactory ?? createId
  let responseId = input.responseId ?? idFactory()
  let responseStarted = false
  let contentStarted = false
  let contentCompleted = false
  let completed = false
  let failed = false
  let legacyStarted = false
  let blockId: string | null = null
  let runtime: ResponseRuntime = DEFAULT_ACTIVE_RESPONSE_RUNTIME
  let usage: TokenUsage | undefined

  function startResponse(nextRuntime: ResponseRuntime): ResponseStreamEvent[] {
    legacyStarted = true
    runtime = responseStarted ? runtime : nextRuntime
    if (responseStarted) return []
    responseStarted = true
    return [{
      type: 'response_started',
      responseId,
      sessionId: input.sessionId,
      runtime: nextRuntime,
      createdAt: now(),
    }]
  }

  function startContent(): ResponseStreamEvent[] {
    if (contentStarted) return []
    contentStarted = true
    blockId = idFactory()
    return [{
      type: 'content_block_started',
      responseId,
      block: {
        id: blockId,
        type: 'markdown',
        status: 'streaming',
        role: 'answer',
        createdAt: now(),
      },
    }]
  }

  function completeContent(): ResponseStreamEvent[] {
    if (!contentStarted || contentCompleted || !blockId) return []
    contentCompleted = true
    return [{
      type: 'content_block_completed',
      responseId,
      blockId,
      completedAt: now(),
    }]
  }

  function failResponse(error: ResponseError): ResponseStreamEvent[] {
    if (completed || failed) return []
    failed = true
    return [
      ...startResponse(runtime),
      {
        type: 'response_failed',
        responseId,
        error,
        completedAt: now(),
      },
    ]
  }

  function completeResponse(): ResponseStreamEvent[] {
    if (completed || failed) return []
    completed = true
    return [
      ...completeContent(),
      {
        type: 'response_completed',
        responseId,
        usage,
        trace: {
          schemaVersion: RESPONSE_SCHEMA_VERSION,
          runtime,
          finishReason: 'stop',
        },
        finishReason: 'stop',
        completedAt: now(),
      },
    ]
  }

  return {
    normalize(chunk: unknown): ResponseStreamEvent[] {
      if (isResponseStreamEvent(chunk)) {
        if (chunk.type === 'response_started') {
          responseStarted = true
          legacyStarted = true
          responseId = chunk.responseId
          runtime = chunk.runtime
        }
        if (chunk.type === 'content_block_started') {
          contentStarted = true
          contentCompleted = false
          blockId = chunk.block.id
        }
        if (chunk.type === 'content_block_completed') {
          contentCompleted = true
        }
        if (chunk.type === 'usage_updated') {
          usage = chunk.usage
        }
        completed = completed || chunk.type === 'response_completed'
        failed = failed || chunk.type === 'response_failed'
        return [chunk]
      }

      if (completed || failed) return []

      if (!isLegacyChatStreamEvent(chunk)) {
        return failResponse({
          code: 'MALFORMED_CHAT_STREAM_EVENT',
          message: 'Received an unknown chat stream event.',
          details: chunk,
        })
      }

      if (chunk.type === 'delta') {
        return [
          ...startResponse(DEFAULT_ACTIVE_RESPONSE_RUNTIME),
          ...startContent(),
          {
            type: 'content_delta',
            responseId,
            blockId: blockId!,
            delta: chunk.text,
          },
        ]
      }

      if (chunk.type === 'tool_call_start') {
        return [
          ...startResponse('agent-runtime'),
          {
            type: 'tool_call_started',
            responseId,
            block: {
              id: idFactory(),
              type: 'tool_call',
              callId: chunk.call.callId,
              toolId: chunk.call.toolId,
              category: normalizeToolCategory(chunk.call.category, chunk.call.toolId),
              status: 'running',
              input: chunk.call.input,
              createdAt: now(),
            },
          },
        ]
      }

      if (chunk.type === 'tool_call_result') {
        return [
          ...startResponse('agent-runtime'),
          {
            type: 'tool_call_completed',
            responseId,
            callId: chunk.callId,
            output: chunk.output,
            outputSummary: summarizeToolOutput(chunk.output),
            durationMs: chunk.durationMs,
            completedAt: now(),
          },
        ]
      }

      if (chunk.type === 'tool_call_error') {
        return [
          ...startResponse('agent-runtime'),
          {
            type: 'tool_call_failed',
            responseId,
            callId: chunk.callId,
            error: { code: 'TOOL_CALL_ERROR', message: chunk.error },
            completedAt: now(),
          },
        ]
      }

      if (chunk.type === 'done') {
        usage = chunk.tokens
          ? {
              inputTokens: chunk.tokens.input,
              outputTokens: chunk.tokens.output,
              totalTokens: chunk.tokens.input + chunk.tokens.output,
            }
          : undefined
        const usageEvent: ResponseStreamEvent[] = usage
          ? [{ type: 'usage_updated', responseId, usage }]
          : []
        return [
          // Legacy chunks are still accepted, but newly synthesized v1 events use the active agent runtime.
          ...startResponse(runtime),
          ...usageEvent,
          ...completeResponse(),
        ]
      }

      if (chunk.type === 'abort' || chunk.type === 'disconnect') {
        return failResponse(createStreamFailure(chunk.error ?? chunk.message ?? chunk.type))
      }

      if (chunk.type === 'error') {
        return failResponse({ code: 'LEGACY_CHAT_STREAM_ERROR', message: chunk.error })
      }

      return failResponse({
        code: 'MALFORMED_CHAT_STREAM_EVENT',
        message: 'Received an unknown chat stream event.',
        details: chunk,
      })
    },

    fail(error: unknown): ResponseStreamEvent[] {
      return failResponse(createStreamFailure(error))
    },

    flush(): ResponseStreamEvent[] {
      if (!responseStarted || completed || failed) return []
      return completeResponse()
    },
  }
}

function isResponseStreamEvent(chunk: unknown): chunk is ResponseStreamEvent {
  if (!isRecord(chunk) || typeof chunk.type !== 'string') return false
  return [
    'response_started',
    'content_block_started',
    'content_delta',
    'content_block_completed',
    'tool_call_started',
    'tool_call_delta',
    'tool_call_completed',
    'tool_call_failed',
    'usage_updated',
    'response_completed',
    'response_failed',
  ].includes(chunk.type)
}

function isLegacyChatStreamEvent(chunk: unknown): chunk is LegacyChatStreamEvent {
  if (!isRecord(chunk) || typeof chunk.type !== 'string') return false
  if (chunk.type === 'delta') return typeof chunk.text === 'string'
  if (chunk.type === 'tool_call_start') return isLegacyToolCallView(chunk.call)
  if (chunk.type === 'tool_call_result') return typeof chunk.callId === 'string'
  if (chunk.type === 'tool_call_error') return typeof chunk.callId === 'string' && typeof chunk.error === 'string'
  if (chunk.type === 'done') return true
  if (chunk.type === 'error') return typeof chunk.error === 'string'
  if (chunk.type === 'abort' || chunk.type === 'disconnect') return true
  return false
}

function isLegacyToolCallView(value: unknown): value is LegacyToolCallView {
  return isRecord(value)
    && typeof value.callId === 'string'
    && typeof value.toolId === 'string'
    && typeof value.category === 'string'
    && value.status === 'running'
    && isRecord(value.input)
}

function createStreamFailure(error: unknown): ResponseError {
  return {
    code: isAbortOrDisconnect(error) ? 'STREAM_ABORTED' : 'CHAT_STREAM_ERROR',
    message: getErrorMessage(error, 'Chat stream failed.'),
  }
}

function isAbortOrDisconnect(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const message = error.message.toLowerCase()
    return name === 'aborterror'
      || message.includes('abort')
      || message.includes('cancel')
      || message.includes('disconnect')
      || message.includes('network')
  }
  if (typeof error === 'string') {
    const message = error.toLowerCase()
    return message.includes('abort')
      || message.includes('cancel')
      || message.includes('disconnect')
      || message.includes('network')
  }
  return false
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeToolCategory(category: string, toolId: string): ToolCallBlock['category'] {
  if (category === 'search') return 'search'
  if (category === 'web') return 'web'
  if (category === 'fs' || category === 'file') return 'file'
  if (category === 'execution' || toolId.includes('shell')) return 'shell'
  if (category === 'image') return 'image'
  if (category === 'video') return 'video'
  return 'tool'
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

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
