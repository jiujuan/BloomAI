import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadLogger() {
  const module = await import('./logger')
  return module
}

describe('server logger', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-logger-'))
    originalEnv = { ...process.env }
    process.env.LOG_DATA_DIR = path.join(tempDir, 'logs')
  })

  afterEach(() => {
    process.env = originalEnv
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes logs into LOG_DATA_DIR and reads them back', async () => {
    const { appendLog, readLogs } = await loadLogger()

    appendLog({ level: 'info', scope: 'test.scope', message: 'hello', timestamp: '2026-06-26T01:02:03.000Z' })

    const logFile = path.join(process.env.LOG_DATA_DIR!, '2026-06-26.jsonl')
    expect(fs.existsSync(logFile)).toBe(true)
    expect(readLogs('2026-06-26')).toEqual([
      expect.objectContaining({ level: 'info', scope: 'test.scope', message: 'hello' }),
    ])
  })

  it('uses registry log levels and redacts sensitive provider details', async () => {
    const { logError, readLogs } = await loadLogger()
    const error = new Error('provider failed with sk-live-secret and api_key=abc123') as Error & { code: string }
    error.code = 'STREAM_ABORTED'

    const entry = logError('llm.stream', error, {
      provider: 'openai',
      apiKey: 'sk-live-secret',
      nested: { authorization: 'Bearer hidden-token' },
    })

    expect(entry.level).toBe('warn')
    const [stored] = readLogs()
    const serialized = JSON.stringify(stored)
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('sk-live-secret')
    expect(serialized).not.toContain('abc123')
    expect(serialized).not.toContain('hidden-token')
  })

  it('falls unknown response error codes back to UNKNOWN_ERROR semantics', async () => {
    const { logError } = await loadLogger()
    const error = { code: 'ODD_VENDOR_CODE', message: 'odd failure' }

    expect(logError('agent.runtime', error)).toMatchObject({
      level: 'error',
      message: 'odd failure',
    })
  })

  it('constructs the server logger with ConsoleLogger instead of the deprecated factory', async () => {
    vi.resetModules()
    process.env.LOG_LEVEL = 'info'
    const deprecatedFactory = vi.fn(() => {
      throw new Error('deprecated logger factory must not be called')
    })
    class MockConsoleLogger {
      constructor(readonly options: Record<string, unknown>) {}
      error(): void {}
      warn(): void {}
    }

    vi.doMock('@mastra/core/logger', () => ({
      ConsoleLogger: MockConsoleLogger,
      ['create' + 'Logger']: deprecatedFactory,
      LogLevel: { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error', NONE: 'silent' },
    }))

    const { serverLogger } = await import('./logger')

    expect(serverLogger).toBeInstanceOf(MockConsoleLogger)
    expect(deprecatedFactory).not.toHaveBeenCalled()
    expect((serverLogger as unknown as MockConsoleLogger).options).toMatchObject({ name: 'bloomai', level: 'info' })

    vi.doUnmock('@mastra/core/logger')
    vi.resetModules()
  })
})
