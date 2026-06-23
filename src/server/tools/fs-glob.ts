import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const fsGlobTool: ToolExecutor<{ pattern: string; cwd?: string }> = async (input) => {
  const cwd = input.cwd ? resolveSafePath(input.cwd) : os.homedir()
  const files: any[] = []
  const matchGlob = (dir: string, depth = 0) => {
    if (depth > 5) return
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f); const stat = fs.statSync(fp)
        if (!f.startsWith('.')) {
          if (stat.isDirectory()) matchGlob(fp, depth + 1)
          else if (f.includes(input.pattern.replace('**/', '').replace('*', ''))) files.push({ path: fp, relativePath: path.relative(cwd, fp), size: stat.size, mtime: stat.mtimeMs })
        }
      }
    } catch {}
  }
  matchGlob(cwd)
  return { files: files.slice(0, 100), total: files.length, cwd }
}
