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
import { logError } from '../logger/logger'
import type { ChatStreamEvent } from './types'

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
    runtime: 'direct-llm',
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
    logError('llm.stream', error, {
      sessionId: options.sessionId,
      model: options.model,
      providerId: options.providerId,
    })
    yield {
      type: 'response_failed',
      responseId,
      error: {
        code: 'LLM_PROVIDER_ERROR',
        message: getErrorMessage(error, 'AI request failed'),
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
      runtime: 'direct-llm',
      providerId,
      model,
      finishReason: 'stop',
    },
    finishReason: 'stop',
    completedAt,
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

