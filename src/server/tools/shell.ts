import { requireToolAvailability } from './availability'
import type { ToolExecutor } from './types'
import { runControlledProcess } from './utils/process-runner'

export type ShellInput = {
  command: string
  cwd?: string
  env?: Record<string, string>
}

export const shellTool: ToolExecutor<ShellInput> = async (input, context) => {
  requireToolAvailability('shell')
  const isWindows = process.platform === 'win32'
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh'
  const args = isWindows
    ? ['/d', '/s', '/c', input.command]
    : ['-c', input.command]
  const result = await runControlledProcess({
    command,
    args,
    cwd: input.cwd,
    allowedRoots: context.allowedRoots,
    env: input.env,
    signal: context.signal,
    timeoutMs: 10_000,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024,
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 1,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  }
}
