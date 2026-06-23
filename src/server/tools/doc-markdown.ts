import * as fs from 'fs'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const docMarkdownTool: ToolExecutor<{ path: string }> = async (input) => {
  const content = fs.readFileSync(resolveSafePath(input.path), 'utf-8')
  const headings: string[] = []
  for (const line of content.split('\n')) if (line.startsWith('#')) headings.push(line.replace(/^#+\s*/, '').trim())
  const codeBlocks = (content.match(/```[\s\S]*?```/g) || []).map(c => c.slice(0, 200))
  const links = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []
  return { text: content, headings: headings.slice(0, 20), codeBlocks: codeBlocks.slice(0, 10), links: links.slice(0, 20) }
}
