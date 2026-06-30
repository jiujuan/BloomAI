import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveErrorTimeline, type ResponseError } from '@shared/llm-response-contract/error-timeline-registry'
import { readConfigValue } from '../config/config'

export type LogEntry = {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
  details?: unknown
}

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|token|secret|password|credential|bearer)/i
const SENSITIVE_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]+/g,
  /api[_-]?key\s*[=:]\s*[^\s,;]+/gi,
  /bearer\s+[^\s,;]+/gi,
]

export function getLogDir(): string {
  const configured = readConfigValue('LOG_DATA_DIR').value
  if (configured) return resolvePath(configured)
  const dataDir = readConfigValue('DATA_DIR', path.join(os.homedir(), '.bloomai')).value
  return path.join(resolvePath(dataDir), 'logs')
}

export function appendLog(entry: Omit<LogEntry, 'timestamp'> & { timestamp?: string }): LogEntry {
  const logEntry: LogEntry = {
    timestamp: entry.timestamp || new Date().toISOString(),
    level: entry.level,
    scope: entry.scope,
    message: sanitizeErrorMessage(entry.message),
    details: sanitizeForLog(entry.details),
  }
  fs.mkdirSync(getLogDir(), { recursive: true })
  fs.appendFileSync(getLogFilePath(logEntry.timestamp), JSON.stringify(logEntry) + '\n', 'utf8')
  return logEntry
}

export function logError(scope: string, error: unknown, details?: Record<string, unknown>): LogEntry {
  const responseError = getResponseError(error)
  const definition = resolveErrorTimeline(responseError)
  return appendLog({
    level: definition.logLevel,
    scope,
    message: responseError.message,
    details: mergeDetails(details, error, responseError.code),
  })
}

export function readLogs(date?: string): LogEntry[] {
  const dir = getLogDir()
  if (!fs.existsSync(dir)) return []
  const files = date ? [getLogFilePath(date)] : fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).map((name) => path.join(dir, name)).sort()
  const entries: LogEntry[] = []
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    if (!fs.existsSync(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    const lines = content.split(/\r?\n/)
    for (let j = 0; j < lines.length; j += 1) {
      const line = lines[j].trim()
      if (!line) continue
      try {
        entries.push(JSON.parse(line) as LogEntry)
      } catch {
        continue
      }
    }
  }
  return entries
}

export function sanitizeErrorMessage(message: unknown, fallback = 'Unknown error'): string {
  const raw = typeof message === 'string' && message
    ? message
    : message instanceof Error && message.message
      ? message.message
      : isRecord(message) && typeof message.message === 'string'
        ? message.message
        : fallback
  return redactString(raw)
}

function getLogFilePath(timestampOrDate: string): string {
  const date = timestampOrDate.slice(0, 10)
  return path.join(getLogDir(), date + '.jsonl')
}

function getResponseError(error: unknown): ResponseError {
  const code = getErrorCode(error)
  return {
    code,
    message: sanitizeErrorMessage(error),
  }
}

function getErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string') return error.code
  return 'UNKNOWN_ERROR'
}

function mergeDetails(
  details: Record<string, unknown> | undefined,
  error: unknown,
  code: string,
): Record<string, unknown> | undefined {
  const errorDetails = getErrorDetails(error, code)
  if (!details && !errorDetails) return undefined
  return sanitizeForLog({ ...(details || {}), ...(errorDetails || {}) }) as Record<string, unknown>
}

function getErrorDetails(error: unknown, code: string): Record<string, unknown> | undefined {
  if (error instanceof Error) {
    return { code, name: error.name, stack: error.stack }
  }
  if (isRecord(error)) {
    return { code, ...error }
  }
  if (typeof error === 'string') {
    return { code }
  }
  return { code }
}

function sanitizeForLog(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(sanitizeForLog)
  if (isRecord(value)) {
    const next: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      next[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeForLog(child)
    }
    return next
  }
  return value
}

function redactString(value: string): string {
  return SENSITIVE_VALUE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, (match) => {
      const prefix = match.match(/^(api[_-]?key\s*[=:]|bearer)\s*/i)?.[0]
      return prefix ? `${prefix}[REDACTED]` : '[REDACTED]'
    }),
    value,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function resolvePath(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
}