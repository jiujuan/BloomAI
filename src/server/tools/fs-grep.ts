import * as fs from 'fs'
import * as path from 'path'
import type { ToolExecutor } from './types'
import { assertNotAborted, readTextFileLimited, resolveToolPath } from './utils/tool-resource'

export const fsGrepTool: ToolExecutor<{ pattern: string; path: string; recursive?: boolean }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'read')
  const regex = new RegExp(input.pattern, 'g')
  const matches: any[] = []
  const searchFile = async (fp: string) => {
    assertNotAborted(context)
    const canonical = await resolveToolPath(fp, context, 'read')
    const lines = (await readTextFileLimited(canonical, context)).text.split('\n')
    lines.forEach((line, i) => { if (regex.test(line)) matches.push({ file: canonical, line: i + 1, text: line.trim() }); regex.lastIndex = 0 })
  }
  if ((await fs.promises.lstat(filePath)).isDirectory() && input.recursive) {
    const walk = async (dir: string): Promise<void> => {
      assertNotAborted(context)
      for (const f of await fs.promises.readdir(dir)) {
        const fp = path.join(dir, f)
        const stat = await fs.promises.lstat(fp)
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) await walk(fp)
        else {
          try { await searchFile(fp) } catch {}
        }
      }
    }
    await walk(filePath)
  } else await searchFile(filePath)
  return { matches: matches.slice(0, 100), total: matches.length }
}
