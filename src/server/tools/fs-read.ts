import type { ToolExecutor } from './types'
import { readTextFileLimited, resolveToolPath } from './utils/tool-resource'

export const fsReadTool: ToolExecutor<{ path: string; offset?: number; limit?: number }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'read')
  const limited = await readTextFileLimited(filePath, context)
  const content = limited.text
  const lines = content.split('\n')
  const offset = input.offset || 0; const limit = input.limit || lines.length
  return {
    content: lines.slice(offset, offset + limit).join('\n'),
    totalLines: lines.length,
    path: filePath,
    truncated: limited.truncated,
  }
}
