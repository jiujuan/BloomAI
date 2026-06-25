import type { ResponseTrace, ToolCallTrace } from './response'
import { RESPONSE_SCHEMA_VERSION } from './response'

export function parseMessageTrace(raw: string | null | undefined): ResponseTrace | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (isLegacyToolCallArray(parsed)) {
    return {
      schemaVersion: RESPONSE_SCHEMA_VERSION,
      runtime: 'mastra-chat-agent-v1',
      toolCalls: parsed,
    }
  }

  if (isResponseTrace(parsed)) {
    return parsed
  }

  return null
}

function isLegacyToolCallArray(value: unknown): value is ToolCallTrace[] {
  return Array.isArray(value) && value.every(isToolCallTrace)
}

function isToolCallTrace(value: unknown): value is ToolCallTrace {
  if (!isRecord(value)) return false
  if (typeof value.callId !== 'string') return false
  if (typeof value.toolId !== 'string') return false
  if (value.status !== 'success' && value.status !== 'error') return false
  if ('outputSummary' in value && value.outputSummary !== undefined && typeof value.outputSummary !== 'string') return false
  if ('durationMs' in value && value.durationMs !== undefined && typeof value.durationMs !== 'number') return false
  return true
}

function isResponseTrace(value: unknown): value is ResponseTrace {
  if (!isRecord(value)) return false
  return value.schemaVersion === RESPONSE_SCHEMA_VERSION && typeof value.runtime === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
