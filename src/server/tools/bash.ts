import type { ToolExecutor } from './types'
import { execFileAsync } from './utils/process'
import { resolveToolPath } from './utils/tool-resource'

const ALLOWED_BASH = new Set(['ls', 'cat', 'grep', 'find', 'pwd', 'wc', 'head', 'tail', 'diff', 'sort', 'uniq', 'tr'])

export type BashInput = { command: string; args?: string[]; cwd?: string }

export const bashTool: ToolExecutor<BashInput> = async (input, context) => {
  const command = input.command.trim()
  if (!ALLOWED_BASH.has(command)) throw new Error(`Command not allowed: ${command}`)
  const args = input.args ?? []
  const cwd = await resolveToolPath(input.cwd ?? '.', context, 'read')
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd, timeout: 8000, maxBuffer: 512 * 1024 })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) { return { stdout: '', stderr: err.message, exitCode: err.code || 1 } }
}
