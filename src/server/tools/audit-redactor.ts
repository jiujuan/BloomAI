import { createHash } from 'node:crypto'

export type SanitizedRunPayload = {
  summary: Record<string, unknown>
  redactedFields: string[]
  originalBytes: number
  storedBytes: number
  truncated: boolean
  sha256: string
}

type RedactOptions = {
  maxStoredBytes?: number
}

const DEFAULT_MAX_STORED_BYTES = 16 * 1024
const SECRET_KEY = /(?:authorization|cookie|token|api[-_]?key|secret|password|passphrase|credential|private[-_]?key)/i
const SECRET_QUERY_KEY = /(?:auth|authorization|cookie|token|api[-_]?key|secret|password|key|signature|sig)/i
const SECRET_VALUE = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const KEY_VALUE_SECRET = /\b(?:token|api[_-]?key|secret|password|passwd|authorization)\s*=\s*[^&\s]+/gi
const WINDOWS_ABSOLUTE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^"'?&\s]+/g
const POSIX_PRIVATE_PATH = /\/(?:Users|home|root|private|tmp|var\/folders)\/[^"'?&\s]+/g

export function redactRunPayload(value: unknown, options: RedactOptions = {}): SanitizedRunPayload {
  const maxStoredBytes = Math.max(256, Math.floor(options.maxStoredBytes ?? DEFAULT_MAX_STORED_BYTES))
  const redactedFields: string[] = []
  const originalSerialized = safeSerialize(value)
  const originalBytes = Buffer.byteLength(originalSerialized, 'utf8')
  const sha256 = createHash('sha256').update(originalSerialized).digest('hex')
  const redacted = redactValue(value, '$', redactedFields, new WeakSet<object>())
  const redactedSerialized = safeSerialize(redacted)

  if (Buffer.byteLength(redactedSerialized, 'utf8') <= maxStoredBytes && isRecord(redacted)) {
    return {
      summary: redacted,
      redactedFields: unique(redactedFields),
      originalBytes,
      storedBytes: Buffer.byteLength(redactedSerialized, 'utf8'),
      truncated: false,
      sha256,
    }
  }

  let preview = truncateToBytes(redactedSerialized, Math.max(32, maxStoredBytes - 32))
  let summary: Record<string, unknown> = { preview, truncated: true }
  let summarySerialized = safeSerialize(summary)
  while (Buffer.byteLength(summarySerialized, 'utf8') > maxStoredBytes && preview.length > 0) {
    preview = preview.slice(0, Math.max(0, preview.length - 32))
    summary = { preview, truncated: true }
    summarySerialized = safeSerialize(summary)
  }

  return {
    summary,
    redactedFields: unique(redactedFields),
    originalBytes,
    storedBytes: Buffer.byteLength(summarySerialized, 'utf8'),
    truncated: true,
    sha256,
  }
}

export function redactRunText(value: unknown, maxBytes = 2_000): string {
  const result = redactRunPayload({ message: typeof value === 'string' ? value : String(value) }, { maxStoredBytes: maxBytes })
  const message = result.summary.message
  if (typeof message === 'string') return message
  return result.summary.preview ? String(result.summary.preview) : '[REDACTED]'
}

function redactValue(
  value: unknown,
  fieldPath: string,
  redactedFields: string[],
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') return redactString(value, fieldPath, redactedFields)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item, index) => redactValue(item, `${fieldPath}[${index}]`, redactedFields, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const childPath = fieldPath === '$' ? key : `${fieldPath}.${key}`
    if (SECRET_KEY.test(key)) {
      result[key] = '[REDACTED]'
      redactedFields.push(childPath.replace(/^\$\./, ''))
      continue
    }
    result[key] = redactValue(child, childPath, redactedFields, seen)
  }
  return result
}

function redactString(value: string, fieldPath: string, redactedFields: string[]): string {
  let result = value
  let changed = false
  let parsedUrl = false

  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      parsedUrl = true
      for (const key of [...url.searchParams.keys()]) {
        if (!SECRET_QUERY_KEY.test(key)) continue
        url.searchParams.set(key, '[REDACTED]')
        redactedFields.push(`${fieldPath.replace(/^\$\./, '')}.search.${key}`)
        changed = true
      }
      result = url.toString()
    }
  } catch {
    // Non-URL strings are handled by the generic secret/path patterns below.
  }

  const secretRedacted = result
    .replace(SECRET_VALUE, '[REDACTED]')
    .replace(parsedUrl ? /$^/ : KEY_VALUE_SECRET, '[REDACTED]')
  if (secretRedacted !== result) {
    redactedFields.push(fieldPath.replace(/^\$\./, ''))
    result = secretRedacted
    changed = true
  }

  const pathRedacted = result
    .replace(WINDOWS_ABSOLUTE_PATH, '[PRIVATE_PATH]')
    .replace(POSIX_PRIVATE_PATH, '[PRIVATE_PATH]')
  if (pathRedacted !== result) {
    redactedFields.push(fieldPath.replace(/^\$\./, ''))
    result = pathRedacted
    changed = true
  }

  return changed ? result : value
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let result = value.slice(0, maxBytes)
  while (Buffer.byteLength(result, 'utf8') > maxBytes) result = result.slice(0, -1)
  return result
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, nested) => {
      if (typeof nested === 'bigint') return `${nested}n`
      return nested
    }) ?? 'null'
  } catch {
    return JSON.stringify({ value: String(value) })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
