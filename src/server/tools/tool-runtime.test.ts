import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string

describe('tool runtime contracts and cancellation', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-tool-runtime-'))
    process.env.DATA_DIR = dataDir
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('validates input before invoking an executor and exposes the contract error', async () => {
    vi.resetModules()
    const client = await import('../db/client')
    await client.runMigrations()
    const { toolRegistry } = await import('./registry')
    const { executeToolInternal, ToolContractError } = await import('./execute-tool')
    const executor = vi.fn(async () => ({ results: [] }))
    toolRegistry.web_search = executor

    await expect(executeToolInternal('web_search', { query: '' }, undefined, 100))
      .rejects.toBeInstanceOf(ToolContractError)
    expect(executor).not.toHaveBeenCalled()
  })

  it('validates executor output before completing a run', async () => {
    vi.resetModules()
    const client = await import('../db/client')
    await client.runMigrations()
    const { toolRegistry } = await import('./registry')
    const { executeToolInternal, ToolContractError } = await import('./execute-tool')
    const { toolRepo } = await import('../db/repositories/tool.repo')
    toolRegistry.web_search = vi.fn(async () => ({ total: 'not-a-number' } as any))

    await expect(executeToolInternal('web_search', { query: 'contract' }, undefined, 100))
      .rejects.toBeInstanceOf(ToolContractError)

    expect(toolRepo.listRuns('web_search')[0]).toMatchObject({ status: 'error' })
  })

  it('propagates cancellation and waits only for bounded cleanup', async () => {
    vi.resetModules()
    const client = await import('../db/client')
    await client.runMigrations()
    const { toolRegistry } = await import('./registry')
    const { executeToolInternal, ToolExecutionError } = await import('./execute-tool')
    const { toolRepo } = await import('../db/repositories/tool.repo')
    const controller = new AbortController()
    let aborted = false
    toolRegistry.web_search = vi.fn(async (_input, context) => new Promise(() => {
      context.signal?.addEventListener('abort', () => { aborted = true }, { once: true })
    }))

    const pending = executeToolInternal('web_search', { query: 'cancel' }, undefined, 5_000, {
      signal: controller.signal,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort()

    await expect(pending).rejects.toBeInstanceOf(ToolExecutionError)
    expect(aborted).toBe(true)
    expect(toolRepo.listRuns('web_search')[0]).toMatchObject({ status: 'cancelled' })
  })
})
