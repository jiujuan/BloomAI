import * as fs from 'fs'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const fsReadTool: ToolExecutor<{ path: string; offset?: number; limit?: number }> = async (input) => {
  const filePath = resolveSafePath(input.path)
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const offset = input.offset || 0; const limit = input.limit || lines.length
  return { content: lines.slice(offset, offset + limit).join('\n'), totalLines: lines.length, path: filePath }
}
