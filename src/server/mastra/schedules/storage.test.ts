import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveScheduleRuntimeUrl } from './storage'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('resolveScheduleRuntimeUrl', () => {
  it('creates the supplied data directory and targets only the schedule runtime database', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-schedule-storage-'))
    const dataDir = path.join(root, 'nested', 'data')
    temporaryDirectories.push(root)

    const url = resolveScheduleRuntimeUrl(dataDir)

    expect(fs.existsSync(dataDir)).toBe(true)
    expect(url).toBe(new URL(`file://${path.resolve(dataDir, 'mastra-runtime.db').replace(/\\/g, '/')}`).href)
    expect(url).not.toContain('deep-research-runtime.db')
    expect(url).not.toContain('bloomai.db')
  })
})
