import os from 'os'
import type { ToolExecutor } from './types'
import { execFileAsync } from './utils/process'

export const pythonRunnerTool: ToolExecutor<{ code: string }> = async (input) => {
  try {
    const { stdout, stderr } = await execFileAsync('python3', ['-c', input.code], { timeout: 10000, maxBuffer: 512 * 1024, env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: os.homedir() } })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) { return { stdout: '', stderr: err.message || String(err), exitCode: 1 } }
}
