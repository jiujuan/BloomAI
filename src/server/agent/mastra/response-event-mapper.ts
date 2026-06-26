import { randomUUID } from 'crypto'
import type {
  ContentBlockCompletedEvent,
  ContentBlockStartedEvent,
  ResponseCompletedEvent,
  ResponseFailedEvent,
  ResponseStartedEvent,
  ResponseStreamEvent,
  ResponseTrace,
  TokenUsage,
  ToolCallBlock,
  ToolCallDeltaEvent,
  ToolCallTrace,
} from '@shared/schemas/response'
import { RESPONSE_SCHEMA_VERSION } from '@shared/schemas/response'
import { sanitizeErrorMessage } from '../../logger/logger'
import type { ChatAgentRuntimeEvent, ChatAgentTokenUsage } from './types'

export type AgentResponseEventMapperOptions = {
  sessionId: string
  model: string
  responseId?: string
  maxSteps: number
  now?: () => number
  idFactory?: () => string
}

export function createAgentResponseEventMapper(options: AgentResponseEventMapperOptions): {
  map(event: ChatAgentRuntimeEvent): ResponseStreamEvent[]
  completeWithoutDone(): ResponseStreamEvent[]
  fail(error: unknown): ResponseStreamEvent[]
} {
  const now = options.now ?? Date.now
  const idFactory = options.idFactory ?? randomUUID
  const responseId = options.responseId ?? idFactory()
  const toolTraceDrafts = new Map<string, ToolCallTrace>()
  let responseStarted = false
  let contentStarted = false
  let contentCompleted = false
  let answerBlockId: string | null = null

  function startResponse(): ResponseStartedEvent[] {
    if (responseStarted) return []
    responseStarted = true
    return [{
      type: 'response_started',
      responseId,
      sessionId: options.sessionId,
      runtime: 'mastra-chat-agent-v1',
      model: options.model,
      createdAt: now(),
    }]
  }

  function startContentBlock(): ContentBlockStartedEvent[] {
    if (contentStarted) return []
    contentStarted = true
    answerBlockId = idFactory()
    return [{
      type: 'content_block_started',
      responseId,
      block: {
        id: answerBlockId,
        type: 'markdown',
        status: 'streaming',
        role: 'answer',
        createdAt: now(),
      },
    }]
  }

  function completeContentBlock(): ContentBlockCompletedEvent[] {
    if (!contentStarted || contentCompleted || !answerBlockId) return []
    contentCompleted = true
    return [{
      type: 'content_block_completed',
      responseId,
      blockId: answerBlockId,
      completedAt: now(),
    }]
  }

  function complete(
    trace: ResponseTrace,
    usage?: TokenUsage,
    finishReason: 'stop' | 'unknown' = 'stop',
  ): ResponseStreamEvent[] {
    return [
      ...completeContentBlock(),
      {
        type: 'response_completed',
        responseId,
        usage,
        trace,
        finishReason,
        completedAt: now(),
      } satisfies ResponseCompletedEvent,
    ]
  }

  return {
    map(event: ChatAgentRuntimeEvent): ResponseStreamEvent[] {
      const events: ResponseStreamEvent[] = [...startResponse()]

      if (event.type === 'delta') {
        events.push(...startContentBlock())
        events.push({
          type: 'content_delta',
          responseId,
          blockId: answerBlockId!,
          delta: event.text,
        })
        return events
      }

      if (event.type === 'tool_call_start') {
        const blockId = idFactory()
        toolTraceDrafts.set(event.call.callId, {
          callId: event.call.callId,
          toolId: event.call.toolId,
          status: 'error',
          input: event.call.input,
        })
        events.push({
          type: 'tool_call_started',
          responseId,
          block: {
            id: blockId,
            type: 'tool_call',
            callId: event.call.callId,
            toolId: event.call.toolId,
            category: normalizeToolCategory(event.call.category, event.call.toolId),
            status: 'running',
            input: event.call.input,
            createdAt: now(),
          } satisfies ToolCallBlock,
        })
        events.push(...createWebSearchStartDeltas(responseId, event.call.callId, event.call.toolId, event.call.input))
        return events
      }

      if (event.type === 'tool_call_delta') {
        events.push({
          type: 'tool_call_delta',
          responseId,
          callId: event.callId,
          patch: event.patch,
        })
        return events
      }

      if (event.type === 'tool_call_result') {
        const outputSummary = summarizeToolOutput(event.output)
        const existing = toolTraceDrafts.get(event.callId)
        const toolId = existing?.toolId
        events.push(...createWebSearchResultDeltas(responseId, event.callId, event.output))
        if (isFailedToolOutput(event.output)) {
          const message = sanitizeErrorMessage(event.output.error, 'Tool call failed')
          if (existing) {
            toolTraceDrafts.set(event.callId, {
              ...existing,
              status: 'error',
              outputSummary: message,
              durationMs: event.durationMs,
            })
          }
          events.push({
            type: 'tool_call_failed',
            responseId,
            callId: event.callId,
            error: { code: toolId === 'web_search' ? 'WEB_SEARCH_FAILED' : 'TOOL_CALL_ERROR', message },
            durationMs: event.durationMs,
            completedAt: now(),
          })
          return events
        }
        if (existing) {
          toolTraceDrafts.set(event.callId, {
            ...existing,
            status: 'success',
            outputSummary,
            durationMs: event.durationMs,
          })
        }
        events.push({
          type: 'tool_call_completed',
          responseId,
          callId: event.callId,
          output: event.output,
          outputSummary,
          durationMs: event.durationMs,
          completedAt: now(),
        })
        return events
      }

      if (event.type === 'tool_call_error') {
        const existing = toolTraceDrafts.get(event.callId)
        if (existing) {
          toolTraceDrafts.set(event.callId, {
            ...existing,
            status: 'error',
            outputSummary: event.error,
          })
        }
        events.push({
          type: 'tool_call_failed',
          responseId,
          callId: event.callId,
          error: { code: 'TOOL_CALL_ERROR', message: sanitizeErrorMessage(event.error, 'Tool call failed') },
          completedAt: now(),
        })
        return events
      }

      if (event.type === 'done') {
        const usage = normalizeTokenUsage(event.trace.tokens, options.model)
        const trace: ResponseTrace = {
          schemaVersion: RESPONSE_SCHEMA_VERSION,
          runtime: event.trace.runtime,
          model: options.model,
          maxSteps: event.trace.maxSteps,
          toolCalls: event.trace.toolCalls.length ? event.trace.toolCalls : Array.from(toolTraceDrafts.values()),
          finishReason: 'stop',
        }
        events.push(...complete(trace, usage, 'stop'))
        return events
      }

      events.push({
        type: 'response_failed',
        responseId,
        error: { code: 'AGENT_RUNTIME_ERROR', message: sanitizeErrorMessage(event.error, 'Agent request failed') },
        completedAt: now(),
      })
      return events
    },

    completeWithoutDone(): ResponseStreamEvent[] {
      return [
        ...startResponse(),
        ...complete({
          schemaVersion: RESPONSE_SCHEMA_VERSION,
          runtime: 'mastra-chat-agent-v1',
          model: options.model,
          maxSteps: options.maxSteps,
          toolCalls: Array.from(toolTraceDrafts.values()),
          finishReason: 'unknown',
        }, undefined, 'unknown'),
      ]
    },

    fail(error: unknown): ResponseStreamEvent[] {
      return [
        ...startResponse(),
        {
          type: 'response_failed',
          responseId,
          error: { code: 'AGENT_RUNTIME_ERROR', message: sanitizeErrorMessage(error, 'Agent request failed') },
          completedAt: now(),
        } satisfies ResponseFailedEvent,
      ]
    },
  }
}

