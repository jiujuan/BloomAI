import os from 'os'
import type { ToolExecutor } from './types'
import { execFileAsync } from './utils/process'
import { resolveSafePath } from './utils/path'

const ALLOWED_BASH = new Set(['ls','cat','echo','grep','find','pwd','wc','head','tail','diff','sort','uniq','tr','cp','mv','mkdir','rm','chmod'])

export const bashTool: ToolExecutor<{ command: string; cwd?: string }> = async (input) => {
  const [cmd, ...args] = input.command.trim().split(/\s+/)
  if (!ALLOWED_BASH.has(cmd)) throw new Error(`Command not allowed: ${cmd}`)
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: input.cwd ? resolveSafePath(input.cwd) : os.homedir(), timeout: 8000, maxBuffer: 512 * 1024 })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) { return { stdout: '', stderr: err.message, exitCode: err.code || 1 } }
}
