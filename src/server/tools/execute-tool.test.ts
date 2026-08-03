import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string

describe('executeToolInternal cancellation', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-tool-execution-'))
    process.env.DATA_DIR = dataDir
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('aborts the executor on timeout and records a timeout run status', async () => {
    vi.resetModules()
    const client = await import('../db/client')
    await client.runMigrations()
    const { toolRegistry } = await import('./registry')
    const { executeToolInternal, ToolExecutionError } = await import('./execute-tool')
    const { toolRepo } = await import('../db/repositories/tool.repo')
    let aborted = false
    toolRegistry.web_search = vi.fn(async (_input, context) => new Promise(() => {
      context.signal?.addEventListener('abort', () => {
        aborted = true
      }, { once: true })
    }))

    await expect(executeToolInternal('web_search', { query: 'slow' }, undefined, 10))
      .rejects.toBeInstanceOf(ToolExecutionError)

    expect(aborted).toBe(true)
    expect(toolRepo.listRuns('web_search')[0]).toMatchObject({ status: 'timeout' })
  })
})
