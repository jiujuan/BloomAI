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
    expect(tools).not.toHaveProperty('node_runner')
    expect(tools).not.toHaveProperty('python_runner')
    expect(tools).not.toHaveProperty('shell')
    expect(tools).toHaveProperty('web_search')
  })

  it('keeps execution tools disabled until C2 isolation acceptance', async () => {
    const { getToolAvailability } = await loadRuntime()
    const { getToolContract } = await import('./contracts')
    const { assertPythonPackagesDisabled, getPythonCommand } = await import('./python-runner')

    expect(getToolAvailability('node_runner')).toMatchObject({ status: 'disabled' })
    expect(getToolAvailability('python_runner')).toMatchObject({ status: 'disabled' })
    expect(getToolAvailability('shell')).toMatchObject({ status: 'disabled' })
    expect(getToolContract('node_runner')?.description).toContain('not an OS sandbox')
    expect(() => assertPythonPackagesDisabled(['requests'])).toThrow(/installation is disabled/)
    expect(getPythonCommand('win32')).toBe('python')
    expect(getPythonCommand('linux')).toBe('python3')
  })

  it('uses the exact shared input and output contracts in Mastra and the database projection', async () => {
    const { buildBuiltinTools, toolRepo } = await loadRuntime()
    const { getToolContract, schemaToJsonSchema } = await import('./contracts')
    const contract = getToolContract('web_fetch')!
    const agentTool = buildBuiltinTools().web_fetch as any
    const storedTool = toolRepo.get('web_fetch')!

    expect(schemaToJsonSchema(agentTool.inputSchema)).toEqual(schemaToJsonSchema(contract.inputSchema))
    expect(agentTool.inputSchema.safeParse({ url: 'https://example.com', maxChars: 0 }).success).toBe(false)
    expect(agentTool.inputSchema.safeParse({ url: 'https://example.com' }).success).toBe(true)
    expect(schemaToJsonSchema(agentTool.outputSchema)).toEqual(schemaToJsonSchema(contract.outputSchema))
    expect(JSON.parse(storedTool.params_schema)).toEqual(schemaToJsonSchema(contract.inputSchema))
    expect(JSON.parse(storedTool.result_schema)).toEqual(schemaToJsonSchema(contract.outputSchema))
  })
})
