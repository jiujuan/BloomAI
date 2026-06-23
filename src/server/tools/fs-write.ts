import * as fs from 'fs'
import * as path from 'path'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const fsWriteTool: ToolExecutor<{ path: string; content: string; mode?: string }> = async (input) => {
  const filePath = resolveSafePath(input.path)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (input.mode === 'append') fs.appendFileSync(filePath, input.content, 'utf-8')
  else fs.writeFileSync(filePath, input.content, 'utf-8')
  return { bytesWritten: Buffer.byteLength(input.content), path: filePath }
}
