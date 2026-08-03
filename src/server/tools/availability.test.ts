import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../db/client')
  await client.runMigrations()
  const { toolRepo } = await import('../db/repositories/tool.repo')
  const { buildBuiltinTools } = await import('../mastra/tools')
  const availability = await import('./availability')
  return { client, toolRepo, buildBuiltinTools, ...availability }
}

describe('tool availability', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-tool-availability-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('marks placeholder tools as dependency missing and blocks their executor path', async () => {
    const { toolRepo, getToolAvailability } = await loadRuntime()

    expect(getToolAvailability('web_screenshot')).toEqual({
      status: 'dependency_missing',
      dependency: 'playwright',
      reason: expect.any(String),
    })
    expect(getToolAvailability('ocr')).toEqual({
      status: 'dependency_missing',
      dependency: 'ocr-backend',
      reason: expect.any(String),
    })
    expect(getToolAvailability('image_edit')).toEqual({
      status: 'dependency_missing',
      dependency: 'image-processing-backend',
      reason: expect.any(String),
    })
    expect(toolRepo.list().filter((tool) => ['web_screenshot', 'ocr', 'image_edit'].includes(tool.id)).every((tool) => tool.is_enabled === 0)).toBe(true)
  })

  it('does not expose unavailable tools to the Mastra agent', async () => {
    const { buildBuiltinTools } = await loadRuntime()
    const tools = buildBuiltinTools()

    expect(tools).not.toHaveProperty('web_screenshot')
    expect(tools).not.toHaveProperty('ocr')
    expect(tools).not.toHaveProperty('image_edit')
    expect(tools).toHaveProperty('web_search')
  })
})
