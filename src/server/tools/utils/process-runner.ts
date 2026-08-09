import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { resolvePathWithinAllowedRoots, PathPolicyError } from './path-policy'

const execFileAsync = promisify(execFile)

export const DEFAULT_PROCESS_TIMEOUT_MS = 10_000
export const DEFAULT_PROCESS_OUTPUT_BYTES = 512 * 1024

export const DEFAULT_PROCESS_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'PATHEXT',
  'COMSPEC',
  'LANG',
  'LC_ALL',
] as const

export type ProcessTerminationStrategy = 'windows-taskkill-tree' | 'posix-signals'

export type ProcessErrorCode =
  | 'PROCESS_CWD_DENIED'
  | 'PROCESS_ENV_DENIED'
  | 'PROCESS_INVALID_REQUEST'
  | 'PROCESS_SPAWN_FAILED'
  | 'PROCESS_TIMEOUT'
  | 'PROCESS_CANCELLED'
  | 'PROCESS_OUTPUT_LIMIT'
  | 'PROCESS_DEPENDENCY_INSTALL_DISABLED'

export type ProcessErrorInfo = {
  code: ProcessErrorCode
  message: string
}

export type ControlledProcessResult = {
  command: string
  args: string[]
  cwd: string
  stdout: string
  stderr: string
  stdoutBytes: number
  stderrBytes: number
  stdoutTruncated: boolean
  stderrTruncated: boolean
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  exited: boolean
  error?: ProcessErrorInfo
}

export type ControlledProcessRequest = {
  command: string
  args?: readonly string[]
  cwd?: string
  allowedRoots?: readonly string[]
  env?: Readonly<Record<string, string | undefined>>
  envAllowlist?: readonly string[]
  signal?: AbortSignal
  timeoutMs?: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
  killGraceMs?: number
  platform?: NodeJS.Platform
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

type TerminateProcessOptions = {
  platform: NodeJS.Platform
  killGraceMs: number
}

export class ControlledProcessError extends Error {
  constructor(
    readonly code: ProcessErrorCode,
    message: string,
    readonly result?: ControlledProcessResult,
  ) {
    super(message)
    this.name = 'ControlledProcessError'
  }
}

export function getProcessTerminationStrategy(platform: NodeJS.Platform = process.platform): ProcessTerminationStrategy {
  return platform === 'win32' ? 'windows-taskkill-tree' : 'posix-signals'
}

export function buildMinimalProcessEnv(
  request: Pick<ControlledProcessRequest, 'env' | 'envAllowlist' | 'platform'> = {},
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowedKeys = new Set(request.envAllowlist ?? DEFAULT_PROCESS_ENV_KEYS)
  const safeKeys = new Set(DEFAULT_PROCESS_ENV_KEYS)
  const invalidAllowlist = [...allowedKeys].filter((key) => !safeKeys.has(key as typeof DEFAULT_PROCESS_ENV_KEYS[number]))
  if (invalidAllowlist.length > 0) {
    throw new ControlledProcessError(
      'PROCESS_ENV_DENIED',
      `Environment keys are not in the fixed allowlist: ${invalidAllowlist.join(', ')}`,
    )
  }

  const requestedEnv = request.env ?? {}
  const invalidRequestedKeys = Object.keys(requestedEnv).filter((key) => !allowedKeys.has(key))
  if (invalidRequestedKeys.length > 0) {
    throw new ControlledProcessError(
      'PROCESS_ENV_DENIED',
      `Environment keys are not approved: ${invalidRequestedKeys.join(', ')}`,
    )
  }

  const result: NodeJS.ProcessEnv = {}
  for (const key of allowedKeys) {
    const value = requestedEnv[key] ?? sourceEnv[key]
    if (value !== undefined) result[key] = value
  }
  return result
}

export async function runControlledProcess(
  request: ControlledProcessRequest,
  dependencies: { spawn?: SpawnProcess } = {},
): Promise<ControlledProcessResult> {
  const startedAt = Date.now()
  const args = [...(request.args ?? [])]
  validateRequest(request.command, args)

  const platform = request.platform ?? process.platform
  const allowedRoots = request.allowedRoots?.length ? request.allowedRoots : [process.cwd()]
  const cwd = await resolveApprovedCwd(request.cwd ?? allowedRoots[0], allowedRoots).catch((error: unknown) => {
    if (error instanceof ControlledProcessError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new ControlledProcessError('PROCESS_CWD_DENIED', message)
  })
  const env = buildMinimalProcessEnv(request)
  const timeoutMs = normalisePositiveLimit(request.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS, 'timeoutMs')
  const maxStdoutBytes = normalisePositiveLimit(request.maxStdoutBytes ?? DEFAULT_PROCESS_OUTPUT_BYTES, 'maxStdoutBytes')
  const maxStderrBytes = normalisePositiveLimit(request.maxStderrBytes ?? DEFAULT_PROCESS_OUTPUT_BYTES, 'maxStderrBytes')
  const killGraceMs = Math.max(0, Math.floor(request.killGraceMs ?? 250))

  if (request.signal?.aborted) {
    throw new ControlledProcessError('PROCESS_CANCELLED', 'Process execution was cancelled before spawn.')
  }

  const spawnProcess = dependencies.spawn ?? ((command, spawnArgs, options) => spawn(command, spawnArgs, options))
  let child: ChildProcess
  try {
    child = spawnProcess(request.command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ControlledProcessError('PROCESS_SPAWN_FAILED', message)
  }

  return new Promise<ControlledProcessResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let storedStdoutBytes = 0
    let storedStderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false
    let failure: ProcessErrorInfo | undefined
    let terminationPromise: Promise<void> | undefined
    let timeout: NodeJS.Timeout | undefined
    let finished = false

    const makeResult = (): ControlledProcessResult => ({
      command: request.command,
      args,
      cwd,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
      stdoutBytes,
      stderrBytes,
      stdoutTruncated,
      stderrTruncated,
      exitCode: child.exitCode,
      signal: child.signalCode,
      durationMs: Date.now() - startedAt,
      exited: child.exitCode !== null || child.signalCode !== null,
      ...(failure ? { error: failure } : {}),
    })

    const failAndTerminate = (error: ProcessErrorInfo): void => {
      if (finished || failure) return
      failure = error
      terminationPromise ??= terminateChild(child, { platform, killGraceMs })
    }

    const onAbort = (): void => {
      failAndTerminate({
        code: 'PROCESS_CANCELLED',
        message: 'Process execution was cancelled.',
      })
    }

    const onStdout = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stdoutBytes += buffer.byteLength
      const remaining = Math.max(0, maxStdoutBytes - storedStdoutBytes)
      const retainedBytes = Math.min(buffer.byteLength, remaining)
      if (retainedBytes > 0) {
        stdoutChunks.push(buffer.subarray(0, retainedBytes))
        storedStdoutBytes += retainedBytes
      }
      if (retainedBytes < buffer.byteLength) {
        stdoutTruncated = true
        failAndTerminate({
          code: 'PROCESS_OUTPUT_LIMIT',
          message: `stdout exceeded the ${maxStdoutBytes}-byte limit.`,
        })
      }
    }

    const onStderr = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stderrBytes += buffer.byteLength
      const remaining = Math.max(0, maxStderrBytes - storedStderrBytes)
      const retainedBytes = Math.min(buffer.byteLength, remaining)
      if (retainedBytes > 0) {
        stderrChunks.push(buffer.subarray(0, retainedBytes))
        storedStderrBytes += retainedBytes
      }
      if (retainedBytes < buffer.byteLength) {
        stderrTruncated = true
        failAndTerminate({
          code: 'PROCESS_OUTPUT_LIMIT',
          message: `stderr exceeded the ${maxStderrBytes}-byte limit.`,
        })
      }
    }

    const onError = (error: Error): void => {
      failAndTerminate({
        code: 'PROCESS_SPAWN_FAILED',
        message: error.message,
      })
    }

    const onClose = async (): Promise<void> => {
      if (finished) return
      finished = true
      if (timeout) clearTimeout(timeout)
      request.signal?.removeEventListener('abort', onAbort)
      await terminationPromise
      const result = makeResult()
      if (failure) {
        reject(new ControlledProcessError(failure.code, failure.message, result))
      } else {
        resolve(result)
      }
    }

    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('error', onError)
    child.once('close', () => { void onClose() })

    if (request.signal) {
      request.signal.addEventListener('abort', onAbort, { once: true })
    }
    timeout = setTimeout(() => {
      failAndTerminate({
        code: 'PROCESS_TIMEOUT',
        message: `Process exceeded the ${timeoutMs}ms timeout.`,
      })
    }, timeoutMs)
  })
}

