import * as fs from 'fs'
import * as path from 'path'
import type { ToolExecutor } from './types'
import { resolveToolPath } from './utils/tool-resource'

export const fsWriteTool: ToolExecutor<{ path: string; content: string; mode?: string }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'write', true)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (input.mode === 'append') fs.appendFileSync(filePath, input.content, 'utf-8')
  else fs.writeFileSync(filePath, input.content, 'utf-8')
  return { bytesWritten: Buffer.byteLength(input.content), path: filePath }
}
