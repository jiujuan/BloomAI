import { requireToolAvailability } from './availability'
import type { ToolExecutor } from './types'
import { ControlledProcessError, runControlledProcess } from './utils/process-runner'

export type PythonRunnerInput = {
  code: string
  packages?: string[]
}

export function assertPythonPackagesDisabled(packages?: readonly string[]): void {
  if (packages?.length) {
    throw new ControlledProcessError(
      'PROCESS_DEPENDENCY_INSTALL_DISABLED',
      'Python packages are metadata only; dependency installation is disabled.',
    )
  }
}

export function getPythonCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'python' : 'python3'
}

export const pythonRunnerTool: ToolExecutor<PythonRunnerInput> = async (input, context) => {
  requireToolAvailability('python_runner')
  assertPythonPackagesDisabled(input.packages)
  const result = await runControlledProcess({
    command: getPythonCommand(),
    args: ['-c', input.code],
    cwd: context.allowedRoots?.[0],
    allowedRoots: context.allowedRoots,
    signal: context.signal,
    timeoutMs: 10_000,
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
}
