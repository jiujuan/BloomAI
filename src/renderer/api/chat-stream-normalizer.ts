import {
  RESPONSE_SCHEMA_VERSION,
  type ResponseRuntime,
  type ResponseStreamEvent,
  type TokenUsage,
  type ToolCallBlock,
} from '@shared/schemas/response'

export type LegacyChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; call: LegacyToolCallView }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs?: number }
  | { type: 'tool_call_error'; callId: string; error: string }
  | { type: 'done'; tokens?: { input: number; output: number } | null; trace?: unknown }
  | { type: 'error'; error: string }

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
  normalize(chunk: LegacyChatStreamEvent | ResponseStreamEvent): ResponseStreamEvent[]
  flush(): ResponseStreamEvent[]
} {
  const now = input.now ?? Date.now
  const idFactory = input.idFactory ?? createId
  const responseId = input.responseId ?? idFactory()
  let responseStarted = false
  let contentStarted = false
  let contentCompleted = false
  let completed = false
  let failed = false
  let legacyStarted = false
  let blockId: string | null = null
  let runtime: ResponseRuntime = 'direct-llm'
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
    normalize(chunk: LegacyChatStreamEvent | ResponseStreamEvent): ResponseStreamEvent[] {
      if (isResponseStreamEvent(chunk)) {
        responseStarted = responseStarted || chunk.type === 'response_started'
        completed = completed || chunk.type === 'response_completed'
        failed = failed || chunk.type === 'response_failed'
        return [chunk]
      }

      if (completed || failed) return []

      if (chunk.type === 'delta') {
        return [
          ...startResponse('direct-llm'),
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
          ...startResponse(runtime),
          ...usageEvent,
          ...completeResponse(),
        ]
      }

      failed = true
      return [
        ...startResponse(runtime),
        {
          type: 'response_failed',
          responseId,
          error: { code: 'LEGACY_CHAT_STREAM_ERROR', message: chunk.error },
          completedAt: now(),
        },
      ]
    },

    flush(): ResponseStreamEvent[] {
      if (!legacyStarted || !responseStarted || completed || failed) return []
      return completeResponse()
    },
  }
}

function isResponseStreamEvent(chunk: LegacyChatStreamEvent | ResponseStreamEvent): chunk is ResponseStreamEvent {
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
