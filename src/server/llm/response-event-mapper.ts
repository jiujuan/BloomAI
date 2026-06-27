import { randomUUID } from 'crypto'
import type {
  ContentBlockCompletedEvent,
  ContentBlockStartedEvent,
  ContentDeltaEvent,
  ResponseCompletedEvent,
  ResponseFailedEvent,
  ResponseStartedEvent,
  ResponseStreamEvent,
  TokenUsage,
} from '@shared/schemas/response'
import { RESPONSE_SCHEMA_VERSION } from '@shared/schemas/response'
import { logError, sanitizeErrorMessage } from '../logger/logger'
import type { ChatStreamEvent } from './types'

const DEFAULT_ACTIVE_RESPONSE_RUNTIME = 'mastra-chat-agent-v1' as const

export type LlmResponseEventMapperOptions = {
  sessionId: string
  model: string
  providerId?: string
  responseId?: string
  now?: () => number
  idFactory?: () => string
}

export async function* mapLlmStreamToResponseEvents(
  source: AsyncGenerator<ChatStreamEvent>,
  options: LlmResponseEventMapperOptions,
): AsyncGenerator<ResponseStreamEvent> {
  const now = options.now ?? Date.now
  const idFactory = options.idFactory ?? randomUUID
  const responseId = options.responseId ?? idFactory()
  const blockId = idFactory()
  let contentStarted = false
  let contentCompleted = false
  let usage: TokenUsage | undefined

  yield {
    type: 'response_started',
    responseId,
    sessionId: options.sessionId,
    runtime: DEFAULT_ACTIVE_RESPONSE_RUNTIME,
    providerId: options.providerId,
    model: options.model,
    createdAt: now(),
  } satisfies ResponseStartedEvent

  try {
    for await (const event of source) {
      if (event.type === 'delta') {
        if (!contentStarted) {
          contentStarted = true
          yield createContentBlockStartedEvent(responseId, blockId, now())
        }
        yield {
          type: 'content_delta',
          responseId,
          blockId,
          delta: event.text,
        } satisfies ContentDeltaEvent
        continue
      }

      if (event.type === 'usage') {
        usage = {
          inputTokens: event.input,
          outputTokens: event.output,
          totalTokens: event.input + event.output,
          provider: options.providerId,
          model: options.model,
        }
        yield { type: 'usage_updated', responseId, usage }
        continue
      }

      if (event.type === 'done') {
        if (contentStarted && !contentCompleted) {
          contentCompleted = true
          yield createContentBlockCompletedEvent(responseId, blockId, now())
        }
        yield createResponseCompletedEvent(responseId, options.model, options.providerId, usage, now())
        return
      }
    }

    if (contentStarted && !contentCompleted) {
      yield createContentBlockCompletedEvent(responseId, blockId, now())
    }
    yield createResponseCompletedEvent(responseId, options.model, options.providerId, usage, now())
  } catch (error) {
    const code = getResponseErrorCode(error)
    const message = sanitizeErrorMessage(error, 'AI request failed')
    logError('llm.stream', { code, message }, {
      sessionId: options.sessionId,
      model: options.model,
      providerId: options.providerId,
      rawError: error,
    })
    yield {
      type: 'response_failed',
      responseId,
      error: {
        code,
        message,
      },
      completedAt: now(),
    } satisfies ResponseFailedEvent
  }
}

function createContentBlockStartedEvent(
  responseId: string,
  blockId: string,
  createdAt: number,
): ContentBlockStartedEvent {
  return {
    type: 'content_block_started',
    responseId,
    block: {
      id: blockId,
      type: 'markdown',
      status: 'streaming',
      role: 'answer',
      createdAt,
    },
  }
}

function createContentBlockCompletedEvent(
  responseId: string,
  blockId: string,
  completedAt: number,
): ContentBlockCompletedEvent {
  return {
    type: 'content_block_completed',
    responseId,
    blockId,
    completedAt,
  }
}

function createResponseCompletedEvent(
  responseId: string,
  model: string,
  providerId: string | undefined,
  usage: TokenUsage | undefined,
  completedAt: number,
): ResponseCompletedEvent {
  return {
    type: 'response_completed',
    responseId,
    usage,
    trace: {
      schemaVersion: RESPONSE_SCHEMA_VERSION,
      // Direct provider streams can still be mapped for tests/tools, but new traces use the agent runtime contract.
      runtime: DEFAULT_ACTIVE_RESPONSE_RUNTIME,
      providerId,
      model,
      finishReason: 'stop',
    },
    finishReason: 'stop',
    completedAt,
  }
}

function getResponseErrorCode(error: unknown): 'LLM_PROVIDER_ERROR' | 'STREAM_ABORTED' {
  if (isAbortError(error)) return 'STREAM_ABORTED'
  return 'LLM_PROVIDER_ERROR'
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const message = error.message.toLowerCase()
    return name === 'aborterror' || message.includes('abort') || message.includes('cancel')
  }
  if (typeof error === 'string') {
    const message = error.toLowerCase()
    return message.includes('abort') || message.includes('cancel')
  }
  return false
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

