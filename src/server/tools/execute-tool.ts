import { toolRepo } from '../db/repositories/tool.repo'
import { toolRegistry } from './registry'

export async function executeTool(toolId: string, input: object, sessionId?: string): Promise<object> {
  const tool = toolRepo.get(toolId)
  if (!tool) throw new Error(`Tool not found: ${toolId}`)
  if (!tool.is_enabled) throw new Error(`Tool ${toolId} is disabled`)

  const run = toolRepo.startRun(toolId, sessionId || null, input)
  try {
    const executor = toolRegistry[toolId]
    if (!executor) throw new Error(`No executor for tool: ${toolId}`)

    const result = await Promise.race([
      executor(input, { toolId, sessionId }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Tool timeout after 15000ms`)), 15000))
    ])
    toolRepo.completeRun(run.id, result as object)
    return result as object
  } catch (err: any) {
    toolRepo.failRun(run.id, err.message)
    throw err
  }
}