async function resolveApprovedCwd(rawCwd: string, allowedRoots: readonly string[]): Promise<string> {
  try {
    return await resolvePathWithinAllowedRoots(rawCwd, {
      allowedRoots,
      access: 'read',
    })
  } catch (error) {
    if (error instanceof PathPolicyError) {
      throw new ControlledProcessError('PROCESS_CWD_DENIED', error.message)
    }
    throw error
  }
}

function validateRequest(command: string, args: readonly string[]): void {
  if (!command.trim()) {
    throw new ControlledProcessError('PROCESS_INVALID_REQUEST', 'A command is required.')
  }
  if (command.includes('\0')) {
    throw new ControlledProcessError('PROCESS_INVALID_REQUEST', 'Command contains a NUL byte.')
  }
  if (args.some((arg) => arg.includes('\0'))) {
    throw new ControlledProcessError('PROCESS_INVALID_REQUEST', 'Arguments cannot contain NUL bytes.')
  }
}

function normalisePositiveLimit(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ControlledProcessError('PROCESS_INVALID_REQUEST', `${name} must be a positive finite number.`)
  }
  return Math.floor(value)
}

const WINDOWS_TASKKILL_TIMEOUT_MS = 1_000

async function terminateChild(child: ChildProcess, options: TerminateProcessOptions): Promise<void> {
  if (!isRunning(child)) return
  if (getProcessTerminationStrategy(options.platform) === 'windows-taskkill-tree') {
    // Do not wait indefinitely for taskkill. Under Windows process pressure the
    // command can outlive the caller's kill grace period; keep the tree-kill
    // attempt bounded and fall back to terminating the direct child.
    const taskkill = child.pid
      ? execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: WINDOWS_TASKKILL_TIMEOUT_MS,
        }).catch(() => {})
      : Promise.resolve()
    await taskkill
    if (isRunning(child)) child.kill()
    return
  }

  child.kill('SIGTERM')
  await waitForExit(child, options.killGraceMs)
  if (isRunning(child)) child.kill('SIGKILL')
  await waitForExit(child, options.killGraceMs)
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (!isRunning(child) || timeoutMs === 0) return
  await new Promise<void>((resolve) => {
    let settled = false
    const onClose = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('close', onClose)
      resolve()
    }
    const timer = setTimeout(onClose, timeoutMs)
    child.once('close', onClose)
  })
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}
