import type { ToolExecutor } from './types'
import { readTextFileLimited, resolveToolPath } from './utils/tool-resource'

export const docTxtTool: ToolExecutor<{ path: string; chunkSize?: number }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'read')
  const limited = await readTextFileLimited(filePath, context)
  const content = limited.text
  const chunkSize = input.chunkSize || 2000
  const chunks: string[] = []
  for (let i = 0; i < content.length; i += chunkSize) chunks.push(content.slice(i, i + chunkSize))
  return { text: content.slice(0, 10000), encoding: 'utf-8', chunks: chunks.slice(0, 5), totalLength: content.length, truncated: limited.truncated }
}
