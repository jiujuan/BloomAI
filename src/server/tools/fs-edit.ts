import * as fs from 'fs'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const fsEditTool: ToolExecutor<{ path: string; oldText: string; newText: string }> = async (input) => {
  const filePath = resolveSafePath(input.path)
  const content = fs.readFileSync(filePath, 'utf-8')
  const count = (content.match(new RegExp(input.oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  if (count !== 1) throw new Error(`oldText must appear exactly once; found ${count}`)
  fs.writeFileSync(filePath, content.replace(input.oldText, input.newText), 'utf-8')
  return { success: true, linesChanged: input.newText.split('\n').length }
}
