import os from 'os'
import { toolRepo } from '../db/repositories/tool.repo'
import type { ToolExecutor } from './types'
import { execFileAsync } from './utils/process'
import { resolveSafePath } from './utils/path'

export const shellTool: ToolExecutor<{ command: string; cwd?: string }> = async (input) => {
  const perm = toolRepo.getPermission('shell')
  if (!perm?.granted || perm.scope !== 'permanent') throw new Error('Shell tool requires permanent permission grant.')
  try {
    const { stdout, stderr } = await execFileAsync('sh', ['-c', input.command], { cwd: input.cwd ? resolveSafePath(input.cwd) : os.homedir(), timeout: 10000, maxBuffer: 1024 * 1024 })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) { return { stdout: '', stderr: err.message, exitCode: 1 } }
}
