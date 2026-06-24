import { MASTRA_CHAT_AGENT_V1_RUNTIME } from './constants'
import type { ChatAgentRuntimeEvent, ChatAgentTokenUsage, ToolCallViewModel } from './types'

export type MastraChunkMapperOptions = {
  maxSteps?: number
}

export type MastraFinalOutputMapperOptions = {
  emittedCallIds?: Set<string>
  emittedResultIds?: Set<string>
}

type UnknownRecord = Record<string, unknown>

export function mapMastraChunkToEvent(
  chunk: unknown,
  options: MastraChunkMapperOptions = {},
): ChatAgentRuntimeEvent | null {
  const record = asRecord(chunk)
  if (!record) return null

  switch (record.type) {
    case 'text-delta':
    case 'text_delta':
      return mapTextDelta(record)
    case 'tool-call':
    case 'tool_call':
      return mapToolCall(record)
    case 'tool-result':
    case 'tool_result':
      return mapToolResult(record)
    case 'tool-error':
    case 'tool_error':
      return mapToolError(record)
    case 'finish':
      return mapFinish(record, options)
    default:
      return null
  }
}

export const mapMastraChunkToBloomEvent = mapMastraChunkToEvent

export function mapMastraFinalOutputToBloomEvents(
  output: unknown,
  options: MastraFinalOutputMapperOptions = {},
): ChatAgentRuntimeEvent[] {
  const record = asRecord(output)
  if (!record) return []

  const emittedCallIds = options.emittedCallIds ?? new Set<string>()
  const emittedResultIds = options.emittedResultIds ?? new Set<string>()
  const events: ChatAgentRuntimeEvent[] = []

  for (const toolCall of toArray(record.toolCalls)) {
    const event = mapToolCall(asRecord(toolCall))
    if (event && !emittedCallIds.has(event.call.callId)) {
      events.push(event)
    }
  }

  for (const toolResult of toArray(record.toolResults)) {
    const event = mapToolResult(asRecord(toolResult))
    if (event && !emittedResultIds.has(event.callId)) {
      events.push(event)
    }
  }

  return events
}

function mapTextDelta(record: UnknownRecord): ChatAgentRuntimeEvent | null {
  const text = firstString(record.textDelta, record.delta, record.text)
  if (!text) return null
  return { type: 'delta', text }
}

function mapToolCall(record: UnknownRecord | null): Extract<ChatAgentRuntimeEvent, { type: 'tool_call_start' }> | null {
  if (!record) return null
  const callId = getCallId(record)
  const toolId = getToolId(record)
  if (!callId || !toolId) return null

  return {
    type: 'tool_call_start',
    call: {
      callId,
      toolId,
      category: getToolCategory(toolId),
      status: 'running',
      input: getToolInput(record),
    },
  }
}

function mapToolResult(record: UnknownRecord | null): Extract<ChatAgentRuntimeEvent, { type: 'tool_call_result' }> | null {
  if (!record) return null
  const callId = getCallId(record)
  if (!callId) return null

  return {
    type: 'tool_call_result',
    callId,
    output: record.result ?? record.output,
  }
}

function mapToolError(record: UnknownRecord): Extract<ChatAgentRuntimeEvent, { type: 'tool_call_error' }> | null {
  const callId = getCallId(record)
  if (!callId) return null

  return {
    type: 'tool_call_error',
    callId,
    error: getErrorMessage(record.error ?? record.message),
  }
}

function mapFinish(
  record: UnknownRecord,
  options: MastraChunkMapperOptions,
): Extract<ChatAgentRuntimeEvent, { type: 'done' }> | null {
  if (options.maxSteps === undefined) return null

  return {
    type: 'done',
    trace: {
      runtime: MASTRA_CHAT_AGENT_V1_RUNTIME,
      maxSteps: options.maxSteps,
      toolCalls: [],
      ...(getTokenUsage(record.usage) ? { tokens: getTokenUsage(record.usage) } : {}),
    },
  }
}

function getTokenUsage(usage: unknown): ChatAgentTokenUsage | undefined {
  const record = asRecord(usage)
  return record ? (record as ChatAgentTokenUsage) : undefined
}

function getCallId(record: UnknownRecord): string {
  return firstString(record.toolCallId, record.callId, record.id) ?? stableCallId(getToolId(record), getToolInput(record))
}

function getToolId(record: UnknownRecord): string {
  return firstString(record.toolName, record.toolId, record.name) ?? 'unknown_tool'
}

function getToolInput(record: UnknownRecord): Record<string, unknown> {
  const input = record.args ?? record.input ?? record.arguments
  if (typeof input === 'string') return parseJsonObject(input)
  return asRecord(input) ?? {}
}

function getToolCategory(toolId: string): ToolCallViewModel['category'] {
  if (toolId.includes('search')) return 'search'
  if (toolId.includes('web')) return 'web'
  return 'tool'
}

function stableCallId(toolId: string, input: Record<string, unknown>): string {
  return `${toolId}:${JSON.stringify(input)}`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const record = asRecord(error)
  if (record) return firstString(record.message, record.error) ?? 'Tool call failed'
  return 'Tool call failed'
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function asRecord(value: unknown): UnknownRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as UnknownRecord
  return null
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(value)) ?? {}
  } catch {
    return {}
  }
}
