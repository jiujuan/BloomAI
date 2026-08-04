import type { ToolExecutor } from './types'
import { readTextFileLimited, resolveToolPath } from './utils/tool-resource'

export const docMarkdownTool: ToolExecutor<{ path: string }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'read')
  const limited = await readTextFileLimited(filePath, context)
  const content = limited.text
  const headings: string[] = []
  for (const line of content.split('\n')) if (line.startsWith('#')) headings.push(line.replace(/^#+\s*/, '').trim())
  const codeBlocks = (content.match(/```[\s\S]*?```/g) || []).map(c => c.slice(0, 200))
  const links = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []
  return { text: content, headings: headings.slice(0, 20), codeBlocks: codeBlocks.slice(0, 10), links: links.slice(0, 20), truncated: limited.truncated }
}
