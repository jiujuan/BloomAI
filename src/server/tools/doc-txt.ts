import * as fs from 'fs'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const docTxtTool: ToolExecutor<{ path: string; chunkSize?: number }> = async (input) => {
  const content = fs.readFileSync(resolveSafePath(input.path), 'utf-8')
  const chunkSize = input.chunkSize || 2000
  const chunks: string[] = []
  for (let i = 0; i < content.length; i += chunkSize) chunks.push(content.slice(i, i + chunkSize))
  return { text: content.slice(0, 10000), encoding: 'utf-8', chunks: chunks.slice(0, 5), totalLength: content.length }
}