export function normalizeToolCategory(category: string, toolId: string): ToolCallBlock['category'] {
  if (category === 'search' || toolId.includes('search')) return 'search'
  if (category === 'web' || toolId.includes('web')) return 'web'
  if (category === 'execution' || toolId.includes('shell')) return 'shell'
  if (category === 'fs' || category === 'file' || toolId.includes('fs_')) return 'file'
  if (category === 'image' || toolId.includes('image')) return 'image'
  if (category === 'video' || toolId.includes('video')) return 'video'
  return 'tool'
}

export function summarizeToolOutput(output: unknown): string | undefined {
  if (output === null || output === undefined) return undefined
  if (typeof output === 'string') return output.slice(0, 160)
  if (Array.isArray(output)) return `${output.length} items`
  if (typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (Array.isArray(record.results)) return summarizeSearchOutput(record, getSearchResultCount(record))
    if (typeof record.summary === 'string') return record.summary
    if (typeof record.text === 'string') return record.text.slice(0, 160)
  }
  return undefined
}

function createWebSearchStartDeltas(
  responseId: string,
  callId: string,
  toolId: string,
  input: Record<string, unknown>,
): ToolCallDeltaEvent[] {
  if (toolId !== 'web_search') return []
  const query = typeof input.query === 'string' ? input.query : undefined
  if (!query) return []
  return [{
    type: 'tool_call_delta',
    responseId,
    callId,
    patch: {
      statusMessage: `Searching ${query} with tavily`,
      metadata: { query, provider: 'tavily' },
    },
  }]
}

function createWebSearchResultDeltas(responseId: string, callId: string, output: unknown): ToolCallDeltaEvent[] {
  const record = asRecord(output)
  if (!record || record.provider !== 'duckduckgo' || record.fallbackFrom !== 'tavily') return []
  const resultCount = getSearchResultCount(record)
  return [{
    type: 'tool_call_delta',
    responseId,
    callId,
    patch: {
      statusMessage: 'Tavily failed; searching with duckduckgo',
      metadata: {
        provider: 'duckduckgo',
        fallbackFrom: 'tavily',
        ...(typeof record.fallbackReason === 'string' ? { fallbackReason: record.fallbackReason } : {}),
        resultCount,
      },
    },
  }]
}

function summarizeSearchOutput(record: Record<string, unknown>, resultCount: number): string {
  const provider = typeof record.provider === 'string' ? record.provider : undefined
  const fallbackFrom = typeof record.fallbackFrom === 'string' ? record.fallbackFrom : undefined
  if (provider && fallbackFrom) return `${resultCount} results from ${provider} after ${fallbackFrom} fallback`
  if (provider) return `${resultCount} results from ${provider}`
  return `${resultCount} results`
}

function isFailedToolOutput(output: unknown): output is { error: string } {
  const record = asRecord(output)
  return typeof record?.error === 'string' && record.error.length > 0
}

function getSearchResultCount(record: Record<string, unknown>): number {
  if (typeof record.total === 'number') return record.total
  return Array.isArray(record.results) ? record.results.length : 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function normalizeTokenUsage(tokens: ChatAgentTokenUsage | undefined, model: string): TokenUsage | undefined {
  if (!tokens) return undefined
  const inputTokens = typeof tokens.inputTokens === 'number' ? tokens.inputTokens : undefined
  const outputTokens = typeof tokens.outputTokens === 'number' ? tokens.outputTokens : undefined
  const totalTokens = typeof tokens.totalTokens === 'number'
    ? tokens.totalTokens
    : inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens || 0) + (outputTokens || 0)
      : undefined

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    model,
  }
}

