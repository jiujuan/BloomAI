import { toolRepo } from '../db/repositories/tool.repo'
import { toolRegistry } from './registry'

export type ToolExecution = {
  output: object
  toolRunId: string
}

export class ToolExecutionError extends Error {
  constructor(message: string, readonly toolRunId: string) {
    super(message)
    this.name = 'ToolExecutionError'
  }
}

// This is deliberately only the execution core. CapabilityBroker owns enablement,
// authorization, approval and timeout policy for every external caller.
export async function executeToolInternal(
  toolId: string,
  input: object,
  sessionId: string | undefined,
  timeoutMs: number,
): Promise<ToolExecution> {
  const tool = toolRepo.get(toolId)
  if (!tool) throw new Error(`Tool not found: ${toolId}`)

  const run = toolRepo.startRun(toolId, sessionId || null, input)
  let timeout: NodeJS.Timeout | undefined
  try {
    const executor = toolRegistry[toolId]
    if (!executor) throw new Error(`No executor for tool: ${toolId}`)

    const result = await Promise.race([
      executor(input, { toolId, sessionId }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Tool timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    toolRepo.completeRun(run.id, result as object)
    return { output: result as object, toolRunId: run.id }
  } catch (err: any) {
    toolRepo.failRun(run.id, err.message)
    throw new ToolExecutionError(err.message, run.id)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
