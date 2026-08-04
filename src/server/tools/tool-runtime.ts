import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { toolRepo } from '../db/repositories/tool.repo'
import { getToolDefinition } from './registry'
import { ControlledProcessError } from './utils/process-runner'
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
  cleanupGraceMs?: number
}

export class ToolContractError extends Error {
  constructor(
    readonly phase: 'input' | 'output',
    readonly toolId: string,
    readonly issues: z.ZodIssue[],
  ) {
    const detail = issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
    super(`${phase} contract validation failed for ${toolId}: ${detail}`)
    this.name = 'ToolContractError'
  }
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

let orphanedExecutions = 0

export function getToolRuntimeMetrics(): { orphanedExecutions: number } {
  return { orphanedExecutions }
}

export async function executeToolRuntime(
  toolId: string,
  rawInput: unknown,
  sessionId: string | undefined,
  timeoutMs: number,
  options: ToolExecutionOptions = {},
): Promise<ToolExecution> {
  const definition = getToolDefinition(toolId)
  if (!definition) throw new Error(`Tool not found: ${toolId}`)

  const parsedInput = definition.inputSchema.safeParse(rawInput)
  if (!parsedInput.success) throw new ToolContractError('input', toolId, parsedInput.error.issues)
  if (options.signal?.aborted) throw new ToolCancelledError()

  const run = toolRepo.startRun(toolId, sessionId || null, parsedInput.data)
  const controller = new AbortController()
  const caller = options.caller ?? 'http'
  const allowedRoots = options.allowedRoots?.length ? options.allowedRoots : [process.cwd()]
  const requestId = options.requestId ?? randomUUID()
  const cleanupGraceMs = Math.max(0, options.cleanupGraceMs ?? 100)
  let timeout: NodeJS.Timeout | undefined
  let externalAbortHandler: (() => void) | undefined
  let cancellationAbortHandler: (() => void) | undefined
  let timeoutTriggered = false
  let cancelled = false
  let executorPromise: Promise<object> | undefined

  const abortForCancellation = () => {
    cancelled = true
    const error = new ToolCancelledError('Tool execution cancelled')
    if (!controller.signal.aborted) controller.abort(error)
    return error
  }

  try {
    if (options.signal) {
      externalAbortHandler = () => { abortForCancellation() }
      if (options.signal.aborted) {
        abortForCancellation()
      } else {
        options.signal.addEventListener('abort', externalAbortHandler, { once: true })
      }
    }

    if (controller.signal.aborted) throw new ToolCancelledError()

    const context: ToolExecutionContext = {
      toolId,
      sessionId,
      caller,
      allowedRoots,
      signal: controller.signal,
      requestId,
    }
    executorPromise = Promise.resolve().then(() => definition.execute(parsedInput.data, context)) as Promise<object>
    void executorPromise.catch(() => {})

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timeoutTriggered = true
        const error = new ToolTimeoutError(`Tool timeout after ${timeoutMs}ms`)
        if (!controller.signal.aborted) controller.abort(error)
        reject(error)
      }, Math.max(0, timeoutMs))
    })

    const cancellationPromise = options.signal
      ? new Promise<never>((_, reject) => {
          cancellationAbortHandler = () => reject(abortForCancellation())
          if (options.signal!.aborted) cancellationAbortHandler()
          else options.signal!.addEventListener('abort', cancellationAbortHandler, { once: true })
        })
      : null

    const result = await Promise.race([
      executorPromise,
      timeoutPromise,
      ...(cancellationPromise ? [cancellationPromise] : []),
    ])

    if (controller.signal.aborted) {
      throw cancelled
        ? new ToolCancelledError()
        : new ToolTimeoutError(`Tool timeout after ${timeoutMs}ms`)
    }

    const parsedOutput = definition.outputSchema.safeParse(result)
    if (!parsedOutput.success) throw new ToolContractError('output', toolId, parsedOutput.error.issues)

    toolRepo.completeRun(run.id, parsedOutput.data as object)
    return { output: parsedOutput.data as object, toolRunId: run.id }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const processTimeout = error instanceof ControlledProcessError && error.code === 'PROCESS_TIMEOUT'
    const processCancelled = error instanceof ControlledProcessError && error.code === 'PROCESS_CANCELLED'
    const status = timeoutTriggered || error instanceof ToolTimeoutError || processTimeout
      ? 'timeout'
      : cancelled || error instanceof ToolCancelledError || processCancelled
        ? 'cancelled'
        : 'error'
    if (status !== 'error') {
      const completed = await boundedCleanup(executorPromise, cleanupGraceMs)
      if (!completed) orphanedExecutions += 1
    }
    toolRepo.failRun(run.id, message, status)
    if (error instanceof ToolExecutionError) throw error
    if (error instanceof ToolContractError) throw error
    throw new ToolExecutionError(message, run.id, status)
  } finally {
    if (timeout) clearTimeout(timeout)
    if (externalAbortHandler && options.signal) {
      options.signal.removeEventListener('abort', externalAbortHandler)
    }
    if (cancellationAbortHandler && options.signal) {
      options.signal.removeEventListener('abort', cancellationAbortHandler)
    }
  }
}

async function boundedCleanup(executorPromise: Promise<object> | undefined, graceMs: number): Promise<boolean> {
  if (!executorPromise) return true
  let completed = false
  await Promise.race([
    executorPromise.then(() => { completed = true }, () => { completed = true }),
    new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
  ])
  return completed
}
