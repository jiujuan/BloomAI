import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readConfigValue } from '../config/config'

export type LogEntry = {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
  details?: unknown
}

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
    message: entry.message,
    details: entry.details,
  }
  fs.mkdirSync(getLogDir(), { recursive: true })
  fs.appendFileSync(getLogFilePath(logEntry.timestamp), JSON.stringify(logEntry) + '\n', 'utf8')
  return logEntry
}

export function logError(scope: string, error: unknown, details?: Record<string, unknown>): LogEntry {
  return appendLog({
    level: 'error',
    scope,
    message: getErrorMessage(error),
    details: mergeDetails(details, error),
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

function getLogFilePath(timestampOrDate: string): string {
  const date = timestampOrDate.slice(0, 10)
  return path.join(getLogDir(), date + '.jsonl')
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'Unknown error'
}

function mergeDetails(details: Record<string, unknown> | undefined, error: unknown): Record<string, unknown> | undefined {
  const errorDetails = getErrorDetails(error)
  if (!details && !errorDetails) return undefined
  return { ...(details || {}), ...(errorDetails || {}) }
}

function getErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error)) return undefined
  return { name: error.name, stack: error.stack }
}

function resolvePath(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
}