import type { ToolExecutor } from './types'
import { ControlledProcessError, runControlledProcess } from './utils/process-runner'
import { resolveToolPath } from './utils/tool-resource'

const ALLOWED_BASH = new Set(['ls', 'cat', 'grep', 'find', 'pwd', 'wc', 'head', 'tail', 'diff', 'sort', 'uniq', 'tr'])

export type BashInput = { command: string; args?: string[]; cwd?: string }

export const bashTool: ToolExecutor<BashInput> = async (input, context) => {
  const command = input.command.trim()
  if (!ALLOWED_BASH.has(command)) throw new Error(`Command not allowed: ${command}`)
  const args = input.args ?? []
  const cwd = await resolveToolPath(input.cwd ?? '.', context, 'read')
  try {
    const result = await runControlledProcess({
      command,
      args,
      cwd,
      allowedRoots: context.allowedRoots,
      signal: context.signal,
      timeoutMs: 8_000,
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 512 * 1024,
    })
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 1,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    }
  } catch (error) {
    if (error instanceof ControlledProcessError && error.code === 'PROCESS_OUTPUT_LIMIT' && error.result) {
      return {
        stdout: error.result.stdout,
        stderr: error.result.stderr,
        exitCode: error.result.exitCode ?? 1,
        stdoutTruncated: error.result.stdoutTruncated,
        stderrTruncated: error.result.stderrTruncated,
        errorCode: error.code,
      }
    }
    throw error
  }
}
