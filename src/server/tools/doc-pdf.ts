import * as fs from 'fs'
import * as path from 'path'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const docPdfTool: ToolExecutor<{ path: string }> = async (input) => {
  const filePath = resolveSafePath(input.path)
  const stat = fs.statSync(filePath)
  return { text: `[PDF file: ${path.basename(filePath)}, size: ${(stat.size/1024).toFixed(1)}KB. Install pdf-parse for extraction.]`, numPages: 0, metadata: { file: filePath, size: stat.size } }
}
