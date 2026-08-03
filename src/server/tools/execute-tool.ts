import { randomUUID } from 'node:crypto'
import { toolRepo } from '../db/repositories/tool.repo'
import { toolRegistry } from './registry'
import type { ToolExecutionContext } from './types'

export type ToolExecution = {
  output: object
  toolRunId: string
}

export type ToolExecutionOptions = {
  caller?: ToolExecutionContext['caller']
  allowedRoots?: readonly string[]
  signal?: AbortSignal
  requestId?: string
}

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    readonly toolRunId: string,
    readonly status: 'error' | 'timeout' | 'cancelled' = 'error',
  ) {
    super(message)
    this.name = 'ToolExecutionError'
  }
}

export class ToolTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolTimeoutError'
  }
}

export class ToolCancelledError extends Error {
  constructor(message = 'Tool execution cancelled') {
    super(message)
    this.name = 'ToolCancelledError'
  }
}

// This is deliberately only the execution core. CapabilityBroker owns enablement,
// authorization, approval and timeout policy for every external caller.
export async function executeToolInternal(
  toolId: string,
  input: object,
  sessionId: string | undefined,
  timeoutMs: number,
  options: ToolExecutionOptions = {},
): Promise<ToolExecution> {
  const tool = toolRepo.get(toolId)
  if (!tool) throw new Error(`Tool not found: ${toolId}`)

  const run = toolRepo.startRun(toolId, sessionId || null, input)
  const controller = new AbortController()
  const caller = options.caller ?? 'http'
  const allowedRoots = options.allowedRoots?.length ? options.allowedRoots : [process.cwd()]
  const requestId = options.requestId ?? randomUUID()
  const executor = toolRegistry[toolId]
  let timeout: NodeJS.Timeout | undefined
  let externalAbortHandler: (() => void) | undefined
  let timeoutTriggered = false
  let cancelled = false
  let executorPromise: Promise<object> | undefined

  try {
    if (!executor) throw new Error(`No executor for tool: ${toolId}`)

    const executionContext: ToolExecutionContext = {
      toolId,
      sessionId,
      caller,
      allowedRoots,
      signal: controller.signal,
      requestId,
    }
    executorPromise = Promise.resolve().then(() => executor(input, executionContext)) as Promise<object>
    // Always observe late rejection from a provider that ignores abort.
    void executorPromise.catch(() => {})

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timeoutTriggered = true
        const error = new ToolTimeoutError(`Tool timeout after ${timeoutMs}ms`)
        controller.abort(error)
        reject(error)
      }, timeoutMs)
    })
    const cancellationPromise = options.signal
      ? new Promise<never>((_, reject) => {
          externalAbortHandler = () => {
            cancelled = true
            const error = new ToolCancelledError('Tool execution cancelled')
            controller.abort(options.signal?.reason ?? error)
            reject(error)
          }
          if (options.signal!.aborted) externalAbortHandler()
          else options.signal!.addEventListener('abort', externalAbortHandler, { once: true })
        })
      : null

    const result = await Promise.race([
      executorPromise,
      new Promise<never>((_, reject) => {
        if (timeoutMs <= 0) reject(new ToolTimeoutError(`Tool timeout after ${timeoutMs}ms`))
      }),
      timeoutPromise,
      ...(cancellationPromise ? [cancellationPromise] : []),
    ])
    if (controller.signal.aborted) {
      throw cancelled ? new ToolCancelledError('Tool execution cancelled') : new ToolTimeoutError(`Tool timeout after ${timeoutMs}ms`)
    }
    toolRepo.completeRun(run.id, result as object)
    return { output: result as object, toolRunId: run.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const status = timeoutTriggered || err instanceof ToolTimeoutError ? 'timeout' : cancelled || err instanceof ToolCancelledError ? 'cancelled' : 'error'
    if (status !== 'error') await boundedCleanup(executorPromise)
    toolRepo.failRun(run.id, message, status)
    throw new ToolExecutionError(message, run.id, status)
  } finally {
    if (timeout) clearTimeout(timeout)
    if (externalAbortHandler && options.signal) options.signal.removeEventListener('abort', externalAbortHandler)
  }
}

async function boundedCleanup(
  executorPromise: Promise<object> | undefined,
): Promise<void> {
  if (!executorPromise) return
  await Promise.race([
    executorPromise.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 100)),
  ])
}
