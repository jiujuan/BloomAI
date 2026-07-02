import { toolRepo } from '../db/repositories/tool.repo'
import { toolRegistry } from './registry'

const DEFAULT_TOOL_TIMEOUT_MS = 15000
// Web tools may drive a headless browser for JS rendering, which needs longer.
const TOOL_TIMEOUT_OVERRIDES: Record<string, number> = {
  web_fetch: 35000,
  web_extract: 35000,
  web_screenshot: 35000,
}

export async function executeTool(toolId: string, input: object, sessionId?: string): Promise<object> {
  const tool = toolRepo.get(toolId)
  if (!tool) throw new Error(`Tool not found: ${toolId}`)
  if (!tool.is_enabled) throw new Error(`Tool ${toolId} is disabled`)

  const run = toolRepo.startRun(toolId, sessionId || null, input)
  try {
    const executor = toolRegistry[toolId]
    if (!executor) throw new Error(`No executor for tool: ${toolId}`)

    const timeoutMs = TOOL_TIMEOUT_OVERRIDES[toolId] ?? DEFAULT_TOOL_TIMEOUT_MS
    const result = await Promise.race([
      executor(input, { toolId, sessionId }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Tool timeout after ${timeoutMs}ms`)), timeoutMs))
    ])
    toolRepo.completeRun(run.id, result as object)
    return result as object
  } catch (err: any) {
    toolRepo.failRun(run.id, err.message)
    throw err
  }
}
