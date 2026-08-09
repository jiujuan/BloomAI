import { McpError } from './errors'
import type { JsonSafeValue, NormalizedMcpResult } from './types'

export const MCP_RESULT_MAX_BYTES = 128 * 1024
export const MCP_RESULT_REDACTED_VALUE = '[REDACTED]'
export const MCP_RESULT_TRUNCATED_VALUE = '[TRUNCATED]'

export type NormalizeMcpResultOptions = {
  maxBytes?: number
}

export function normalizeMcpResult(
  input: unknown,
  options: NormalizeMcpResultOptions = {},
): NormalizedMcpResult {
  const maxBytes = options.maxBytes ?? MCP_RESULT_MAX_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes < 256) {
    throw new McpError('MCP_CONFIG_INVALID')
  }

  try {
    if (!isRecord(input) || !Array.isArray(input.content)) {
      throw new McpError('MCP_PROTOCOL_ERROR')
    }

    const isError = input.isError === undefined
      ? false
      : input.isError
    if (typeof isError !== 'boolean') {
      throw new McpError('MCP_PROTOCOL_ERROR')
    }

    const active = new WeakSet<object>()
    const content = input.content.map((value) => normalizeJsonValue(value, active))
    const hasStructuredContent = Object.prototype.hasOwnProperty.call(input, 'structuredContent')
      && input.structuredContent !== undefined
    const structuredContent = hasStructuredContent
      ? normalizeJsonValue(input.structuredContent, active)
      : undefined

    const result: MutableNormalizedMcpResult = {
      content,
      isError,
      truncated: false,
    }
    if (structuredContent !== undefined) result.structuredContent = structuredContent

    if (serializedByteLength(result) <= maxBytes) return result
    return truncateNormalizedResult(result, maxBytes, hasStructuredContent)
  } catch (error) {
    if (error instanceof McpError) throw error
    throw new McpError('MCP_PROTOCOL_ERROR', { cause: error })
  }
}

export function isJsonSafeValue(value: unknown): value is JsonSafeValue {
  try {
    normalizeJsonValue(value, new WeakSet<object>())
    return true
  } catch {
    return false
  }
}

type MutableNormalizedMcpResult = {
  content: JsonSafeValue[]
  structuredContent?: JsonSafeValue
  isError: boolean
  truncated: boolean
  safeSummary?: string
}

function normalizeJsonValue(value: unknown, active: WeakSet<object>): JsonSafeValue {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new McpError('MCP_PROTOCOL_ERROR')
    return value
  }
  if (typeof value !== 'object') throw new McpError('MCP_PROTOCOL_ERROR')
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    throw new McpError('MCP_PROTOCOL_ERROR')
  }
  if (active.has(value)) throw new McpError('MCP_PROTOCOL_ERROR')

  active.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new McpError('MCP_PROTOCOL_ERROR')
      }
      return value.map((entry) => normalizeJsonValue(entry, active))
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new McpError('MCP_PROTOCOL_ERROR')
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new McpError('MCP_PROTOCOL_ERROR')
    }

    const output: Record<string, JsonSafeValue> = {}
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) {
        throw new McpError('MCP_PROTOCOL_ERROR')
      }
      const normalized = normalizeJsonValue(descriptor.value, active)
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: isSensitiveKey(key) ? MCP_RESULT_REDACTED_VALUE : normalized,
        writable: true,
      })
    }
    return output
  } finally {
    active.delete(value)
  }
}

function truncateNormalizedResult(
  result: MutableNormalizedMcpResult,
  maxBytes: number,
  hasStructuredContent: boolean,
): NormalizedMcpResult {
  result.truncated = true

  for (const reference of collectStringReferences(result)) {
    let current = reference.get()
    while (serializedByteLength(result) > maxBytes && current.length > 0) {
      const currentBytes = Buffer.byteLength(current, 'utf8')
      const nextTarget = Math.max(1, Math.floor(currentBytes / 2))
      const next = truncateStringByBytes(current, nextTarget)
      if (next === current) break
      reference.set(next)
      current = next
    }
    if (serializedByteLength(result) <= maxBytes) return result
  }

  const compact: MutableNormalizedMcpResult = {
    content: [MCP_RESULT_TRUNCATED_VALUE],
    isError: result.isError,
    truncated: true,
  }
  if (hasStructuredContent) compact.structuredContent = MCP_RESULT_TRUNCATED_VALUE
  if (serializedByteLength(compact) <= maxBytes) return compact

  return {
    content: [],
    isError: result.isError,
    truncated: true,
  }
}

type StringReference = {
  get: () => string
  set: (value: string) => void
}

function collectStringReferences(value: unknown): StringReference[] {
  const references: StringReference[] = []
  const active = new WeakSet<object>()

  function visit(current: unknown, parent?: object, key?: string | number): void {
    if (typeof current === 'string') {
      if (parent !== undefined && key !== undefined) {
        const container = parent as Record<string | number, unknown>
        references.push({
          get: () => container[key] as string,
          set: (next) => {
            container[key] = next
          },
        })
      }
      return
    }
    if (typeof current !== 'object' || current === null || active.has(current)) return
    active.add(current)
    try {
      if (Array.isArray(current)) {
        current.forEach((entry, index) => visit(entry, current, index))
      } else {
        const object = current as Record<string, unknown>
        Object.keys(object).forEach((entryKey) => visit(object[entryKey], current, entryKey))
      }
    } finally {
      active.delete(current)
    }
  }

  visit(value)
  return references.sort((left, right) => (
    Buffer.byteLength(right.get(), 'utf8') - Buffer.byteLength(left.get(), 'utf8')
  ))
}

function truncateStringByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  const marker = MCP_RESULT_TRUNCATED_VALUE
  if (Buffer.byteLength(marker, 'utf8') >= maxBytes) return marker

  const encoded = Buffer.from(value, 'utf8')
  let prefixBytes = maxBytes - Buffer.byteLength(marker, 'utf8')
  while (prefixBytes > 0 && (encoded[prefixBytes] & 0xc0) === 0x80) prefixBytes -= 1
  const prefix = encoded.subarray(0, prefixBytes).toString('utf8')
  return `${prefix}${marker}`
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s_-]/g, '')
  return normalized.includes('authorization')
    || normalized.includes('cookie')
    || normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized.includes('apikey')
    || normalized.includes('credential')
    || normalized.includes('privatekey')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
