import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'
import { parseDocx } from '../attachments/parsers'

export const docDocxTool: ToolExecutor<{ path: string; format?: 'text' | 'html' }> = async (input) => {
  const filePath = resolveSafePath(input.path)
  const format = input.format === 'html' ? 'html' : 'text'
  return parseDocx(filePath, format)
}
