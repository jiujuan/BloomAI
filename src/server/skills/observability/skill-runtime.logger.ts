import { AsyncLocalStorage } from 'node:async_hooks'
import { appendLog, sanitizeErrorMessage } from '../../logger/logger'
import type { SkillRuntimeCorrelation } from './skill-runtime.metrics'

export type SkillRuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type SkillRuntimeLogEntry = {
  timestamp: string
  level: SkillRuntimeLogLevel
  scope: string
  message: string
  details?: unknown
  correlation: SkillRuntimeCorrelation
}

export type SkillRuntimeLoggerOptions = {
  sink?: (entry: SkillRuntimeLogEntry) => void
  sampleRate?: number
  retentionMs?: number
  maxEntries?: number
  now?: () => number
}

const correlationStorage = new AsyncLocalStorage<SkillRuntimeCorrelation>()
const SENSITIVE_KEY_PATTERN = /(prompt|raw[_-]?input|authorization|api[_-]?key|token|secret|password|credential|bearer|cookie|private[_-]?key)/i
const SENSITIVE_TEXT_PATTERNS = [
  /api[_-]?key\s*[=:]\s*[^\s,;]+/gi,
  /bearer\s+[^\s,;]+/gi,
  /(?:authorization|token|secret|password)\s*[=:]\s*[^\s,;]+/gi,
]

function clampRate(value: number | undefined): number {
  if (value === undefined) return 1
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}

function normalizeTimestamp(value: number): number {
  return Number.isFinite(value) ? value : Date.now()
}

function redactText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce((current, pattern) => current.replace(pattern, (match) => {
    const prefix = match.match(/^(api[_-]?key|authorization|token|secret|password)\s*[=:]\s*/i)?.[0]
    return prefix ? `${prefix}[REDACTED]` : '[REDACTED]'
  }), sanitizeErrorMessage(value))
}

function redactDetails(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]'
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((item) => redactDetails(item, depth + 1))
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      next[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactDetails(child, depth + 1)
    }
    return next
  }
  return value
}

export function getSkillCorrelation(): SkillRuntimeCorrelation {
  return { ...(correlationStorage.getStore() ?? {}) }
}

export function withSkillCorrelation<T>(correlation: SkillRuntimeCorrelation, callback: () => T): T
export function withSkillCorrelation<T>(correlation: SkillRuntimeCorrelation, callback: () => Promise<T>): Promise<T>
export function withSkillCorrelation<T>(correlation: SkillRuntimeCorrelation, callback: () => T | Promise<T>): T | Promise<T> {
  return correlationStorage.run({ ...(correlationStorage.getStore() ?? {}), ...correlation }, callback)
}

export class SkillRuntimeLogger {
  private readonly sink: (entry: SkillRuntimeLogEntry) => void
  private readonly now: () => number
  private readonly retentionMs: number
  private readonly maxEntries: number
  private sampleRate: number
  private entries: SkillRuntimeLogEntry[] = []

  constructor(options: SkillRuntimeLoggerOptions = {}) {
    this.sink = options.sink ?? ((entry) => {
      appendLog({
        level: entry.level,
        scope: entry.scope,
        message: entry.message,
        details: { ...(entry.details && typeof entry.details === 'object' ? entry.details as Record<string, unknown> : {}), correlation: entry.correlation },
        timestamp: entry.timestamp,
      })
    })
    this.now = options.now ?? (() => Date.now())
    this.retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60 * 1000
    this.maxEntries = options.maxEntries ?? 2_000
    this.sampleRate = clampRate(options.sampleRate ?? readSampleRate())
    if (!Number.isFinite(this.retentionMs) || this.retentionMs < 1) throw new Error('retentionMs must be a positive number')
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) throw new Error('maxEntries must be a positive integer')
  }

  setSampleRate(value: number): void {
    this.sampleRate = clampRate(value)
  }

  info(scope: string, message: string, details?: unknown): SkillRuntimeLogEntry | undefined {
    return this.write('info', scope, message, details)
  }

  debug(scope: string, message: string, details?: unknown): SkillRuntimeLogEntry | undefined {
    return this.write('debug', scope, message, details)
  }

  warn(scope: string, message: string, details?: unknown): SkillRuntimeLogEntry | undefined {
    return this.write('warn', scope, message, details)
  }

  error(scope: string, message: string, details?: unknown): SkillRuntimeLogEntry | undefined {
    return this.write('error', scope, message, details)
  }

  recent(): SkillRuntimeLogEntry[] {
    this.prune()
    return this.entries.map((entry) => ({ ...entry, correlation: { ...entry.correlation } }))
  }

  private write(level: SkillRuntimeLogLevel, scope: string, message: string, details?: unknown): SkillRuntimeLogEntry | undefined {
    if (this.sampleRate <= 0 || (this.sampleRate < 1 && Math.random() > this.sampleRate)) return undefined
    const timestamp = new Date(normalizeTimestamp(this.now())).toISOString()
    const entry: SkillRuntimeLogEntry = {
      timestamp,
      level,
      scope: redactText(scope).slice(0, 160),
      message: redactText(message).slice(0, 2_000),
      details: redactDetails(details),
      correlation: getSkillCorrelation(),
    }
    this.prune()
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries)
    try { this.sink(entry) } catch { /* a logging sink failure must not fail a runtime operation */ }
    return entry
  }

  private prune(): void {
    const cutoff = normalizeTimestamp(this.now()) - this.retentionMs
    this.entries = this.entries.filter((entry) => Date.parse(entry.timestamp) >= cutoff)
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries)
  }
}

function readSampleRate(): number {
  const raw = typeof process !== 'undefined' ? process.env.SKILL_RUNTIME_LOG_SAMPLE_RATE : undefined
  const parsed = raw === undefined ? 1 : Number(raw)
  return Number.isFinite(parsed) ? parsed : 1
}

export const skillRuntimeLogger = new SkillRuntimeLogger()
