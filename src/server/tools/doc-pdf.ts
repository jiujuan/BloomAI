import * as path from 'path'
import type { ToolExecutor } from './types'
import { assertFileSizeWithinLimit, resolveToolPath } from './utils/tool-resource'
import { parsePdf } from '../attachments/parsers'

export const docPdfTool: ToolExecutor<{ path: string }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'read')
  await assertFileSizeWithinLimit(filePath, context)
  const { text, numPages } = await parsePdf(filePath)
  return { text, numPages, metadata: { file: filePath, name: path.basename(filePath) } }
}
