import * as fs from 'fs'
import * as path from 'path'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const fsGrepTool: ToolExecutor<{ pattern: string; path: string; recursive?: boolean }> = async (input) => {
  const filePath = resolveSafePath(input.path)
  const regex = new RegExp(input.pattern, 'g')
  const matches: any[] = []
  const searchFile = (fp: string) => {
    const lines = fs.readFileSync(fp, 'utf-8').split('\n')
    lines.forEach((line, i) => { if (regex.test(line)) matches.push({ file: fp, line: i + 1, text: line.trim() }); regex.lastIndex = 0 })
  }
  if (fs.statSync(filePath).isDirectory() && input.recursive) {
    const walk = (dir: string) => { for (const f of fs.readdirSync(dir)) { const fp = path.join(dir, f); if (fs.statSync(fp).isDirectory()) walk(fp); else { try { searchFile(fp) } catch {} } } }
    walk(filePath)
  } else searchFile(filePath)
  return { matches: matches.slice(0, 100), total: matches.length }
}
