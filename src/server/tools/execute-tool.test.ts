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

  it('does not create a run or invoke an executor when the upstream signal is already aborted', async () => {
    vi.resetModules()
    const client = await import('../db/client')
    await client.runMigrations()
    const { toolRegistry } = await import('./registry')
    const { executeToolInternal, ToolCancelledError } = await import('./execute-tool')
    const { toolRepo } = await import('../db/repositories/tool.repo')
    const executor = vi.fn(async () => ({ results: [] }))
    toolRegistry.web_search = executor
    const controller = new AbortController()
    controller.abort()

    await expect(executeToolInternal('web_search', { query: 'pre-cancelled' }, undefined, 100, {
      signal: controller.signal,
    })).rejects.toBeInstanceOf(ToolCancelledError)

    expect(executor).not.toHaveBeenCalled()
    expect(toolRepo.listRuns('web_search')).toEqual([])
  })

  it('removes both upstream abort listeners after a signal-aware execution completes', async () => {
    vi.resetModules()
    const client = await import('../db/client')
    await client.runMigrations()
    const { toolRegistry } = await import('./registry')
    const { executeToolInternal } = await import('./execute-tool')
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    toolRegistry.web_search = vi.fn(async () => ({ query: 'done', total: 0, results: [] }))

    await expect(executeToolInternal('web_search', { query: 'done' }, undefined, 100, {
      signal: controller.signal,
    })).resolves.toMatchObject({ output: { query: 'done' } })

    expect(addListener).toHaveBeenCalledTimes(2)
    expect(removeListener).toHaveBeenCalledTimes(2)
  })
})
