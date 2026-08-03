import * as fs from 'fs'
import * as path from 'path'
import type { ToolExecutor } from './types'
import { assertNotAborted, allowedRootsFor, resolveToolPath } from './utils/tool-resource'

export const fsGlobTool: ToolExecutor<{ pattern: string; cwd?: string }> = async (input, context) => {
  const cwd = input.cwd ? await resolveToolPath(input.cwd, context, 'read') : await resolveToolPath(allowedRootsFor(context)[0], context, 'read')
  const files: any[] = []
  const matchGlob = async (dir: string, depth = 0): Promise<void> => {
    assertNotAborted(context)
    if (depth > 5) return
    try {
      for (const f of await fs.promises.readdir(dir)) {
        assertNotAborted(context)
        const fp = path.join(dir, f); const stat = await fs.promises.lstat(fp)
        if (stat.isSymbolicLink()) continue
        if (!f.startsWith('.')) {
          if (stat.isDirectory()) await matchGlob(fp, depth + 1)
          else if (f.includes(input.pattern.replace('**/', '').replace('*', ''))) {
            try {
              const canonical = await resolveToolPath(fp, context, 'read')
              files.push({ path: canonical, relativePath: path.relative(cwd, canonical), size: stat.size, mtime: stat.mtimeMs })
            } catch {}
          }
        }
      }
    } catch {}
  }
  await matchGlob(cwd)
  return { files: files.slice(0, 100), total: files.length, cwd }
}
