import type { ToolExecutor } from './types'
import { assertFileSizeWithinLimit, resolveToolPath } from './utils/tool-resource'
import { parseDocx } from '../attachments/parsers'

export const docDocxTool: ToolExecutor<{ path: string; format?: 'text' | 'html' }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'read')
  await assertFileSizeWithinLimit(filePath, context)
  const format = input.format === 'html' ? 'html' : 'text'
  return parseDocx(filePath, format)
}
