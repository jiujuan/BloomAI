import * as path from 'path'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'
import { parsePdf } from '../attachments/parsers'

export const docPdfTool: ToolExecutor<{ path: string }> = async (input) => {
  const filePath = resolveSafePath(input.path)
  const { text, numPages } = await parsePdf(filePath)
  return { text, numPages, metadata: { file: filePath, name: path.basename(filePath) } }
}
